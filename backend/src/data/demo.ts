/**
 * Demo dataset: synthetic but internally consistent, for showing the product at volume.
 * Deterministic (seeded) so the demo looks the same every run. Always labeled "demo" in the API.
 */
import { base58 } from "@scure/base";
import { computeScore, type Enrichment } from "../enrich/enrich";
import { template } from "../enrich/narrative";
import { SELLERS } from "../enrich/registry";
import type { Dataset, ExternalPaymentView, PaymentView, WalletView } from "./types";

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(402);
const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
const bytes = (n: number) => Uint8Array.from({ length: n }, () => Math.floor(r() * 256));
const addr = () => base58.encode(bytes(32));
const sig = () => base58.encode(bytes(64));
const weighted = (mix: Record<string, number>) => {
  let x = r();
  for (const [k, w] of Object.entries(mix)) if ((x -= w) <= 0) return k;
  return Object.keys(mix)[0]!;
};

const sellerByName = (name: string) => [...SELLERS.values()].find((s) => s.name === name)?.payTo ?? addr();

type P = {
  weight: number;
  calls: [number, number];
  mix: Record<string, number>;
  hours: number[]; // UTC peak hours
  gapMin: [number, number]; // minutes between calls
  protocols: [string, string][];
  tokens: string[];
  sellers: string[];
  mainnetTx: [number, number];
};

const PERSONAS: Record<string, P> = {
  "trading-bot": {
    weight: 0.3, calls: [6, 18], mix: { price: 0.82, sentiment: 0.08, whales: 0.1 }, hours: [13, 14, 15, 16, 17, 18, 19, 20], gapMin: [1, 6],
    protocols: [["Jupiter", "dex-aggregator"], ["Raydium CLMM", "dex"], ["Orca Whirlpools", "dex"], ["Meteora DLMM", "dex"], ["Drift", "perps"]],
    tokens: ["USDC", "SOL", "JUP", "BONK", "WIF"], sellers: ["pro-api.coingecko.com", "x402-btc-radar.jinli-x402.workers.dev", "api.nansen.ai"], mainnetTx: [800, 9000],
  },
  "research-agent": {
    weight: 0.17, calls: [3, 9], mix: { sentiment: 0.68, whales: 0.2, price: 0.12 }, hours: [8, 9, 10, 11, 12, 13, 14, 15, 16], gapMin: [20, 240],
    protocols: [["Jupiter", "dex-aggregator"]], tokens: ["USDC", "SOL"], sellers: ["agi.apify.com", "gdelt.use.x402atlas.com", "api.exa.ai", "www.blockchainiq.co"], mainnetTx: [40, 600],
  },
  "news-scraper": {
    weight: 0.1, calls: [4, 12], mix: { sentiment: 0.9, price: 0.1 }, hours: [5, 6, 7, 8, 18, 19, 20, 21], gapMin: [10, 60],
    protocols: [], tokens: ["USDC", "SOL"], sellers: ["gdelt.use.x402atlas.com", "agi.apify.com"], mainnetTx: [20, 300],
  },
  "whale-watcher": {
    weight: 0.14, calls: [4, 14], mix: { whales: 0.76, price: 0.24 }, hours: [0, 3, 6, 9, 12, 15, 18, 21], gapMin: [5, 30],
    protocols: [["Jupiter", "dex-aggregator"], ["Kamino Lend", "lending"], ["Drift", "perps"]], tokens: ["USDC", "SOL", "JitoSOL", "JUP"],
    sellers: ["api.nansen.ai", "api.arkm.com"], mainnetTx: [300, 4000],
  },
  "portfolio-agent": {
    weight: 0.12, calls: [3, 10], mix: { price: 0.4, sentiment: 0.3, whales: 0.3 }, hours: [7, 8, 12, 13, 19, 20], gapMin: [60, 720],
    protocols: [["Kamino Lend", "lending"], ["marginfi", "lending"], ["Marinade", "staking"], ["Jupiter", "dex-aggregator"]], tokens: ["USDC", "SOL", "mSOL", "JitoSOL", "JLP"],
    sellers: ["pro-api.coingecko.com", "api.nansen.ai"], mainnetTx: [200, 2500],
  },
  "x402-power-agent": {
    weight: 0.07, calls: [8, 22], mix: { price: 0.35, sentiment: 0.35, whales: 0.3 }, hours: Array.from({ length: 24 }, (_, i) => i), gapMin: [2, 20],
    protocols: [["Jupiter", "dex-aggregator"]], tokens: ["USDC", "SOL"],
    sellers: ["api.nansen.ai", "agi.apify.com", "pro-api.coingecko.com", "api.bitrefill.com", "ip402.xyz", "api.exa.ai"], mainnetTx: [1000, 12000],
  },
  "x402-buyer": {
    weight: 0.1, calls: [1, 2], mix: { price: 0.5, sentiment: 0.3, whales: 0.2 }, hours: [10, 14, 16, 20, 22], gapMin: [600, 4000],
    protocols: [], tokens: ["USDC"], sellers: [], mainnetTx: [1, 40],
  },
};

