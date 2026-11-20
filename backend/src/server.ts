import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { agentCall, loadAgents, pickEndpoint } from "./agents/agents";
import { fleetAgents, isActive, pickFromMix, requestPath, type Traits } from "./agents/fleet";
import { bus, now, type BusEvent } from "./bus";
import { config, PAID_ROUTES, SOLANA_DEVNET } from "./config";
import { analyzeWallet, ANALYSIS_STEPS, capturedFacts, getAnalysis } from "./enrich/analyze";
import { db, paymentsFor, getSetting, getWallet, insertPayment, insertQuote, markQuotePaid, setSetting, touchWallet } from "./db";
import { sellerInflows } from "./seller/onchain";
import { getPulse } from "./pulse";
import { loadExtSellers } from "./ext-sellers";
import { loadDemo } from "./data/demo";
import { loadReal } from "./data/real";
import { buildSegments, segmentOf, walletSummary } from "./data/segments";
import type { Dataset } from "./data/types";
import { enrichWallet } from "./enrich/enrich";
import { thirdLayer, type TrackedEvent } from "./sdk/thirdlayer";

if (!config.payTo) {
  console.error("PAY_TO_ADDRESS is not set. Run `bun run setup` first (see README).");
  process.exit(1);
}

const app = new Hono();
app.use("*", cors({ origin: config.corsOrigins.includes("*") ? "*" : config.corsOrigins }));

// ---------------------------------------------------------------------------
// Ingest: what the thirdLayer SDK reports
// ---------------------------------------------------------------------------

function ingest(e: TrackedEvent) {
  if (e.kind === "payment_failed") {
    bus.emit({ type: "payment_failed", data: { requestId: e.requestId, reason: e.reason, ts: e.ts } });
    return;
  }
  if (e.kind === "payment_required") {
    // Every price quote is logged: later we can see who saw the price and never paid.
    insertQuote({ request_id: e.requestId, endpoint: e.endpoint, ts: e.ts, user_agent: e.userAgent, client: e.client, params: JSON.stringify(e.params) });
    bus.emit({ type: "payment_required", data: { endpoint: e.endpoint, requestId: e.requestId, ts: e.ts } });
    return;
  }
  const network = e.network === SOLANA_DEVNET ? "solana-devnet" : e.network;
  insertPayment({
    tx_hash: e.txHash,
    payer: e.payer,
    endpoint: e.endpoint,
    amount_usd: e.amountUsd,
    request_id: e.requestId,
    ts: e.ts,
    network,
    user_agent: e.userAgent,
    persona_hint: null, // never store self-declared identity
    params: JSON.stringify(e.params),
    client: e.client,
  });
  markQuotePaid(e.requestId, e.payer);
  bus.emit({
    type: "payment_settled",
    data: { payer: e.payer, txHash: e.txHash, endpoint: e.endpoint, amountUsd: e.amountUsd, requestId: e.requestId, ts: e.ts, network },
  });

  // A new payer becomes a new customer record. It is NOT categorized here: categorization only
  // happens when someone opens the wallet (POST /wallets/:address/analyze).
  const isNew = touchWallet(e.payer, "live", e.ts);
  if (isNew) {
    db.query("UPDATE wallets SET flagged=1 WHERE address=?").run(e.payer);
    bus.emit({ type: "wallet_flagged", data: { address: e.payer, ts: now() } });
  }
}

// ---------------------------------------------------------------------------
// The seller's paid API: x402 paywall + thirdLayer SDK (the "few lines")
// ---------------------------------------------------------------------------
const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: config.facilitatorUrl })).register(
  SOLANA_DEVNET,
  new ExactSvmScheme(),
);

