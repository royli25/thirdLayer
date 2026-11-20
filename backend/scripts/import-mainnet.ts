/**
 * "Real-world" wallets from Solana mainnet, read-only.
 *
 * Every x402 settlement on Solana is co-signed by the facilitator's fee-payer
 * wallet, so that wallet's transaction history is a live feed of real x402
 * payments: payer --USDC--> seller. We read it, attribute sellers via the CDP
 * x402 Discovery registry, and profile the most active real payers.
 *
 *   bun run import:mainnet [txs=300] [walletsToEnrich=12]
 */
import { config, USDC_MINT } from "../src/config";
import { db, touchWallet } from "../src/db";
import { enrichWallet } from "../src/enrich/enrich";
import { SELLERS } from "../src/enrich/registry";
import { getParsedTx, pool, rpc } from "../src/enrich/rpc";

// Solana-mainnet fee payers advertised by facilitators' /supported endpoints.
const FACILITATOR_FEE_PAYERS: Record<string, string> = {
  CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww: "PayAI",
};

const [nTx = 300, nEnrich = 12] = process.argv.slice(2).map(Number);
const url = config.mainnetRpc;
const payerCounts = new Map<string, number>();
const sellerCounts = new Map<string, number>();

for (const [feePayer, facilitator] of Object.entries(FACILITATOR_FEE_PAYERS)) {
  const sigs: any[] = [];
  let before: string | undefined;
  while (sigs.length < nTx) {
    const page = await rpc<any[]>(url, "getSignaturesForAddress", [feePayer, { limit: Math.min(1000, nTx - sigs.length), before }]);
    sigs.push(...page.filter((s) => !s.err));
    if (page.length === 0) break;
    before = page.at(-1).signature;
  }
  console.log(`${facilitator}: ${sigs.length} settlements`);

  const conc = url.includes("mainnet-beta.solana.com") ? 1 : 6; // public RPC rate-limits hard
  const txs = await pool(sigs.map((s) => s.signature as string), conc, async (sig) => {
    const t = await getParsedTx(url, sig).catch(() => null);
    if (conc === 1) await Bun.sleep(120);
    return t;
  });
  console.log(`fetched ${txs.filter(Boolean).length}/${txs.length} txs`);
  for (const tx of txs) {
    if (!tx?.meta) continue;
    const pre = new Map<number, any>((tx.meta.preTokenBalances ?? []).map((b: any) => [b.accountIndex, b]));
    let payer: string | null = null;
    let payTo: string | null = null;
    let amount = 0;
    for (const b of tx.meta.postTokenBalances ?? []) {
      if (b.mint !== USDC_MINT.mainnet) continue;
      const d = Number(b.uiTokenAmount.uiAmount ?? 0) - Number(pre.get(b.accountIndex)?.uiTokenAmount.uiAmount ?? 0);
      if (d < 0) payer = b.owner;
      if (d > 0) {
        payTo = b.owner;
        amount = d;
      }
    }
    if (!payer || !payTo || amount <= 0 || amount > 100) continue;
    const seller = SELLERS.get(payTo)?.name ?? `${payTo.slice(0, 4)}…${payTo.slice(-4)}`;
    const ts = new Date((tx.blockTime ?? 0) * 1000).toISOString();
    db.query(
      "INSERT OR IGNORE INTO external_payments (tx_hash,payer,pay_to,seller,amount_usd,ts,network) VALUES (?,?,?,?,?,?,?)",
    ).run(tx.transaction.signatures[0], payer, payTo, seller, +amount.toFixed(6), ts, "solana-mainnet");
    payerCounts.set(payer, (payerCounts.get(payer) ?? 0) + 1);
    sellerCounts.set(seller, (sellerCounts.get(seller) ?? 0) + 1);
  }
}

console.log("\nTop sellers:", [...sellerCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8));
const top = [...payerCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, nEnrich);
console.log(`${payerCounts.size} unique real payers. Enriching top ${top.length}…`);
for (const [addr, n] of top) {
  const span = db.query("SELECT MIN(ts) a, MAX(ts) b FROM external_payments WHERE payer=?").get(addr) as { a: string; b: string };
  touchWallet(addr, "mainnet", span.a);
  touchWallet(addr, "mainnet", span.b);
  await enrichWallet(addr);
  const w = db.query("SELECT persona, score FROM wallets WHERE address=?").get(addr) as any;
  console.log(`  ${addr}  x402 payments=${n}  persona=${w?.persona}  score=${w?.score}`);
}
