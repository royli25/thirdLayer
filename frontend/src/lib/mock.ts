import type { ServerEvent, WalletProfile, WalletSummary, EnrichStep } from "./types";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const rand = (n: number, alpha = B58) => Array.from({ length: n }, () => alpha[Math.floor(Math.random() * alpha.length)]).join("");
const pubkey = () => rand(44);
const sig = () => rand(88);
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

export const PERSONAS = ["trading-bot", "research-agent", "news-scraper", "arb-searcher"] as const;
const ENDPOINTS = ["/api/paid/price", "/api/paid/sentiment", "/api/paid/whales"];

const PERSONA_KIT: Record<string, Pick<WalletProfile, "protocols" | "tokens" | "otherX402Sellers" | "narrative"> & { score: number }> = {
  "trading-bot": {
    score: 87,
    protocols: [
      { name: "Jupiter", category: "DEX aggregator", interactions: 412 },
      { name: "Drift", category: "Perps", interactions: 133 },
      { name: "Kamino", category: "Lending", interactions: 41 },
      { name: "Pyth", category: "Oracle", interactions: 18 },
    ],
    tokens: [{ symbol: "USDC", balanceUsd: 18420 }, { symbol: "SOL", balanceUsd: 9310 }, { symbol: "JUP", balanceUsd: 1220 }],
    otherX402Sellers: [
      { name: "Birdeye Data (x402)", payTo: "BrdE…9xQa", payments: 214, totalUsd: 4.28 },
      { name: "Helius DAS (x402)", payTo: "HeLi…2mPz", payments: 61, totalUsd: 1.22 },
    ],
    narrative: "Automated trading agent. Routes most volume through Jupiter and hedges on Drift perps, about 400 swaps in 30 days. It pays three market-data APIs per minute, so price latency matters to it. High-value customer: it would likely pay more for a premium real-time tier.",
  },
  "research-agent": {
    score: 64,
    protocols: [
      { name: "Marinade", category: "Liquid staking", interactions: 9 },
      { name: "Tensor", category: "NFT", interactions: 22 },
      { name: "Jupiter", category: "DEX aggregator", interactions: 14 },
    ],
    tokens: [{ symbol: "mSOL", balanceUsd: 2210 }, { symbol: "USDC", balanceUsd: 640 }],
    otherX402Sellers: [
      { name: "Perplexity Search (x402)", payTo: "PpLx…k3Ve", payments: 88, totalUsd: 2.64 },
      { name: "Firecrawl (x402)", payTo: "FcRw…77aB", payments: 35, totalUsd: 0.7 },
    ],
    narrative: "Research or analyst agent. Uses DeFi lightly but buys a lot of data: it pays for search and scraping APIs in bursts, consistent with generating reports on demand. It has been active for months, so it looks like a durable, low-churn customer.",
  },
  "news-scraper": {
    score: 41,
    protocols: [{ name: "Jupiter", category: "DEX aggregator", interactions: 3 }],
    tokens: [{ symbol: "USDC", balanceUsd: 52 }],
    otherX402Sellers: [{ name: "Firecrawl (x402)", payTo: "FcRw…77aB", payments: 512, totalUsd: 10.24 }],
    narrative: "Single-purpose scraping agent with a thin wallet that is topped up just in time. It makes many small, regular payments and has almost no other on-chain activity. It likely runs on a cron job and is sensitive to price.",
  },
  "arb-searcher": {
    score: 93,
    protocols: [
      { name: "Raydium", category: "AMM", interactions: 1880 },
      { name: "Orca", category: "AMM", interactions: 1204 },
      { name: "Jito", category: "MEV / bundles", interactions: 960 },
      { name: "Meteora", category: "DLMM", interactions: 377 },
    ],
    tokens: [{ symbol: "SOL", balanceUsd: 61200 }, { symbol: "USDC", balanceUsd: 40100 }],
    otherX402Sellers: [
      { name: "Birdeye Data (x402)", payTo: "BrdE…9xQa", payments: 1302, totalUsd: 26.04 },
      { name: "Helius DAS (x402)", payTo: "HeLi…2mPz", payments: 455, totalUsd: 9.1 },
      { name: "Pump Feed (x402)", payTo: "PmPf…Qr8c", payments: 210, totalUsd: 4.2 },
    ],
    narrative: "Sophisticated MEV and arbitrage searcher that submits Jito bundles across Raydium, Orca and Meteora. Holds a six-figure float. It is the biggest spender on x402 data in this cohort, so it is the top upsell target for a low-latency feed.",
  },
};

