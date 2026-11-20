/**
 * On-demand customer analysis. Runs only when someone opens a wallet — payments are never
 * auto-categorized on arrival.
 *
 * Steps (each emits `analysis_step` with the evidence it found):
 *   purchases  SDK   which endpoints, how much
 *   params     SDK   what exactly they asked for (query parameters)
 *   client     SDK   which client / framework made the calls
 *   cadence    SDK   timing between calls, bursts
 *   pricing    SDK   price quotes seen vs paid for the endpoints they use
 *   onchain    chain wallet history, protocols, other x402 sellers (real RPC reads)
 *   decide           transparent weighted rules -> customer type + the reasons that drove it
 */
import { bus, now } from "../bus";
import { db, getWallet, paymentsFor, type PaymentRow } from "../db";
import { computeScore, enrichWallet, type Enrichment } from "./enrich";
import { parseClient } from "../sdk/thirdlayer";

export const ANALYSIS_STEPS = ["purchases", "params", "client", "cadence", "pricing", "onchain", "decide"] as const;
export type AnalysisStep = (typeof ANALYSIS_STEPS)[number];
export type Evidence = { step: AnalysisStep; source: "sdk" | "chain" | "model"; lines: string[] };

export const CATEGORIES = {
  traders: { label: "Trader", persona: "trading-bot" },
  researchers: { label: "Researcher", persona: "research-agent" },
  "whale-watchers": { label: "Whale watcher", persona: "whale-watcher" },
  portfolio: { label: "Portfolio manager", persona: "portfolio-agent" },
  "power-users": { label: "x402 power user", persona: "x402-power-agent" },
  casual: { label: "Occasional buyer", persona: "x402-buyer" },
} as const;
type Cat = keyof typeof CATEGORIES;

export type Analysis = {
  address: string;
  category: Cat;
  label: string;
  persona: string;
  score: number;
  confidence: number; // 0..1, share of the winning category's weight
  reasons: string[];
  ranking: { category: Cat; label: string; weight: number }[];
  evidence: Evidence[];
  analyzedAt: string;
};

