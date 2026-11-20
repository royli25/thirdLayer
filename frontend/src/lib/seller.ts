import { API } from "@/lib/api";

export interface Captured {
  endpoint: string;
  requestId: string;
  userAgent: string | null;
  client: string | null;
  params: Record<string, string>;
  analyzed: boolean;
  label: string | null;
}

export interface Analysis {
  address: string;
  category: string;
  label: string;
  persona: string;
  score: number;
  confidence: number;
  reasons: string[];
  ranking: { category: string; label: string; weight: number }[];
  evidence: { step: string; source: "sdk" | "chain" | "model"; lines: string[] }[];
  analyzedAt: string;
}

export async function analyze(address: string): Promise<boolean> {
  try { const r = await fetch(`${API}/wallets/${address}/analyze`, { method: "POST" }); return r.ok; } catch { return false; }
}
export async function getAnalysis(address: string): Promise<Analysis | null> {
  try { const r = await fetch(`${API}/wallets/${address}/analysis`); return r.ok ? (await r.json()).analysis : null; } catch { return null; }
}

/** "symbols=SOL,JUP · 1m" — compact view of what the request asked for. */
export const paramSummary = (p: Record<string, string> | undefined) =>
  !p ? "" : Object.entries(p).map(([k, v]) => (k === "min_usd" ? `≥$${(Number(v) / 1e6).toFixed(Number(v) >= 1e6 ? 1 : 2)}M` : v)).join(" · ");
export interface InflowRow { txHash: string; from: string | null; amountUsd: number; ts: string; slot: number; captured: Captured | null }
export interface OnchainResponse {
  sdkEnabled: boolean;
  payTo: string;
  totals: { payments: number; revenueUsd: number; senders: number; captured: number };
  rows: InflowRow[];
}

export async function getOnchain(): Promise<OnchainResponse | null> {
  try {
    const r = await fetch(`${API}/seller/onchain?limit=40`);
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
}

export async function getSdk(): Promise<boolean | null> {
  try {
    const r = await fetch(`${API}/sdk`);
    return r.ok ? (await r.json()).enabled : null;
  } catch {
    return null;
  }
}

export async function setSdk(enabled: boolean): Promise<boolean | null> {
  try {
    const r = await fetch(`${API}/sdk`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) });
    return r.ok ? (await r.json()).enabled : null;
  } catch {
    return null;
  }
}

export const SEGMENT_LABEL: Record<string, string> = {
  traders: "Traders",
  researchers: "Researchers",
  "whale-watchers": "Whale watchers",
  portfolio: "Portfolio managers",
  "power-users": "x402 power users",
  casual: "Occasional buyers",
};
