/**
 * Simulated customer fleet.
 *
 * Each wallet gets behavioral traits sampled INDEPENDENTLY (no persona label is chosen first):
 * endpoint preferences, call cadence, active hours, burstiness, lifetime, budget, other sellers
 * it also buys from, and the HTTP client it uses. Nothing about these traits is sent to our API
 * or stored with payments — the classifier has to infer who each wallet is from what it does.
 *
 * Traits live in data/fleet.json (keys stay in data/agents.json, like every other agent).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateAgents, loadAgents, saveAgents, type AgentKey } from "./agents";

export const FLEET_FILE = join(import.meta.dir, "../../data/fleet.json");
export const ENDPOINTS = ["/api/paid/price", "/api/paid/sentiment", "/api/paid/whales", "/api/paid/x402-pulse"] as const;

export type Traits = {
  /** Probability of each paid endpoint per call (sums to 1). */
  mix: Record<(typeof ENDPOINTS)[number], number>;
  /** Mean seconds between sessions (Poisson process). */
  meanGapSec: number;
  /** Calls per session: 1 for steady pollers, several for bursty agents. */
  burst: { p: number; min: number; max: number };
  /** UTC hours the agent runs (wraps midnight). */
  activeHours: { start: number; length: number };
  /** Delay before the first call (new customers keep arriving) and churn after N calls. */
  startDelaySec: number;
  maxCalls: number;
  /** Other x402 sellers this wallet also pays, with a per-session probability. */
  extSellers: { key: string; p: number }[];
  userAgent: string;
  /** What it asks for (query parameters) — visible only to the seller's server. */
  prefs: { symbols: string[]; interval: "1m" | "1h" | "1d"; market: string; window: "1h" | "24h" | "7d"; minUsd: number };
  /** Price sensitivity: chance a session starts with an unpaid price check, and chance it then walks away. */
  probe: { p: number; abandon: number };
};
export type FleetMember = { name: string; address: string; traits: Traits };