const prices = Object.fromEntries(Object.entries(PAID_ROUTES).map(([p, r]) => [p, r.amountUsd]));
// The thirdLayer SDK. `enabled` lets the demo "uninstall" it at runtime (see /sdk).
let sdkEnabled = getSetting("sdk_enabled", "1") === "1";
app.use("/api/paid/*", thirdLayer.track({ prices, ingest, enabled: () => sdkEnabled }));
app.use(
  "/api/paid/*",
  paymentMiddleware(
    Object.fromEntries(
      Object.entries(PAID_ROUTES).map(([path, r]) => [
        `GET ${path}`,
        {
          accepts: { scheme: "exact", price: r.price, network: SOLANA_DEVNET, payTo: config.payTo, maxTimeoutSeconds: 120 },
          description: r.description,
          mimeType: "application/json",
        },
      ]),
    ),
    resourceServer,
  ),
);

// Other x402 sellers (separate payTo wallets). Deliberately NOT wrapped by thirdLayer.track.
const extSellers = loadExtSellers();
if (extSellers.length) {
  app.use(
    "/ext/*",
    paymentMiddleware(
      Object.fromEntries(
        extSellers.map((x) => [
          `GET ${x.path}`,
          { accepts: { scheme: "exact", price: x.price, network: SOLANA_DEVNET, payTo: x.payTo, maxTimeoutSeconds: 120 }, description: x.description, mimeType: "application/json" },
        ]),
      ),
      resourceServer,
    ),
  );
  for (const x of extSellers) app.get(x.path, (c) => c.json({ seller: x.name, ok: true, ts: now() }));
}

let solCache = { usd: 0, at: 0 };
app.get("/api/paid/price", async (c) => {
  if (Date.now() - solCache.at > 30_000) {
    try {
      const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana,jupiter-exchange-solana,bonk&vs_currencies=usd&include_24hr_change=true");
      const j = (await r.json()) as any;
      solCache = { usd: j.solana?.usd ?? 0, at: Date.now() };
      (solCache as any).raw = j;
    } catch {}
  }
  return c.json({ asset: "SOL", usd: solCache.usd || null, quotes: (solCache as any).raw ?? null, ts: now() });
});
app.get("/api/paid/x402-pulse", async (c) => {
  const pulse = await getPulse();
  return pulse ? c.json(pulse) : c.json({ error: "pulse_unavailable" }, 503);
});
app.get("/api/paid/sentiment", (c) => {
  const score = Math.round(50 + 30 * Math.sin(Date.now() / 3.6e6) + (Math.random() - 0.5) * 10);
  return c.json({ market: "SOL", sentiment: score, label: score > 60 ? "greed" : score < 40 ? "fear" : "neutral", sources: 1240, ts: now() });
});
app.get("/api/paid/whales", (c) =>
  c.json({
    alerts: Array.from({ length: 3 }, () => ({
      wallet: `${Math.random().toString(36).slice(2, 6)}…${Math.random().toString(36).slice(2, 6)}`,
      action: Math.random() > 0.5 ? "accumulate" : "distribute",
      token: ["SOL", "JUP", "BONK", "JTO"][Math.floor(Math.random() * 4)],
      usd: Math.round(250_000 + Math.random() * 4_750_000),
    })),
    ts: now(),
  }),
);

// ---------------------------------------------------------------------------
// Customer-intelligence read API. ?dataset=real (default) | demo
// ---------------------------------------------------------------------------
const pickDataset = (c: { req: { query: (k: string) => string | undefined } }): Dataset =>
  c.req.query("dataset") === "demo" ? loadDemo() : loadReal();

app.get("/segments", (c) => c.json(buildSegments(pickDataset(c))));

app.get("/segments/:key/wallets", (c) => {
  const ds = pickDataset(c);
  const key = c.req.param("key");
  const wallets = ds.wallets
    .filter((w) => segmentOf(w.persona) === key)
    .map((w) => walletSummary(ds, w))
    .sort((a, b) => b.score - a.score);
  return c.json({ wallets });
});

app.get("/payments", (c) => {
  const ds = pickDataset(c);
  const limit = Math.min(500, Number(c.req.query("limit") ?? 20) || 20);
  return c.json({
    total: { count: ds.payments.length, revenueUsd: +ds.payments.reduce((s, p) => s + p.amountUsd, 0).toFixed(2) },
    payments: ds.payments.slice(0, limit),
  });
});