function buildProfile(address: string, persona: string, source: "live" | "mainnet", payments = 1): WalletProfile {
  const kit = PERSONA_KIT[persona] ?? PERSONA_KIT["research-agent"];
  const network = source === "live" ? "solana-devnet" : "solana-mainnet";
  const pays = Array.from({ length: payments }, (_, i) => ({
    txHash: sig(),
    endpoint: ENDPOINTS[i % 3],
    amountUsd: 0.01,
    requestId: "req_" + rand(10, "abcdef0123456789"),
    ts: ago(i * 7 + 1),
    network,
  }));
  return {
    address, persona, source, score: kit.score,
    firstSeen: ago(60 * 24 * (source === "mainnet" ? 90 : 2)), lastSeen: pays[0]?.ts ?? ago(1),
    paymentCount: pays.length, totalPaidUsd: +(pays.length * 0.01).toFixed(2), flagged: true,
    payments: pays,
    chains: [
      { chain: "solana-mainnet", txCount: kit.protocols.reduce((a, p) => a + p.interactions, 0) + 37, firstTx: ago(60 * 24 * 140) },
      { chain: "solana-devnet", txCount: pays.length + 4, firstTx: ago(60 * 24 * 2) },
    ],
    protocols: kit.protocols, tokens: kit.tokens, otherX402Sellers: kit.otherX402Sellers,
    narrative: kit.narrative, enrichmentStatus: "done",
  };
}

// ---- in-memory mock store ----
const store = new Map<string, WalletProfile>();
const personaWallet = new Map<string, string>();

function seed() {
  if (store.size) return;
  const mainnet: [string, number][] = [["arb-searcher", 42], ["trading-bot", 17], ["research-agent", 9], ["news-scraper", 128], ["trading-bot", 6]];
  mainnet.forEach(([p, n]) => { const a = pubkey(); store.set(a, buildProfile(a, p, "mainnet", Math.min(n, 12))); const w = store.get(a)!; w.paymentCount = n; w.totalPaidUsd = +(n * 0.01).toFixed(2); });
  ["research-agent", "news-scraper"].forEach((p) => { const a = pubkey(); personaWallet.set(p, a); store.set(a, buildProfile(a, p, "live", 3)); });
}

export function mockWallets(): WalletSummary[] {
  seed();
  return [...store.values()].map(({ payments, chains, protocols, tokens, otherX402Sellers, narrative, enrichmentStatus, ...s }) => s)
    .sort((a, b) => +new Date(b.lastSeen) - +new Date(a.lastSeen));
}

export function mockWallet(address: string): WalletProfile | null {
  seed();
  return store.get(address) ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Simulates one x402 round-trip + capture + enrichment, emitting the same events the backend will. */
export async function mockTrigger(persona: string, emit: (e: ServerEvent) => void) {
  seed();
  const now = () => new Date().toISOString();
  const endpoint = ENDPOINTS[Math.floor(Math.random() * 3)];
  const requestId = "req_" + rand(10, "abcdef0123456789");
  let address = personaWallet.get(persona);
  const isNew = !address;
  if (!address) { address = pubkey(); personaWallet.set(persona, address); }
  const txHash = sig();

  emit({ type: "payment_required", data: { endpoint, requestId, ts: now() } });
  await sleep(1400);
  emit({ type: "payment_settled", data: { payer: address, txHash, endpoint, amountUsd: 0.01, requestId, ts: now(), network: "solana-devnet" } });

  const existing = store.get(address);
  if (existing) {
    existing.payments.unshift({ txHash, endpoint, amountUsd: 0.01, requestId, ts: now(), network: "solana-devnet" });
    existing.paymentCount++; existing.totalPaidUsd = +(existing.totalPaidUsd + 0.01).toFixed(2); existing.lastSeen = now();
  } else {
    const p = buildProfile(address, persona, "live", 0);
    p.payments = [{ txHash, endpoint, amountUsd: 0.01, requestId, ts: now(), network: "solana-devnet" }];
    p.paymentCount = 1; p.totalPaidUsd = 0.01; p.lastSeen = now(); p.firstSeen = now();
    p.enrichmentStatus = "pending";
    store.set(address, p);
  }

  await sleep(700);
  emit({ type: "onchain_confirmed", data: { txHash, payer: address, amountUsd: 0.01, source: "quicknode-stream", ts: now() } });
  await sleep(400);
  emit({ type: "wallet_flagged", data: { address, ts: now() } });

  const steps: EnrichStep[] = ["history", "x402_sellers", "protocols", "score", "narrative"];
  for (const step of steps) {
    emit({ type: "enrichment_step", data: { address, step, status: "running", ts: now() } });
    await sleep(isNew ? 900 : 350);
    emit({ type: "enrichment_step", data: { address, step, status: "done", ts: now() } });
  }
  store.get(address)!.enrichmentStatus = "done";
  emit({ type: "enrichment_done", data: { address, ts: now() } });
}
