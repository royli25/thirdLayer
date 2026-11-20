/**
 * What a seller can see WITHOUT thirdLayer: the raw USDC inflows to their wallet, straight
 * from the chain. Sender address, amount, time, signature. Nothing about what was bought.
 */
import { address } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { config, USDC_MINT } from "../config";
import { db } from "../db";
import { getParsedTx, rpc } from "../enrich/rpc";

// Parsed transactions are immutable once confirmed, so persist them: restarts stay instant.
db.exec(`CREATE TABLE IF NOT EXISTS seller_inflows (
  tx_hash TEXT PRIMARY KEY, sender TEXT, amount_usd REAL, ts TEXT, slot INTEGER, is_inflow INTEGER NOT NULL
)`);

export type Inflow = { txHash: string; from: string | null; amountUsd: number; ts: string; slot: number };

const parsed = new Map<string, Inflow | null>(); // signature -> parsed inflow (immutable once final)
for (const r of db.query("SELECT * FROM seller_inflows").all() as any[])
  parsed.set(r.tx_hash, r.is_inflow ? { txHash: r.tx_hash, from: r.sender, amountUsd: r.amount_usd, ts: r.ts, slot: r.slot } : null);
const remember = (sig: string, v: Inflow | null) => {
  parsed.set(sig, v);
  db.query("INSERT OR REPLACE INTO seller_inflows (tx_hash,sender,amount_usd,ts,slot,is_inflow) VALUES (?,?,?,?,?,?)").run(
    sig, v?.from ?? null, v?.amountUsd ?? 0, v?.ts ?? null, v?.slot ?? 0, v ? 1 : 0,
  );
};
let ataPromise: Promise<string> | null = null;
let cache: { at: number; rows: Inflow[] } = { at: 0, rows: [] };
let inflight: Promise<Inflow[]> | null = null;

const sellerAta = () =>
  (ataPromise ??= findAssociatedTokenPda({
    owner: address(config.payTo),
    mint: address(USDC_MINT.devnet),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  }).then(([a]) => a as string));

async function parseInflow(sig: string, slot: number, blockTime: number | null): Promise<Inflow | null> {
  const tx = await getParsedTx(config.devnetRpc, sig).catch(() => undefined);
  if (tx === undefined) return undefined as unknown as null; // transient: don't cache
  if (!tx?.meta) return null;
  const pre = new Map<number, number>();
  for (const b of tx.meta.preTokenBalances ?? [])
    if (b.mint === USDC_MINT.devnet) pre.set(b.accountIndex, Number(b.uiTokenAmount.uiAmount ?? 0));
  let amount = 0;
  let from: string | null = null;
  for (const b of tx.meta.postTokenBalances ?? []) {
    if (b.mint !== USDC_MINT.devnet) continue;
    const d = Number(b.uiTokenAmount.uiAmount ?? 0) - (pre.get(b.accountIndex) ?? 0);
    if (b.owner === config.payTo && d > 0) amount = d;
    if (b.owner !== config.payTo && d < 0) from = b.owner;
  }
  if (amount <= 0) return null;
  return { txHash: sig, from, amountUsd: +amount.toFixed(6), ts: new Date((blockTime ?? tx.blockTime ?? 0) * 1000).toISOString(), slot };
}

/** Full history: every signature on the seller's USDC account (paged), parsed once and persisted. */
async function refresh(): Promise<Inflow[]> {
  const ata = await sellerAta();
  const sigs: { signature: string; slot: number; blockTime: number | null; err: unknown }[] = [];
  let before: string | undefined;
  for (let page = 0; page < 10; page++) {
    const batch = await rpc<typeof sigs>(config.devnetRpc, "getSignaturesForAddress", [ata, { limit: 1000, before }]);
    sigs.push(...batch);
    if (batch.length < 1000) break;
    before = batch.at(-1)!.signature;
  }
  const todo = sigs.filter((s) => !s.err && !parsed.has(s.signature));
  // Small concurrency: public devnet RPC rate-limits hard. Parsed results persist, so this is a one-time cost.
  for (let i = 0; i < todo.length; i += 3) {
    await Promise.all(
      todo.slice(i, i + 3).map(async (s) => {
        const r = await parseInflow(s.signature, s.slot, s.blockTime);
        if (r !== (undefined as unknown)) remember(s.signature, r);
      }),
    );
  }
  return sigs.map((s) => parsed.get(s.signature)).filter((x): x is Inflow => !!x);
}

/** All inflows, newest first. Stale-while-revalidate: answers instantly, refreshes in the background. */
export async function sellerInflows(): Promise<Inflow[]> {
  if (Date.now() - cache.at >= 4000 && !inflight) {
    inflight = refresh()
      .then((rows) => ((cache = { at: Date.now(), rows }), rows))
      .catch((e) => {
        console.warn("[seller] onchain refresh failed", (e as Error).message);
        return cache.rows;
      })
      .finally(() => (inflight = null));
  }
  if (cache.at) return cache.rows;
  return inflight ?? cache.rows; // first call ever: wait once
}