app.get("/wallets", (c) => {
  const ds = pickDataset(c);
  return c.json({ wallets: ds.wallets.map((w) => walletSummary(ds, w)).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)) });
});

app.get("/wallets/:address", (c) => {
  const ds = pickDataset(c);
  const w = ds.wallets.find((x) => x.address === c.req.param("address"));
  if (!w) return c.json({ error: "not_found" }, 404);
  const e = w.enrichment;
  const mine = ds.payments.filter((p) => p.payer === w.address);
  const ext = ds.external.filter((p) => p.payer === w.address);
  const payments = mine.length
    ? mine
    : ext.map((p) => ({ txHash: p.txHash, endpoint: p.seller, amountUsd: p.amountUsd, requestId: "", ts: p.ts, network: p.network, onchainConfirmed: true }));
  // First-party usage: what this wallet buys from us and how. Meaningful even with no on-chain history.
  const byEp = new Map<string, number>();
  for (const p of mine) byEp.set(p.endpoint, (byEp.get(p.endpoint) ?? 0) + 1);
  const times = mine.map((p) => Date.parse(p.ts)).sort((a, b) => a - b);
  const gaps = times.slice(1).map((t, i) => (t - times[i]!) / 1000).sort((a, b) => a - b);
  const client =
    ds.name === "real" && mine.length
      ? (db.query("SELECT user_agent FROM payments WHERE payer=? AND user_agent IS NOT NULL ORDER BY ts DESC LIMIT 1").get(w.address) as { user_agent: string } | null)?.user_agent ?? null
      : null;
  const usage = mine.length
    ? {
        segment: segmentOf(w.persona),
        byEndpoint: [...byEp.entries()].sort((a, b) => b[1] - a[1]).map(([endpoint, count]) => ({ endpoint, count })),
        calls: mine.length,
        spendUsd: +mine.reduce((s, p) => s + p.amountUsd, 0).toFixed(4),
        medianGapSec: gaps.length ? gaps[Math.floor(gaps.length / 2)]! : null,
        firstPaid: new Date(times[0]!).toISOString(),
        lastPaid: new Date(times.at(-1)!).toISOString(),
        client: client?.startsWith("claude-mcp") ? "Claude (MCP)" : client?.startsWith("thirdlayer-agent/") ? `Agent: ${client.split("/")[1]}` : client,
      }
    : null;
  return c.json({
    ...walletSummary(ds, w),
    usage,
    payments,
    externalPayments: ext,
    chains: e?.chains ?? [],
    protocols: e?.protocols ?? [],
    tokens: e?.tokens ?? [],
    otherX402Sellers: e?.otherX402Sellers ?? [],
    narrative: e?.narrative ?? null,
    enrichmentStatus: w.enrichmentStatus,
  });
});

// On-demand analysis: runs when someone opens the wallet. Progress streams over SSE (analysis_step).
app.post("/wallets/:address/analyze", (c) => {
  const addr = c.req.param("address");
  if (!getWallet(addr)) return c.json({ error: "not_found" }, 404);
  void analyzeWallet(addr);
  return c.json({ ok: true, steps: ANALYSIS_STEPS });
});
app.get("/wallets/:address/analysis", (c) => {
  const addr = c.req.param("address");
  const w = getWallet(addr);
  if (!w) return c.json({ error: "not_found" }, 404);
  return c.json({ address: addr, analysis: getAnalysis(addr), captured: capturedFacts(paymentsFor(addr)) });
});

app.post("/wallets/:address/enrich", async (c) => {
  const addr = c.req.param("address");
  if (!getWallet(addr)) return c.json({ error: "not_found" }, 404);
  void enrichWallet(addr);
  return c.json({ ok: true });
});