const short = (ep: string) => ep.replace("/api/paid/", "/");
const pct = (x: number) => `${Math.round(x * 100)}%`;
const human = (s: number) => (s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} d`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const parse = (s: string | null | undefined): Record<string, string> => {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
};
const mode = <T,>(xs: T[]) => {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

function emit(address: string, step: AnalysisStep, status: "running" | "done", ev?: Evidence) {
  bus.emit({ type: "analysis_step", data: { address, step, status, source: ev?.source ?? null, lines: ev?.lines ?? [], ts: now() } });
}

const inflight = new Map<string, Promise<Analysis | null>>();
export function analyzeWallet(address: string): Promise<Analysis | null> {
  const ex = inflight.get(address);
  if (ex) return ex;
  const p = run(address).finally(() => inflight.delete(address));
  inflight.set(address, p);
  return p;
}

async function run(address: string): Promise<Analysis | null> {
  const wallet = getWallet(address);
  if (!wallet) return null;
  const pays = paymentsFor(address).slice().sort((a, b) => a.ts.localeCompare(b.ts));
  const evidence: Evidence[] = [];
  // Steps that only read our own DB are instant; pace them so a person can follow along.
  const step = async (s: AnalysisStep, source: Evidence["source"], fn: () => Promise<string[]> | string[], pace = 650) => {
    emit(address, s, "running");
    const t0 = Date.now();
    const lines = await fn();
    await sleep(Math.max(0, pace - (Date.now() - t0)));
    const ev = { step: s, source, lines };
    evidence.push(ev);
    emit(address, s, "done", ev);
  };

  // ---- features ----
  const n = pays.length;
  const byEp = mode(pays.map((p) => p.endpoint));
  const share = (ep: string) => (n ? (byEp.find(([e]) => e.endsWith(ep))?.[1] ?? 0) / n : 0);
  const params = pays.map((p) => ({ ep: p.endpoint, q: parse(p.params) }));
  const times = pays.map((p) => Date.parse(p.ts));
  const gaps = times.slice(1).map((t, i) => (t - times[i]!) / 1000).sort((a, b) => a - b);
  const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : null;
  const burstGaps = gaps.filter((g) => g < 20).length;
  const bursty = gaps.length >= 3 && burstGaps / gaps.length > 0.35;
  const entropy = (() => {
    if (!n || byEp.length < 2) return 0;
    const h = -byEp.reduce((s, [, c]) => s + (c / n) * Math.log(c / n), 0);
    return h / Math.log(4);
  })();
  const symbolsPerCall = params.filter((p) => p.q.symbols).map((p) => p.q.symbols!.split(",").length);
  const avgSymbols = symbolsPerCall.length ? symbolsPerCall.reduce((a, b) => a + b, 0) / symbolsPerCall.length : 0;
  const intervals = mode(params.map((p) => p.q.interval).filter(Boolean) as string[]);
  const windows = mode(params.map((p) => p.q.window).filter(Boolean) as string[]);
  const minUsd = params.map((p) => Number(p.q.min_usd)).filter((x) => x > 0);
  const avgMinUsd = minUsd.length ? minUsd.reduce((a, b) => a + b, 0) / minUsd.length : 0;
  const realtimeShare = intervals.length ? (intervals.find(([k]) => k === "1m")?.[1] ?? 0) / intervals.reduce((s, [, c]) => s + c, 0) : 0;
  const longWindowShare = windows.length ? windows.filter(([k]) => k === "24h" || k === "7d").reduce((s, [, c]) => s + c, 0) / windows.reduce((s, [, c]) => s + c, 0) : 0;

  await step("purchases", "sdk", () => {
    if (!n) return ["No captured purchases yet"];
    const spend = pays.reduce((s, p) => s + p.amount_usd, 0);
    return [
      `${n} paid call${n === 1 ? "" : "s"} · $${spend.toFixed(2)} total`,
      ...byEp.slice(0, 4).map(([ep, c]) => `${short(ep)} × ${c} (${pct(c / n)})`),
    ];
  });

  await step("params", "sdk", () => {
    const out: string[] = [];
    const syms = mode(params.flatMap((p) => (p.q.symbols ? p.q.symbols.split(",") : [])));
    if (syms.length) out.push(`Tokens requested: ${syms.slice(0, 6).map(([s]) => s).join(", ")} (avg ${avgSymbols.toFixed(1)} per call)`);
    if (intervals.length) out.push(`Price interval: ${intervals.map(([k, c]) => `${k} ×${c}`).join(", ")}`);
    const mkts = mode(params.map((p) => p.q.market).filter(Boolean) as string[]);
    if (mkts.length) out.push(`Sentiment markets: ${mkts.map(([k]) => k).join(", ")}`);
    if (windows.length) out.push(`Pulse window: ${windows.map(([k, c]) => `${k} ×${c}`).join(", ")}`);
    if (minUsd.length) out.push(`Whale threshold: avg $${Math.round(avgMinUsd).toLocaleString()}`);
    return out.length ? out : ["No query parameters sent"];
  });

  await step("client", "sdk", () => {
    const clients = mode(pays.map((p) => p.client ?? parseClient(p.user_agent) ?? "unknown"));
    return clients.length ? clients.map(([c, k]) => `${c} · ${k} call${k === 1 ? "" : "s"}`) : ["No client header"];
  });

  await step("cadence", "sdk", () => {
    if (n < 2) return ["Only one call so far: no rhythm yet"];
    const span = (times.at(-1)! - times[0]!) / 1000;
    const hours = new Set(pays.map((p) => new Date(p.ts).getUTCHours()));
    return [
      `Median gap between calls: ${human(medianGap!)}`,
      bursty ? `Bursty: ${pct(burstGaps / gaps.length)} of calls come within 20s of the previous one` : "Steady: calls are evenly spaced",
      `Active across ${hours.size} hour${hours.size === 1 ? "" : "s"} of the day · first to last call ${human(span)}`,
    ];
  });

  await step("pricing", "sdk", () => {
    const eps = byEp.slice(0, 2).map(([ep]) => ep);
    if (!eps.length) return ["No price quotes for its endpoints yet"];
    return eps.map((ep) => {
      const row = db.query("SELECT COUNT(*) AS seen, SUM(paid) AS paid FROM quotes WHERE endpoint=?").get(ep) as { seen: number; paid: number | null };
      const conv = row.seen ? (row.paid ?? 0) / row.seen : 0;
      if (!row.seen) return `${short(ep)}: no price quotes logged yet`;
      return `${short(ep)}: ${row.seen} price quotes shown across all callers, ${row.paid ?? 0} paid (${pct(conv)} convert)`;
    });
  });

  let e: Enrichment | null = null;
  await step("onchain", "chain", async () => {
    await enrichWallet(address); // real RPC reads (cached per tx)
    const w = getWallet(address);
    e = w?.enrichment_json ? (JSON.parse(w.enrichment_json) as Enrichment) : null;
    if (!e) return ["Could not read on-chain history"];
    const out = e.chains.map((c) => `${c.chain}: ${c.txCount} transactions`);
    const protos = e.protocols.filter((p) => p.category !== "core");
    out.push(protos.length ? `Protocols: ${protos.slice(0, 4).map((p) => `${p.name} (${p.category})`).join(", ")}` : "No DeFi protocol activity found");
    out.push(e.otherX402Sellers.length ? `Also pays x402 sellers: ${e.otherX402Sellers.map((s) => `${s.name} ×${s.payments}`).join(", ")}` : "Pays no other known x402 sellers");
    return out;
  }, 400);

  // ---- decide: weighted rules, every contribution is a stated reason ----
  const enr = e as Enrichment | null;
  const cats = new Map<string, number>();
  for (const p of enr?.protocols ?? []) cats.set(p.category, (cats.get(p.category) ?? 0) + p.interactions);
  const sellers = enr?.otherX402Sellers.length ?? 0;
  const W: Record<Cat, { w: number; why: string[] }> = {
    traders: { w: 0, why: [] }, researchers: { w: 0, why: [] }, "whale-watchers": { w: 0, why: [] },
    portfolio: { w: 0, why: [] }, "power-users": { w: 0, why: [] }, casual: { w: 0, why: [] },
  };
  const add = (c: Cat, w: number, why: string) => { if (w > 0.05) { W[c].w += w; W[c].why.push(why); } };

  add("traders", 2 * share("/price"), `${pct(share("/price"))} of calls are /price`);
  if (medianGap != null && medianGap <= 120) add("traders", 1, `calls every ~${human(medianGap)}`);
  if (realtimeShare > 0.5) add("traders", 1, `asks for 1-minute price intervals`);
  if ((cats.get("dex") ?? 0) + (cats.get("dex-aggregator") ?? 0) + (cats.get("perps") ?? 0) > 0) add("traders", 0.6, "trades on DEXs on-chain");

  add("researchers", 2 * (share("/sentiment") + share("/x402-pulse")), `${pct(share("/sentiment") + share("/x402-pulse"))} of calls are sentiment / pulse`);
  if (longWindowShare > 0.5) add("researchers", 0.8, "requests long look-back windows (24h / 7d)");
  if (bursty) add("researchers", 0.5, "buys in bursts, like report generation");

  add("whale-watchers", 2 * share("/whales"), `${pct(share("/whales"))} of calls are /whales`);
  if (avgMinUsd >= 1_000_000) add("whale-watchers", 0.8, `only cares about moves over $${(avgMinUsd / 1e6).toFixed(1)}M`);

  add("portfolio", 1.8 * entropy, `spreads calls across ${byEp.length} endpoints`);
  if (avgSymbols >= 4) add("portfolio", 0.9, `tracks ${avgSymbols.toFixed(0)} tokens per request`);
  if ((cats.get("lending") ?? 0) + (cats.get("staking") ?? 0) > 0) add("portfolio", 0.6, "uses lending / staking on-chain");

  if (sellers >= 2) add("power-users", 1.6 + 0.3 * sellers, `also pays ${sellers} other x402 sellers`);

  if (n <= 2) add("casual", 4, `only ${n} paid call${n === 1 ? "" : "s"} so far`);

  const ranking = (Object.keys(W) as Cat[]).map((c) => ({ category: c, label: CATEGORIES[c].label, weight: +W[c].w.toFixed(2) })).sort((a, b) => b.weight - a.weight);
  const top = ranking[0]!.weight > 0 ? ranking[0]!.category : "casual";
  const total = ranking.reduce((s, r) => s + r.weight, 0) || 1;
  const score = computeScore({
    spendUsd: pays.reduce((s, p) => s + p.amount_usd, 0) + (enr?.otherX402Sellers.reduce((s, x) => s + x.totalUsd, 0) ?? 0),
    paymentCount: n + (enr?.otherX402Sellers.reduce((s, x) => s + x.payments, 0) ?? 0),
    txCount: enr?.chains.reduce((s, c) => s + c.txCount, 0) ?? 0,
    protocolCount: (enr?.protocols ?? []).filter((p) => p.category !== "core").length,
    sellerCount: sellers,
    ageDays: Number(enr?.signals?.ageDays ?? 0),
  });

  const analysis: Analysis = {
    address,
    category: top,
    label: CATEGORIES[top].label,
    persona: CATEGORIES[top].persona,
    score,
    confidence: +(ranking[0]!.weight / total).toFixed(2),
    reasons: W[top].why.length ? W[top].why : ["no strong signal yet"],
    ranking,
    evidence,
    analyzedAt: now(),
  };
  await step("decide", "model", () => [
    `${analysis.label} · ${pct(analysis.confidence)} of the evidence weight`,
    ...analysis.reasons.map((r) => `because it ${r}`),
    ranking[1] && ranking[1].weight > 0 ? `runner-up: ${ranking[1].label}` : "",
  ].filter(Boolean), 500);

  db.query("UPDATE wallets SET persona=?, score=?, analyzed_at=?, analysis_json=? WHERE address=?").run(
    analysis.persona, score, analysis.analyzedAt, JSON.stringify(analysis), address,
  );
  bus.emit({ type: "analysis_done", data: { address, category: analysis.category, label: analysis.label, score, ts: now() } });
  return analysis;
}

export function getAnalysis(address: string): Analysis | null {
  const w = getWallet(address);
  return w?.analysis_json ? (JSON.parse(w.analysis_json) as Analysis) : null;
}

/** SDK-only facts about a wallet's purchases, shown before any analysis runs. */
export function capturedFacts(rows: PaymentRow[]) {
  return rows.map((p) => ({ endpoint: p.endpoint, params: parse(p.params), client: p.client ?? parseClient(p.user_agent), ts: p.ts, txHash: p.tx_hash }));
}