// ---------- seeded randomness ----------
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gamma = (r: () => number, k: number): number => {
  // Marsaglia–Tsang for k>=1; boost for k<1.
  if (k < 1) return gamma(r, k + 1) * Math.pow(r(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      const u1 = r(), u2 = r();
      x = Math.sqrt(-2 * Math.log(u1 || 1e-12)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = r();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
};
const logUniform = (r: () => number, lo: number, hi: number) => Math.exp(Math.log(lo) + r() * (Math.log(hi) - Math.log(lo)));

// Clients are drawn independently of behavior — a trading bot can be Python or Go.
const USER_AGENTS = [
  "python-httpx/0.27.2", "python-requests/2.32.3", "axios/1.7.7", "node", "Go-http-client/2.0",
  "x402-fetch/2.31.0", "langchain-x402/0.3.1", "crewai/0.86.0", "eliza-plugin-x402/1.2.0", "undici",
];
const EXT_KEYS = ["pulse-news", "chain-radar", "gas-oracle"];
const TOKENS = ["SOL", "JUP", "BONK", "JTO", "WIF", "PYTH", "RAY", "ORCA", "MSOL", "JITOSOL"];
const MARKETS = ["SOL", "BTC", "ETH", "memecoins", "defi"];

export function sampleTraits(seed: number): Traits {
  const r = rng(seed);
  // Dirichlet mix: small alpha -> specialists, large alpha -> generalists.
  const alpha = logUniform(r, 0.15, 2.5);
  const g = ENDPOINTS.map(() => gamma(r, alpha));
  const sum = g.reduce((a, b) => a + b, 0) || 1;
  const mix = Object.fromEntries(ENDPOINTS.map((e, i) => [e, +(g[i]! / sum).toFixed(4)])) as Traits["mix"];
  const bursty = r() < 0.35;
  return {
    mix,
    meanGapSec: Math.round(logUniform(r, 30, 2400)), // 30s .. 40min between sessions
    burst: bursty ? { p: 0.6, min: 2, max: 2 + Math.floor(r() * 5) } : { p: 0, min: 1, max: 1 },
    activeHours: r() < 0.4 ? { start: 0, length: 24 } : { start: Math.floor(r() * 24), length: 6 + Math.floor(r() * 12) },
    startDelaySec: r() < 0.6 ? 0 : Math.round(logUniform(r, 120, 4 * 3600)),
    maxCalls: r() < 0.15 ? 1 + Math.floor(r() * 2) : Math.round(logUniform(r, 5, 60)), // some try once and leave
    extSellers: EXT_KEYS.filter(() => r() < 0.3).map((key) => ({ key, p: +(0.1 + r() * 0.5).toFixed(2) })),
    userAgent: USER_AGENTS[Math.floor(r() * USER_AGENTS.length)]!,
    prefs: {
      symbols: [...TOKENS].sort(() => r() - 0.5).slice(0, 1 + Math.floor(logUniform(r, 1, 8))),
      interval: (["1m", "1h", "1d"] as const)[Math.floor(r() * 3)]!,
      market: MARKETS[Math.floor(r() * MARKETS.length)]!,
      window: (["1h", "24h", "7d"] as const)[Math.floor(r() * 3)]!,
      minUsd: Math.round(logUniform(r, 50_000, 5_000_000) / 10_000) * 10_000,
    },
    probe: { p: +(r() * 0.5).toFixed(2), abandon: +(r() * 0.7).toFixed(2) },
  };
}

/** The request this wallet would make for an endpoint, with its own query parameters. */
export function requestPath(endpoint: string, t: Traits, r = Math.random): string {
  const q = new URLSearchParams();
  const p = t.prefs;
  if (endpoint.endsWith("/price")) {
    q.set("symbols", (r() < 0.8 ? p.symbols : p.symbols.slice(0, 1)).join(","));
    q.set("interval", p.interval);
  } else if (endpoint.endsWith("/sentiment")) q.set("market", p.market);
  else if (endpoint.endsWith("/whales")) q.set("min_usd", String(p.minUsd));
  else if (endpoint.endsWith("/x402-pulse")) q.set("window", p.window);
  const s = q.toString();
  return s ? `${endpoint}?${s}` : endpoint;
}

export function loadFleet(): FleetMember[] {
  return existsSync(FLEET_FILE) ? (JSON.parse(readFileSync(FLEET_FILE, "utf8")) as FleetMember[]) : [];
}

/** Creates `count` new wallets with neutral names (w-001…) and independently sampled traits. */
export async function createFleet(count: number): Promise<FleetMember[]> {
  const existing = loadFleet();
  const keys = await generateAgents(count);
  const seed0 = Date.now() & 0xffffff;
  const members: FleetMember[] = [];
  const agents = loadAgents().filter((a) => a.persona !== "hero-agent");
  keys.forEach((k, i) => {
    const name = `w-${String(existing.length + i + 1).padStart(3, "0")}`;
    agents.push({ name, persona: "fleet", address: k.address, secretKey: k.secretKey });
    members.push({ name, address: k.address, traits: sampleTraits(seed0 + i * 7919) });
  });
  saveAgents(agents);
  writeFileSync(FLEET_FILE, JSON.stringify([...existing, ...members], null, 2));
  return members;
}

export function fleetAgents(): (AgentKey & { traits: Traits })[] {
  const byName = new Map(loadAgents().map((a) => [a.name, a]));
  return loadFleet().flatMap((m) => {
    const a = byName.get(m.name);
    return a ? [{ ...a, traits: m.traits }] : [];
  });
}

export function pickFromMix(mix: Record<string, number>, r = Math.random()): string {
  for (const [ep, w] of Object.entries(mix)) if ((r -= w) <= 0) return ep;
  return Object.keys(mix)[0]!;
}

export function isActive(t: Traits, d = new Date()): boolean {
  const h = d.getUTCHours();
  const off = (h - t.activeHours.start + 24) % 24;
  return off < t.activeHours.length;
}