const PRICES: Record<string, number> = { USDC: 1, SOL: 142, JUP: 0.62, BONK: 0.000021, WIF: 1.9, JitoSOL: 168, mSOL: 171, JLP: 4.3 };
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-20T10:00:00Z");

function build(): Dataset {
  const wallets: WalletView[] = [];
  const payments: PaymentView[] = [];
  const external: ExternalPaymentView[] = [];
  const weights = Object.fromEntries(Object.entries(PERSONAS).map(([k, v]) => [k, v.weight]));

  for (let w = 0; w < 236; w++) {
    const persona = weighted(weights);
    const P = PERSONAS[persona]!;
    const address = addr();
    const n = int(...P.calls);
    let t = NOW - int(1, 14) * DAY;
    const mine: PaymentView[] = [];
    for (let k = 0; k < n; k++) {
      const d = new Date(t);
      d.setUTCHours(pick(P.hours), int(0, 59), int(0, 59));
      t = Math.min(NOW - 60_000, Math.max(d.getTime(), t) + int(...P.gapMin) * 60_000 * (r() < 0.15 ? int(6, 40) : 1));
      mine.push({
        payer: address, txHash: sig(), endpoint: `/api/paid/${weighted(P.mix)}`, amountUsd: 0.01,
        requestId: crypto.randomUUID(), ts: new Date(t).toISOString(), network: "solana-mainnet", onchainConfirmed: r() < 0.97,
      });
    }
    payments.push(...mine);

    // On-chain footprint
    const txCount = int(...P.mainnetTx);
    const firstTx = new Date(NOW - int(20, 720) * DAY).toISOString();
    const protocols = P.protocols.filter(() => r() < 0.7).map(([name, category]) => ({ name, category, interactions: int(1, 30) }));
    const tokens = P.tokens
      .filter((s) => s === "USDC" || r() < 0.65)
      .map((symbol) => {
        const units = symbol === "USDC" ? int(5, 4000) : symbol === "BONK" ? int(1e6, 9e8) : r() * int(1, 400);
        return { symbol, balanceUsd: +(units * (PRICES[symbol] ?? 1)).toFixed(2) };
      })
      .sort((a, b) => b.balanceUsd - a.balanceUsd);
    const sellers = P.sellers.filter(() => r() < 0.6).map((name) => {
      const payTo = sellerByName(name);
      const cnt = int(1, 25);
      const unit = pick([0.001, 0.005, 0.01, 0.02, 0.05, 0.1]);
      for (let k = 0; k < Math.min(cnt, 5); k++)
        external.push({ payer: address, payTo, seller: name, amountUsd: unit, ts: new Date(NOW - int(0, 30) * DAY).toISOString(), txHash: sig(), network: "solana-mainnet" });
      return { name, payTo, payments: cnt, totalUsd: +(cnt * unit).toFixed(3) };
    });

    const spend = mine.reduce((s, p) => s + p.amountUsd, 0);
    const score = computeScore({
      spendUsd: spend + sellers.reduce((s, x) => s + x.totalUsd, 0),
      paymentCount: n + sellers.reduce((s, x) => s + x.payments, 0),
      txCount, protocolCount: protocols.length, sellerCount: sellers.length,
      ageDays: (NOW - Date.parse(firstTx)) / DAY,
    });
    const enrichment: Enrichment = {
      chains: [{ chain: "solana-mainnet", txCount, firstTx }],
      protocols, tokens, otherX402Sellers: sellers, narrative: null,
      signals: { firstPartySpendUsd: spend, externalX402SpendUsd: sellers.reduce((s, x) => s + x.totalUsd, 0) },
    };
    const sorted = mine.map((p) => p.ts).sort();
    enrichment.narrative = template({
      address, source: "live", persona, score, enrichment,
      payments: mine.map((p) => ({ tx_hash: p.txHash, payer: address, endpoint: p.endpoint, amount_usd: p.amountUsd, request_id: p.requestId, ts: p.ts, network: p.network, user_agent: null, persona_hint: null, onchain_confirmed: 1 })),
    });
    wallets.push({
      address, source: "live", persona, score, firstSeen: sorted[0]!, lastSeen: sorted.at(-1)!,
      flagged: true, enrichmentStatus: "done", enrichment,
    });
  }
  payments.sort((a, b) => b.ts.localeCompare(a.ts));
  return { name: "demo", wallets, payments, external };
}

let cached: Dataset | null = null;
export const loadDemo = () => (cached ??= build());
