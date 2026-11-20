/**
 * AI-agent payers. Each agent has its own Solana wallet and a persona that
 * determines which paid endpoints it buys. Payments go through real x402:
 * 402 -> sign USDC transfer -> retry -> facilitator settles on Solana devnet.
 */
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config";

export const PERSONAS: Record<string, { mix: Record<string, number>; label: string }> = {
  "trading-bot": { label: "High-frequency trading bot", mix: { price: 0.8, sentiment: 0.1, whales: 0.1 } },
  "research-agent": { label: "Market research agent", mix: { sentiment: 0.7, whales: 0.2, price: 0.1 } },
  "whale-watcher": { label: "Whale-tracking alert bot", mix: { whales: 0.75, price: 0.25 } },
  "portfolio-agent": { label: "Portfolio rebalancing agent", mix: { price: 0.4, sentiment: 0.3, whales: 0.3 } },
  "news-scraper": { label: "News & sentiment scraper", mix: { sentiment: 0.9, price: 0.1 } },
  "hero-agent": { label: "Real wallet · mainnet history", mix: { price: 0.4, sentiment: 0.3, whales: 0.3 } },
  "claude-assistant": { label: "Claude (via MCP)", mix: { "x402-pulse": 0.7, price: 0.3 } },
};

export type AgentKey = { name: string; persona: string; address: string; secretKey: string };

/** 64-byte (seed||pubkey) Ed25519 keypair, Solana CLI compatible. */
async function newKeypairBytes(): Promise<Uint8Array> {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as unknown as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const out = new Uint8Array(64);
  out.set(pkcs8.slice(-32), 0);
  out.set(pub, 32);
  return out;
}

export async function generateAgents(count: number): Promise<AgentKey[]> {
  const names = Object.keys(PERSONAS);
  const agents: AgentKey[] = [];
  for (let i = 0; i < count; i++) {
    const persona = names[i % names.length]!;
    const bytes = await newKeypairBytes();
    const signer = await createKeyPairSignerFromBytes(bytes);
    agents.push({ name: `${persona}-${String(i + 1).padStart(2, "0")}`, persona, address: signer.address, secretKey: base58.encode(bytes) });
  }
  return agents;
}

/**
 * Optional demo agent backed by a real wallet (DEMO_HERO_SECRET_KEY in .env, base58 or JSON byte array).
 * It pays on devnet; its trace shows the same pubkey's real mainnet footprint. The secret is never logged or served.
 */
let hero: AgentKey | null | undefined;
async function loadHero(): Promise<AgentKey | null> {
  if (hero !== undefined) return hero;
  const raw = process.env.DEMO_HERO_SECRET_KEY?.trim();
  if (!raw) return (hero = null);
  try {
    const bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw) as number[]) : base58.decode(raw);
    const signer = await createKeyPairSignerFromBytes(bytes);
    hero = { name: "hero-agent", persona: "hero-agent", address: signer.address, secretKey: base58.encode(bytes) };
    console.log(`[agents] hero agent loaded: ${signer.address}`);
  } catch {
    console.error("[agents] DEMO_HERO_SECRET_KEY is set but invalid (expected 64-byte base58 or JSON array)");
    hero = null;
  }
  return hero;
}
await loadHero();

export function loadAgents(): AgentKey[] {
  const agents: AgentKey[] = existsSync(config.agentKeysPath) ? JSON.parse(readFileSync(config.agentKeysPath, "utf8")) : [];
  return hero ? [...agents, hero] : agents;
}

export function saveAgents(agents: AgentKey[]) {
  agents = agents.filter((a) => a.persona !== "hero-agent"); // never persist the real key
  mkdirSync(dirname(config.agentKeysPath), { recursive: true });
  writeFileSync(config.agentKeysPath, JSON.stringify(agents, null, 2));
}

const fetchers = new Map<string, typeof fetch>();
async function paidFetchFor(agent: AgentKey) {
  let f = fetchers.get(agent.address);
  if (!f) {
    const signer = await createKeyPairSignerFromBytes(base58.decode(agent.secretKey));
    const client = new x402Client().register("solana:*", new ExactSvmScheme(signer, { rpcUrl: config.devnetRpc }));
    f = wrapFetchWithPayment(fetch, client) as typeof fetch;
    fetchers.set(agent.address, f);
  }
  return f;
}

export function pickEndpoint(persona: string): string {
  const mix = PERSONAS[persona]?.mix ?? { price: 1 };
  let r = Math.random();
  for (const [ep, w] of Object.entries(mix)) {
    if ((r -= w) <= 0) return `/api/paid/${ep}`;
  }
  return `/api/paid/${Object.keys(mix)[0]}`;
}

/** One paid call by one agent. Returns the response JSON + settlement header. */
export async function agentCall(agent: AgentKey, endpoint: string, requestId = crypto.randomUUID(), userAgent?: string) {
  const f = await paidFetchFor(agent);
  const res = await f(`${config.publicBaseUrl}${endpoint}`, {
    // Neutral headers: nothing here reveals what kind of agent this is. The classifier must infer it.
    headers: {
      "x-request-id": requestId,
      "user-agent": userAgent ?? (agent.persona === "claude-assistant" ? "claude-mcp/thirdlayer-data" : "node"),
    },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, requestId, settlement: res.headers.get("PAYMENT-RESPONSE") };
}
