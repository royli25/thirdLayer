import { API, detectMode } from "./api";
import type { Payment, WalletSummary } from "./types";

export type Dataset = "real" | "demo";

export interface Segment {
  key: string;
  label: string;
  walletCount: number;
  paymentCount: number;
  revenueUsd: number;
  share: number;
  avgScore: number;
  endpointMix: { endpoint: string; count: number }[];
  hourly: number[];
  avgCallsPerWallet: number;
  medianGapSec: number | null;
  activeDaysAvg: number;
  topProtocols: { name: string; category: string; wallets: number }[];
  topTokens: { symbol: string; wallets: number }[];
  topSellers: { name: string; payTo: string; wallets: number; totalUsd: number }[];
  summary: string;
  action: { title: string; detail: string };
}

export interface SegmentsResponse {
  dataset: Dataset;
  totals: { wallets: number; payments: number; revenueUsd: number };
  segments: Segment[];
}

export type PaymentRow = Payment & { payer: string; onchainConfirmed?: boolean };
export interface PaymentsResponse { total: { count: number; revenueUsd: number }; payments: PaymentRow[] }

async function get<T>(path: string): Promise<T | null> {
  if ((await detectMode()) === "mock") return null;
  try { const r = await fetch(`${API}${path}`); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

export async function getSegments(dataset: Dataset): Promise<SegmentsResponse> {
  return (await get<SegmentsResponse>(`/segments?dataset=${dataset}`)) ?? mockSegments(dataset);
}

export async function getSegmentWallets(key: string, dataset: Dataset): Promise<WalletSummary[]> {
  const r = await get<{ wallets: WalletSummary[] }>(`/segments/${key}/wallets?dataset=${dataset}`);
  return r?.wallets ?? mockSegmentWallets(key);
}

export async function getPaymentsPage(dataset: Dataset, limit = 50): Promise<PaymentsResponse> {
  const r = await get<PaymentsResponse | { payments: PaymentRow[] }>(`/payments?dataset=${dataset}&limit=${limit}`);
  if (r && "total" in r) return r;
  if (r) return { total: { count: r.payments.length, revenueUsd: r.payments.reduce((a, p) => a + p.amountUsd, 0) }, payments: r.payments };
  return { total: { count: 1284, revenueUsd: 12.84 }, payments: [] };
}

// ---------- fallback data until the backend ships /segments ----------
const hours = (peak: number, spread: number, base: number) =>
  Array.from({ length: 24 }, (_, h) => Math.round(base + 40 * Math.exp(-((Math.min(Math.abs(h - peak), 24 - Math.abs(h - peak))) ** 2) / (2 * spread ** 2))));

const SEGS: Omit<Segment, "share">[] = [
  { key: "traders", label: "Trading bots", walletCount: 42, paymentCount: 512, revenueUsd: 5.12, avgScore: 81,
    endpointMix: [{ endpoint: "/api/paid/price", count: 401 }, { endpoint: "/api/paid/whales", count: 88 }, { endpoint: "/api/paid/sentiment", count: 23 }],
    hourly: hours(14, 5, 12), avgCallsPerWallet: 12.2, medianGapSec: 45, activeDaysAvg: 9.4,
    topProtocols: [{ name: "Jupiter", category: "DEX aggregator", wallets: 38 }, { name: "Drift", category: "Perps", wallets: 17 }, { name: "Kamino", category: "Lending", wallets: 9 }],
    topTokens: [{ symbol: "USDC", wallets: 42 }, { symbol: "SOL", wallets: 40 }, { symbol: "JUP", wallets: 21 }],
    topSellers: [{ name: "Birdeye Data", payTo: "BrdE…9xQa", wallets: 29, totalUsd: 18.4 }, { name: "Helius DAS", payTo: "HeLi…2mPz", wallets: 12, totalUsd: 4.1 }],
    summary: "Trading bots poll price data in tight loops, mostly during US market hours. Nearly all of them route swaps through Jupiter, and they already pay Birdeye for similar data.",
    action: { title: "Offer a streaming price tier", detail: "These wallets call /price about every 45 seconds. A $5/day websocket plan would undercut what they spend per call and lock them in before they switch to Birdeye." } },
  { key: "power-users", label: "Power users", walletCount: 8, paymentCount: 388, revenueUsd: 3.88, avgScore: 92,
    endpointMix: [{ endpoint: "/api/paid/price", count: 160 }, { endpoint: "/api/paid/whales", count: 130 }, { endpoint: "/api/paid/sentiment", count: 98 }],
    hourly: hours(3, 9, 18), avgCallsPerWallet: 48.5, medianGapSec: 20, activeDaysAvg: 21.0,
    topProtocols: [{ name: "Jito", category: "MEV", wallets: 6 }, { name: "Raydium", category: "AMM", wallets: 7 }, { name: "Meteora", category: "DLMM", wallets: 5 }],
    topTokens: [{ symbol: "SOL", wallets: 8 }, { symbol: "USDC", wallets: 8 }],
    topSellers: [{ name: "Birdeye Data", payTo: "BrdE…9xQa", wallets: 8, totalUsd: 61.2 }, { name: "Pump Feed", payTo: "PmPf…Qr8c", wallets: 4, totalUsd: 9.9 }],
    summary: "A small number of wallets that make up nearly a third of revenue. They're active around the clock, use all three endpoints, and spend heavily with other x402 data sellers.",
    action: { title: "Assign a volume discount", detail: "8 wallets bring in 30% of revenue. A volume discount above 1,000 calls a month protects that revenue from competitors." } },
  { key: "researchers", label: "Research agents", walletCount: 61, paymentCount: 214, revenueUsd: 2.14, avgScore: 58,
    endpointMix: [{ endpoint: "/api/paid/sentiment", count: 132 }, { endpoint: "/api/paid/price", count: 61 }, { endpoint: "/api/paid/whales", count: 21 }],
    hourly: hours(10, 4, 4), avgCallsPerWallet: 3.5, medianGapSec: 5400, activeDaysAvg: 3.1,
    topProtocols: [{ name: "Marinade", category: "Liquid staking", wallets: 14 }, { name: "Tensor", category: "NFT", wallets: 9 }],
    topTokens: [{ symbol: "USDC", wallets: 61 }, { symbol: "mSOL", wallets: 13 }],
    topSellers: [{ name: "Perplexity Search", payTo: "PpLx…k3Ve", wallets: 33, totalUsd: 21.0 }, { name: "Firecrawl", payTo: "FcRw…77aB", wallets: 19, totalUsd: 6.3 }],
    summary: "Research agents buy sentiment in bursts during working hours, alongside search and scraping APIs. That's typical of agents writing reports on demand.",
    action: { title: "Bundle sentiment with news", detail: "Over half of these wallets also pay Perplexity. A sentiment + headlines bundle would capture spend that currently goes elsewhere." } },
  { key: "whale-watchers", label: "Whale watchers", walletCount: 19, paymentCount: 96, revenueUsd: 0.96, avgScore: 66,
    endpointMix: [{ endpoint: "/api/paid/whales", count: 84 }, { endpoint: "/api/paid/price", count: 12 }],
    hourly: hours(20, 6, 3), avgCallsPerWallet: 5.1, medianGapSec: 900, activeDaysAvg: 6.2,
    topProtocols: [{ name: "Jupiter", category: "DEX aggregator", wallets: 11 }],
    topTokens: [{ symbol: "SOL", wallets: 19 }, { symbol: "BONK", wallets: 7 }],
    topSellers: [{ name: "Nansen", payTo: "NsN…4hQ", wallets: 6, totalUsd: 3.3 }],
    summary: "Alert bots that check whale flows every 15 minutes, mostly in the evening, and follow up with small Jupiter swaps.",
    action: { title: "Push alerts instead of polling", detail: "They poll on a fixed 15-minute timer. Webhook delivery at the same price per alert would cut wasted calls and improve retention." } },
  { key: "portfolio", label: "Portfolio agents", walletCount: 23, paymentCount: 52, revenueUsd: 0.52, avgScore: 61,
    endpointMix: [{ endpoint: "/api/paid/price", count: 49 }, { endpoint: "/api/paid/sentiment", count: 3 }],
    hourly: hours(0, 2, 1), avgCallsPerWallet: 2.3, medianGapSec: 86400, activeDaysAvg: 2.0,
    topProtocols: [{ name: "Kamino", category: "Lending", wallets: 12 }, { name: "Marinade", category: "Liquid staking", wallets: 8 }],
    topTokens: [{ symbol: "USDC", wallets: 23 }, { symbol: "mSOL", wallets: 10 }, { symbol: "JitoSOL", wallets: 9 }],
    topSellers: [],
    summary: "Rebalancers that check prices once a day around midnight UTC. Low volume, but they hold a lot and stick around.",
    action: { title: "Sell a daily snapshot", detail: "One call a day. A $0.05 end-of-day portfolio snapshot endpoint would raise revenue per wallet 5× without changing how they behave." } },
  { key: "casual", label: "Casual", walletCount: 131, paymentCount: 22, revenueUsd: 0.22, avgScore: 22,
    endpointMix: [{ endpoint: "/api/paid/price", count: 14 }, { endpoint: "/api/paid/sentiment", count: 8 }],
    hourly: hours(16, 8, 0), avgCallsPerWallet: 1.1, medianGapSec: null, activeDaysAvg: 1.0,
    topProtocols: [], topTokens: [{ symbol: "USDC", wallets: 131 }], topSellers: [],
    summary: "Wallets that tried the API once and left. Most were funded just in time and show no other on-chain activity.",
    action: { title: "Add a free first call", detail: "Most churn after one paid call. Letting a wallet's first call be free with an x402 'trial' header could turn some of them into research agents." } },
];

function mockSegments(dataset: Dataset): SegmentsResponse {
  const total = SEGS.reduce((a, s) => a + s.revenueUsd, 0);
  return {
    dataset,
    totals: { wallets: SEGS.reduce((a, s) => a + s.walletCount, 0), payments: SEGS.reduce((a, s) => a + s.paymentCount, 0), revenueUsd: +total.toFixed(2) },
    segments: SEGS.map((s) => ({ ...s, share: s.revenueUsd / total })),
  };
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function mockSegmentWallets(key: string): WalletSummary[] {
  const s = SEGS.find((x) => x.key === key);
  if (!s) return [];
  const rnd = seeded(key.length * 7919 + 13);
  return Array.from({ length: Math.min(s.walletCount, 14) }, () => {
    const n = Math.max(1, Math.round(s.avgCallsPerWallet * (0.4 + rnd() * 1.2)));
    return {
      address: Array.from({ length: 44 }, () => B58[Math.floor(rnd() * B58.length)]).join(""),
      source: "mainnet" as const, persona: s.label.toLowerCase(), score: Math.round(Math.min(99, s.avgScore + (rnd() - 0.5) * 20)),
      firstSeen: new Date(Date.now() - rnd() * 30 * 864e5).toISOString(), lastSeen: new Date(Date.now() - rnd() * 864e5).toISOString(),
      paymentCount: n, totalPaidUsd: +(n * 0.01).toFixed(2), flagged: true,
    };
  }).sort((a, b) => b.paymentCount - a.paymentCount);
}
