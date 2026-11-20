/**
 * x402 Pulse: live x402 market activity on Solana mainnet. Data no LLM can know, sold at $0.01.
 * Source: the PayAI facilitator's fee-payer wallet co-signs every x402 settlement it processes,
 * so its signature history is a real-time feed of x402 payments.
 */
import { config, USDC_MINT } from "./config";
import { SELLERS } from "./enrich/registry";
import { getParsedTx, pool, rpc } from "./enrich/rpc";

const FEE_PAYER = "CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww"; // PayAI, Solana mainnet

export type Pulse = {
  window: "24h";
  facilitator: "PayAI";
  network: "solana-mainnet";
  settlementsLast24h: number;
  settlementsLastHour: number;
  sample: { size: number; volumeUsd: number; avgPaymentUsd: number; uniquePayers: number };
  topSellers: { seller: string; payments: number; volumeUsd: number }[];
  latest: { signature: string; seller: string; amountUsd: number; ts: string } | null;
  asOf: string;
};

let cache: { at: number; value: Pulse } | null = null;
let inflight: Promise<Pulse> | null = null;

async function compute(): Promise<Pulse> {
  const now = Date.now() / 1000;
  const sigs: { signature: string; blockTime: number | null; err: unknown }[] = [];
  let before: string | undefined;
  for (let page = 0; page < 3; page++) {
    const batch = await rpc<typeof sigs>(config.mainnetRpc, "getSignaturesForAddress", [FEE_PAYER, { limit: 1000, before }]);
    sigs.push(...batch);
    const oldest = batch.at(-1)?.blockTime ?? 0;
    if (batch.length < 1000 || oldest < now - 86400) break;
    before = batch.at(-1)!.signature;
  }
  const ok = sigs.filter((s) => !s.err && s.blockTime);
  const lastDay = ok.filter((s) => s.blockTime! >= now - 86400);
  const lastHour = ok.filter((s) => s.blockTime! >= now - 3600);

  // Parse a recent sample to see who is getting paid.
  const sample = await pool(lastDay.slice(0, 30).map((s) => s.signature), 3, (sig) => getParsedTx(config.mainnetRpc, sig).catch(() => null));
  const sellers = new Map<string, { payments: number; volumeUsd: number }>();
  const payers = new Set<string>();
  let volume = 0;
  let n = 0;
  let latest: Pulse["latest"] = null;
  sample.forEach((tx, i) => {
    if (!tx?.meta) return;
    const pre = new Map<number, number>();
    for (const b of tx.meta.preTokenBalances ?? []) if (b.mint === USDC_MINT.mainnet) pre.set(b.accountIndex, Number(b.uiTokenAmount.uiAmount ?? 0));
    let payTo: string | null = null, payer: string | null = null, amt = 0;
    for (const b of tx.meta.postTokenBalances ?? []) {
      if (b.mint !== USDC_MINT.mainnet) continue;
      const d = Number(b.uiTokenAmount.uiAmount ?? 0) - (pre.get(b.accountIndex) ?? 0);
      if (d > 0) { payTo = b.owner; amt = d; }
      if (d < 0) payer = b.owner;
    }
    if (!payTo || amt <= 0 || amt > 100) return;
    const name = SELLERS.get(payTo)?.name ?? `${payTo.slice(0, 4)}…${payTo.slice(-4)}`;
    const e = sellers.get(name) ?? { payments: 0, volumeUsd: 0 };
    e.payments++;
    e.volumeUsd += amt;
    sellers.set(name, e);
    if (payer) payers.add(payer);
    volume += amt;
    n++;
    if (!latest) latest = { signature: lastDay[i]!.signature, seller: name, amountUsd: +amt.toFixed(4), ts: new Date(tx.blockTime * 1000).toISOString() };
  });

  return {
    window: "24h",
    facilitator: "PayAI",
    network: "solana-mainnet",
    settlementsLast24h: lastDay.length,
    settlementsLastHour: lastHour.length,
    sample: { size: n, volumeUsd: +volume.toFixed(4), avgPaymentUsd: n ? +(volume / n).toFixed(4) : 0, uniquePayers: payers.size },
    topSellers: [...sellers.entries()]
      .sort((a, b) => b[1].payments - a[1].payments)
      .slice(0, 5)
      .map(([seller, v]) => ({ seller, payments: v.payments, volumeUsd: +v.volumeUsd.toFixed(4) })),
    latest,
    asOf: new Date().toISOString(),
  };
}

/** Stale-while-revalidate: always answer instantly from the last result; refresh in the background. */
export async function getPulse(): Promise<Pulse | null> {
  const stale = !cache || Date.now() - cache.at > 120_000;
  if (stale && !inflight) {
    inflight = compute()
      .then((v) => ((cache = { at: Date.now(), value: v }), v))
      .catch((e) => {
        console.warn("[pulse] refresh failed", (e as Error).message);
        return cache?.value as Pulse;
      })
      .finally(() => (inflight = null));
  }
  if (cache) return { ...cache.value, asOf: new Date(cache.at).toISOString() };
  return (await inflight) ?? null; // first call ever: wait once
}

// Keep it warm.
setInterval(() => void getPulse(), 60_000).unref?.();