app.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    const queue: BusEvent[] = [];
    let wake: (() => void) | null = null;
    const unsub = bus.subscribe((e) => {
      queue.push(e);
      wake?.();
    });
    stream.onAbort(() => {
      unsub();
      wake?.();
    });
    await stream.writeSSE({ event: "hello", data: JSON.stringify({ ts: now() }) });
    while (!stream.aborted) {
      if (!queue.length) {
        await Promise.race([new Promise<void>((r) => (wake = r)), Bun.sleep(15_000)]);
        wake = null;
        if (!queue.length) {
          await stream.writeSSE({ event: "ping", data: "{}" });
          continue;
        }
      }
      const e = queue.shift()!;
      await stream.writeSSE({ event: e.type, data: JSON.stringify(e.data) });
    }
  }),
);

// ---------------------------------------------------------------------------
// Demo: run one live agent payment (402 -> sign -> retry -> settle)
// ---------------------------------------------------------------------------
app.post("/demo/trigger", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { persona?: string; endpoint?: string };
  const agents = loadAgents();
  if (!agents.length) return c.json({ error: "no_agents", hint: "run `bun run setup`" }, 400);
  // Default: a random wallet from the simulated fleet, buying according to its own (hidden) traits.
  // Only Claude can be requested by name; persona labels no longer exist for fleet wallets.
  const fleet = fleetAgents();
  const claude = agents.find((a) => a.persona === "claude-assistant");
  const active = fleet.filter((a) => isActive(a.traits));
  const pick = body.persona === "claude-assistant" && claude ? { ...claude, traits: null }
    : (active.length ? active : fleet).length ? (active.length ? active : fleet)[Math.floor(Math.random() * (active.length || fleet.length))]!
    : { ...agents[Math.floor(Math.random() * agents.length)]!, traits: null };
  const { traits, ...agent } = pick as typeof pick & { traits: Traits | null };
  const endpoint = body.endpoint && body.endpoint in PAID_ROUTES ? body.endpoint
    : traits ? pickFromMix(traits.mix) : pickEndpoint(agent.persona);
  const path = traits ? requestPath(endpoint, traits) : endpoint;
  const requestId = crypto.randomUUID();
  const fail = (reason: string) => bus.emit({ type: "payment_failed", data: { requestId, reason, ts: now() } });
  agentCall(agent, path, requestId, traits?.userAgent)
    .then((r) => {
      let settle: { transaction?: string } | null = null;
      try { settle = r.settlement ? JSON.parse(Buffer.from(r.settlement, "base64").toString("utf8")) : null; } catch {}
      bus.emit({
        type: "agent_response",
        data: {
          requestId, endpoint, status: r.status, body: r.body, txHash: settle?.transaction ?? null,
          payer: agent.address, amountUsd: PAID_ROUTES[endpoint as keyof typeof PAID_ROUTES]?.amountUsd ?? 0, ts: now(),
        },
      });
      if (r.status === 200) return;
      console.warn("[demo] agent call status", r.status, JSON.stringify(r.body)?.slice(0, 300));
      if (r.status !== 402) fail(`http_${r.status}`); // 402s are already reported by the SDK
    })
    .catch((err) => {
      console.error("[demo] agent call failed", err);
      fail((err as Error).message?.slice(0, 200) || "client_error");
    });
  return c.json({ requestId, agent: agent.name, payer: agent.address, endpoint });
});

// No persona labels are exposed: fleet wallets are anonymous; Claude is the only named client.
app.get("/demo/agents", (c) => {
  const claude = loadAgents().find((a) => a.persona === "claude-assistant");
  return c.json({
    fleetSize: fleetAgents().length,
    agents: claude ? [{ name: claude.name, persona: claude.persona, address: claude.address, label: "Claude (via MCP)" }] : [],
  });
});

