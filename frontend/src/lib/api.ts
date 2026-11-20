import { EVENT_TYPES, type Payment, type ServerEvent, type WalletProfile, type WalletSummary } from "./types";
import { PERSONAS, mockTrigger, mockWallet, mockWallets } from "./mock";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

let mode: "live" | "mock" | null = null;
const listeners = new Set<(e: ServerEvent) => void>();
const emit = (e: ServerEvent) => listeners.forEach((l) => l(e));

let checkedAt = 0;
export async function detectMode(): Promise<"live" | "mock"> {
  // Cache "live" forever; re-probe "mock" every 5s so a late-starting backend is picked up.
  if (mode === "live" || (mode === "mock" && Date.now() - checkedAt < 5000)) return mode;
  checkedAt = Date.now();
  if (typeof window !== "undefined" && new URLSearchParams(location.search).has("mock")) return (mode = "mock");
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(`${API}/wallets`, { signal: ctl.signal });
    clearTimeout(t);
    mode = r.ok ? "live" : "mock";
  } catch { mode = "mock"; }
  return mode;
}

export async function getWallets(): Promise<WalletSummary[]> {
  if ((await detectMode()) === "mock") return mockWallets();
  const r = await fetch(`${API}/wallets`);
  return (await r.json()).wallets;
}

export async function getPayments(): Promise<(Payment & { payer: string; onchainConfirmed?: boolean })[]> {
  if ((await detectMode()) === "mock") return [];
  try { const r = await fetch(`${API}/payments?limit=20`); return r.ok ? (await r.json()).payments : []; } catch { return []; }
}

export async function getWallet(address: string, dataset?: "real" | "demo"): Promise<WalletProfile | null> {
  if ((await detectMode()) === "mock") return structuredClone(mockWallet(address));
  try {
    const r = await fetch(`${API}/wallets/${address}${dataset ? `?dataset=${dataset}` : ""}`);
    return r.ok ? r.json() : null;
  } catch { return null; }
}

export interface Agent { persona: string; label: string; address: string | null }
const MOCK_LABELS: Record<string, string> = {
  "trading-bot": "High-frequency trading bot", "research-agent": "Market research agent",
  "news-scraper": "News & sentiment scraper", "arb-searcher": "MEV / arbitrage searcher",
};

/** One entry per persona (first agent wins). */
export async function getAgents(): Promise<Agent[]> {
  const mock = () => PERSONAS.map((p) => ({ persona: p, label: MOCK_LABELS[p] ?? p, address: null }));
  if ((await detectMode()) === "mock") return mock();
  try {
    const r = await fetch(`${API}/demo/agents`);
    const { agents } = (await r.json()) as { agents: { persona: string; label: string; address: string }[] };
    const seen = new Map<string, Agent>();
    agents.forEach((a) => { if (!seen.has(a.persona)) seen.set(a.persona, { persona: a.persona, label: a.label, address: a.address }); });
    return [...seen.values()];
  } catch { return mock(); }
}

/** Returns an error message, or null on success. */
export async function trigger(persona: string): Promise<string | null> {
  if ((await detectMode()) === "mock") { void mockTrigger(persona, emit); return null; }
  try {
    const r = await fetch(`${API}/demo/trigger`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ persona }) });
    if (!r.ok) { const t = await r.text(); return `trigger failed (${r.status}) ${t.slice(0, 160)}`; }
    return null;
  } catch (e) { return `trigger failed: ${(e as Error).message}`; }
}

let es: EventSource | null = null;
export function subscribe(fn: (e: ServerEvent) => void) {
  listeners.add(fn);
  void detectMode().then((m) => {
    if (m !== "live" || es) return;
    es = new EventSource(`${API}/events`);
    EVENT_TYPES.forEach((t) => es!.addEventListener(t, (ev) => {
      try { emit({ type: t, data: JSON.parse((ev as MessageEvent).data) } as ServerEvent); } catch {}
    }));
  });
  return () => { listeners.delete(fn); };
}

export const short = (a: string, n = 4) => (a.length > 2 * n + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a);
export const explorer = (sig: string, network: string) =>
  `https://explorer.solana.com/tx/${sig}${network.includes("devnet") ? "?cluster=devnet" : ""}`;
export const accountUrl = (addr: string, network = "solana-mainnet") =>
  `https://explorer.solana.com/address/${addr}${network.includes("devnet") ? "?cluster=devnet" : ""}`;
