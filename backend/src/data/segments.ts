/**
 * Customer segments: groups wallets by behavior-derived persona and synthesizes how each
 * segment uses the API, what else it does on-chain, and what the seller should do about it.
 */
import type { Dataset, WalletView } from "./types";

export const SEGMENTS = {
  traders: { label: "Traders", personas: ["trading-bot", "price-tracker", "defi-trader", "perps-trader", "memecoin-trader"] },
  researchers: { label: "Researchers", personas: ["research-agent", "news-scraper"] },
  "whale-watchers": { label: "Whale watchers", personas: ["whale-watcher"] },
  portfolio: { label: "Portfolio managers", personas: ["portfolio-agent", "yield-farmer"] },
  "power-users": { label: "x402 power users", personas: ["x402-power-agent"] },
  casual: { label: "Occasional buyers", personas: ["x402-buyer", "nft-collector", "unknown"] },
} as const;
export type SegmentKey = keyof typeof SEGMENTS;

export function segmentOf(persona: string): SegmentKey {
  for (const [k, s] of Object.entries(SEGMENTS)) if ((s.personas as readonly string[]).includes(persona)) return k as SegmentKey;
  return "casual";
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const pct = (x: number) => `${Math.round(x * 100)}%`;
const human = (sec: number | null) =>
  sec == null ? "n/a" : sec < 90 ? `${Math.round(sec)}s` : sec < 5400 ? `${Math.round(sec / 60)} min` : sec < 172800 ? `${Math.round(sec / 3600)} h` : `${Math.round(sec / 86400)} days`;
const top = <T,>(m: Map<string, T>, score: (v: T) => number, n = 6) =>
  [...m.entries()].sort((a, b) => score(b[1]) - score(a[1])).slice(0, n);

export function walletSummary(ds: Dataset, w: WalletView) {
  const mine = ds.payments.filter((p) => p.payer === w.address);
  const ext = ds.external.filter((e) => e.payer === w.address);
  const firstParty = mine.length > 0;
  return {
    address: w.address,
    source: w.source,
    persona: w.persona,
    segment: segmentOf(w.persona),
    score: w.score,
    firstSeen: w.firstSeen,
    lastSeen: w.lastSeen,
    paymentCount: firstParty ? mine.length : ext.length,
    totalPaidUsd: +(firstParty ? mine : ext).reduce((s, p) => s + p.amountUsd, 0).toFixed(4),
    flagged: w.flagged,
  };
}

export function buildSegments(ds: Dataset) {
  const byPayer = new Map<string, typeof ds.payments>();
  for (const p of ds.payments) (byPayer.get(p.payer) ?? byPayer.set(p.payer, []).get(p.payer)!).push(p);
  const totalRevenue = ds.payments.reduce((s, p) => s + p.amountUsd, 0);

  const groups = new Map<SegmentKey, WalletView[]>();
  for (const w of ds.wallets) {
    const k = segmentOf(w.persona);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(w);
  }

  const segments = [...groups.entries()].map(([key, ws]) => {
    const pays = ws.flatMap((w) => byPayer.get(w.address) ?? []);
    const revenueUsd = pays.reduce((s, p) => s + p.amountUsd, 0);
    const endpoints = new Map<string, number>();
    const hourly = new Array(24).fill(0) as number[];
    for (const p of pays) {
      endpoints.set(p.endpoint, (endpoints.get(p.endpoint) ?? 0) + 1);
      hourly[new Date(p.ts).getUTCHours()]!++;
    }
    const gaps = ws.map((w) => {
      const ts = (byPayer.get(w.address) ?? []).map((p) => Date.parse(p.ts)).sort((a, b) => a - b);
      return median(ts.slice(1).map((t, i) => (t - ts[i]!) / 1000));
    }).filter((g): g is number => g != null);
    const protocols = new Map<string, { category: string; wallets: number }>();
    const tokens = new Map<string, number>();
    const sellers = new Map<string, { payTo: string; wallets: number; totalUsd: number }>();
    for (const w of ws) {
      const e = w.enrichment;
      if (!e) continue;
      for (const p of e.protocols) if (p.category !== "core" && p.category !== "unknown") {
        const x = protocols.get(p.name) ?? { category: p.category, wallets: 0 };
        x.wallets++;
        protocols.set(p.name, x);
      }
      for (const t of e.tokens) tokens.set(t.symbol, (tokens.get(t.symbol) ?? 0) + 1);
      for (const s of e.otherX402Sellers) {
        const x = sellers.get(s.name) ?? { payTo: s.payTo, wallets: 0, totalUsd: 0 };
        x.wallets++;
        x.totalUsd += s.totalUsd;
        sellers.set(s.name, x);
      }
    }
    const activeDays = ws.map((w) => (Date.parse(w.lastSeen) - Date.parse(w.firstSeen)) / 86_400_000);
    const seg = {
      key,
      label: SEGMENTS[key].label,
      walletCount: ws.length,
      paymentCount: pays.length,
      revenueUsd: +revenueUsd.toFixed(2),
      share: totalRevenue ? revenueUsd / totalRevenue : ws.length / Math.max(1, ds.wallets.length),
      avgScore: Math.round(ws.reduce((s, w) => s + w.score, 0) / ws.length),
      endpointMix: top(endpoints, (v) => v, 10).map(([endpoint, count]) => ({ endpoint, count })),
      hourly,
      avgCallsPerWallet: +(pays.length / ws.length).toFixed(1),
      medianGapSec: median(gaps),
      activeDaysAvg: +(activeDays.reduce((s, d) => s + d, 0) / ws.length).toFixed(1),
      topProtocols: top(protocols, (v) => v.wallets).map(([name, v]) => ({ name, category: v.category, wallets: v.wallets })),
      topTokens: top(tokens, (v) => v).map(([symbol, wallets]) => ({ symbol, wallets })),
      topSellers: top(sellers, (v) => v.wallets).map(([name, v]) => ({ name, payTo: v.payTo, wallets: v.wallets, totalUsd: +v.totalUsd.toFixed(2) })),
      summary: "",
      action: { title: "", detail: "" },
    };
    const single = ws.filter((w) => (byPayer.get(w.address)?.length ?? 0) <= 1).length / ws.length;
    const crossBuyers = ws.filter((w) => (w.enrichment?.otherX402Sellers.length ?? 0) > 0).length / ws.length;
    Object.assign(seg, narrate(seg, { single, crossBuyers, mainnetOnly: ws.every((w) => w.source === "mainnet") }));
    return seg;
  });

  segments.sort((a, b) => b.revenueUsd - a.revenueUsd || b.walletCount - a.walletCount);
  return {
    dataset: ds.name,
    totals: { wallets: ds.wallets.length, payments: ds.payments.length, revenueUsd: +totalRevenue.toFixed(2) },
    segments,
  };
}

type Seg = ReturnType<typeof buildSegments>["segments"][number];

function narrate(s: Omit<Seg, "summary" | "action">, x: { single: number; crossBuyers: number; mainnetOnly: boolean }) {
  const total = s.endpointMix.reduce((a, e) => a + e.count, 0) || 1;
  const [e1, e2] = s.endpointMix;
  const ep = (e?: { endpoint: string }) => (e ? e.endpoint.split("/").pop() : "");
  const peak = s.hourly.indexOf(Math.max(...s.hourly));
  const seller = s.topSellers[0]?.name;
  const protos = s.topProtocols.slice(0, 3).map((p) => p.name).join(", ");

  const parts = [
    `${s.walletCount} wallet${s.walletCount === 1 ? "" : "s"}${s.paymentCount ? `, ${pct(s.share)} of revenue` : ""}.`,
    e1 ? `They mostly call ${ep(e1)} (${pct(e1.count / total)} of calls)${e2 ? `, then ${ep(e2)} (${pct(e2.count / total)})` : ""}, about ${s.avgCallsPerWallet} calls per wallet${s.medianGapSec != null ? `, typically every ${human(s.medianGapSec)}` : ""}.` : "",
    s.paymentCount ? `Busiest around ${String(peak).padStart(2, "0")}:00 UTC.` : "",
    x.crossBuyers > 0 ? `${pct(x.crossBuyers)} also pay other x402 sellers${seller ? `, most often ${seller}` : ""}.` : "",
    protos ? `On-chain they use ${protos}.` : "",
    x.mainnetOnly ? "Observed on mainnet paying other sellers; not yet our customers." : "",
  ];
  const summary = parts.filter(Boolean).join(" ");

  const gap = human(s.medianGapSec);
  const actions: Record<string, { title: string; detail: string }> = {
    traders: {
      title: "Sell a volume tier",
      detail: `Traders call ${ep(e1) || "price"} every ~${gap}. A prepaid pack (e.g. 1,000 calls at $0.007) or a streaming price feed locks in your highest-frequency buyers.`,
    },
    researchers: {
      title: "Bundle sentiment with whales",
      detail: `${e1 ? pct(e1.count / total) : "Most"} of their calls are ${ep(e1) || "sentiment"}${e2 ? ` and ${pct(e2.count / total)} are ${ep(e2)}` : ""}. One bundled call at $0.015 saves a round trip and raises spend per request.`,
    },
    "whale-watchers": {
      title: "Offer push alerts instead of polling",
      detail: `They poll every ~${gap}, around the clock. A paid webhook subscription delivers alerts the moment they happen and turns polling into recurring revenue.`,
    },
    portfolio: {
      title: "Launch a portfolio snapshot endpoint",
      detail: `They call price, sentiment and whales together. A single /snapshot at $0.025 replaces three calls and fits how they rebalance.`,
    },
    "power-users": {
      title: "Partner with the sellers they already use",
      detail: `${seller ? `They also buy from ${seller}${s.topSellers[1] ? ` and ${s.topSellers[1].name}` : ""}. ` : ""}Co-list or bundle with those APIs; these agents already pay for data across providers.`,
    },
    casual: {
      title: "Convert one-off buyers",
      detail: `${pct(x.single)} made a single call. Offer the first few calls free, or a starter pack, to turn a test into a habit.`,
    },
  };
  return { summary, action: actions[s.key]! };
}