// ---------------------------------------------------------------------------
// QuickNode Streams webhook: independent on-chain confirmation of payments
// ---------------------------------------------------------------------------
app.post("/webhooks/quicknode", async (c) => {
  if (config.quicknodeStreamToken && c.req.header("x-qn-token") !== config.quicknodeStreamToken)
    return c.json({ error: "unauthorized" }, 401);
  const body = (await c.req.json().catch(() => null)) as any;
  const matches: any[] = Array.isArray(body) ? body.flatMap((b) => b?.matches ?? []) : (body?.matches ?? []);
  for (const m of matches) {
    if (!m?.signature) continue;
    const ts = m.blockTime ? new Date(m.blockTime * 1000).toISOString() : now();
    db.query("INSERT OR IGNORE INTO onchain_confirms (tx_hash,payer,amount_usd,slot,ts) VALUES (?,?,?,?,?)").run(
      m.signature,
      m.payer ?? null,
      m.amount ?? null,
      m.slot ?? null,
      ts,
    );
    db.query("UPDATE payments SET onchain_confirmed=1 WHERE tx_hash=?").run(m.signature);
    bus.emit({
      type: "onchain_confirmed",
      data: { txHash: m.signature, payer: m.payer ?? null, amountUsd: m.amount ?? null, source: "quicknode-stream", ts },
    });
  }
  return c.json({ ok: true, received: matches.length });
});

// ---------------------------------------------------------------------------
// Before/after demo: SDK switch + the seller's raw on-chain view
// ---------------------------------------------------------------------------
app.get("/sdk", (c) => c.json({ enabled: sdkEnabled }));
app.post("/sdk", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean };
  sdkEnabled = typeof body.enabled === "boolean" ? body.enabled : !sdkEnabled;
  setSetting("sdk_enabled", sdkEnabled ? "1" : "0");
  bus.emit({ type: "sdk_toggled", data: { enabled: sdkEnabled, ts: now() } });
  console.log(`[sdk] thirdLayer SDK ${sdkEnabled ? "ENABLED" : "DISABLED"}`);
  return c.json({ enabled: sdkEnabled });
});

app.get("/seller/onchain", async (c) => {
  const limit = Math.min(100, Number(c.req.query("limit") ?? 40) || 40);
  const all = await sellerInflows(); // full on-chain history
  const inflows = all.slice(0, limit); // rows shown
  const ds = loadReal();
  const rows = inflows.map((f) => {
    // A capture is permanent: if the SDK recorded this payment, show it, whenever that was.
    const p = db.query("SELECT * FROM payments WHERE tx_hash=?").get(f.txHash) as any;
    const w = p ? ds.wallets.find((x) => x.address === p.payer) : undefined;
    return {
      ...f,
      captured: p
        ? {
            endpoint: p.endpoint,
            requestId: p.request_id,
            userAgent: p.user_agent as string | null,
            client: (p.client as string | null) ?? null,
            params: (() => { try { return p.params ? JSON.parse(p.params) : {}; } catch { return {}; } })() as Record<string, string>,
            // Categorization exists only after someone opened the wallet and it was analyzed.
            analyzed: !!getWallet(p.payer)?.analyzed_at,
            label: (() => { const a = getAnalysis(p.payer); return a?.label ?? null; })(),
          }
        : null,
    };
  });
  // Totals over the FULL history, not just the rows shown.
  const capturedSet = new Set(
    (db.query("SELECT tx_hash FROM payments").all() as { tx_hash: string }[]).map((r) => r.tx_hash),
  );
  const senders = new Set(all.map((r) => r.from).filter(Boolean));
  return c.json({
    sdkEnabled,
    payTo: config.payTo,
    totals: {
      payments: all.length,
      revenueUsd: +all.reduce((s, r) => s + r.amountUsd, 0).toFixed(4),
      senders: senders.size,
      captured: all.filter((r) => capturedSet.has(r.txHash)).length,
    },
    rows,
  });
});

app.get("/health", (c) =>
  c.json({ ok: true, payTo: config.payTo, network: SOLANA_DEVNET, facilitator: config.facilitatorUrl, agents: loadAgents().length }),
);

console.log(`thirdLayer backend on :${config.port}  payTo=${config.payTo}`);
void getPulse(); // warm the paid pulse data
void sellerInflows().catch(() => {}); // warm the seller's on-chain view so the first page load is instant
export default { port: config.port, fetch: app.fetch, idleTimeout: 0 };
