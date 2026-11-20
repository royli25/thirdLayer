/**
 * thirdLayer SDK — the "few lines" a seller adds in front of their x402 paywall.
 *
 *   app.use(thirdLayer.track({ ingest: (e) => ... }))   // BEFORE paymentMiddleware
 *   app.use(paymentMiddleware(routes, resourceServer))
 *
 * It observes every request to a paid route:
 *  - 402 responses   -> "payment_required" (demand signal, even if the agent never pays)
 *  - settled payments -> "payment_settled" with payer wallet, tx signature, endpoint, amount
 *
 * This is exactly the first-party attribution (which wallet bought which endpoint)
 * that on-chain-only analytics cannot see.
 */
import type { MiddlewareHandler } from "hono";

/** Request facts only the seller's server can see (never on-chain). */
export type RequestFacts = { params: Record<string, string>; client: string | null; userAgent: string | null };

export type TrackedEvent =
  | ({ kind: "payment_required"; requestId: string; endpoint: string; ts: string } & RequestFacts)
  | { kind: "payment_failed"; requestId: string; endpoint: string; ts: string; reason: string }
  | {
      kind: "payment_settled";
      requestId: string;
      endpoint: string;
      ts: string;
      payer: string;
      txHash: string;
      network: string;
      amountUsd: number;
      agentId: string | null;
    } & RequestFacts;

export type TrackOptions = {
  /** Map of paid path -> USD price (used to label the settled amount). */
  prices: Record<string, number>;
  /** Where events go: an in-process callback and/or a remote ingest URL. */
  ingest?: (e: TrackedEvent) => void | Promise<void>;
  ingestUrl?: string;
  apiKey?: string;
  /** Kill switch: when it returns false the SDK is a no-op (x402 still settles; nothing is captured). */
  enabled?: () => boolean;
};

const decodeSettle = (header: string | null) => {
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
      success: boolean;
      payer?: string;
      transaction: string;
      network: string;
    };
  } catch {
    return null;
  }
};

/**
 * Best-effort client fingerprint from request headers. Clients can send anything, so this is a
 * signal, not proof — but most agent frameworks don't bother to disguise themselves.
 */
export function parseClient(ua: string | null): string | null {
  if (!ua) return null;
  const rules: [RegExp, string][] = [
    [/^claude-mcp/i, "Claude (MCP)"],
    [/langchain/i, "LangChain"],
    [/crewai/i, "CrewAI"],
    [/eliza/i, "ElizaOS"],
    [/x402-fetch/i, "x402 fetch SDK"],
    [/python-httpx/i, "Python (httpx)"],
    [/python-requests/i, "Python (requests)"],
    [/axios/i, "Node (axios)"],
    [/undici|^node$/i, "Node (fetch)"],
    [/Go-http-client/i, "Go"],
    [/curl/i, "curl"],
  ];
  for (const [re, name] of rules) if (re.test(ua)) return name;
  return ua.split(/[\s/]/)[0] || null;
}

export const thirdLayer = {
  track(opts: TrackOptions): MiddlewareHandler {
    const send = async (e: TrackedEvent) => {
      try {
        await opts.ingest?.(e);
        if (opts.ingestUrl) {
          await fetch(opts.ingestUrl, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey ?? ""}` },
            body: JSON.stringify(e),
          });
        }
      } catch (err) {
        console.error("[thirdLayer] ingest failed", err);
      }
    };

    return async (c, next) => {
      const endpoint = c.req.path;
      if (!(endpoint in opts.prices)) return next();
      if (opts.enabled && !opts.enabled()) return next();

      const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
      c.set("requestId" as never, requestId as never);
      await next();

      const ts = new Date().toISOString();
      const userAgent = c.req.header("user-agent") ?? null;
      const facts: RequestFacts = { params: c.req.query(), client: parseClient(userAgent), userAgent };
      c.header("x-thirdlayer-request-id", requestId);

      const paid = c.req.header("PAYMENT-SIGNATURE") ?? c.req.header("X-PAYMENT");
      if (c.res.status === 402) {
        if (!paid) {
          void send({ kind: "payment_required", requestId, endpoint, ts, ...facts });
          return;
        }
        // A payment was attached but rejected (verify/settle failed, e.g. insufficient USDC).
        let reason = "payment_rejected";
        try {
          const hdr = c.res.headers.get("PAYMENT-REQUIRED");
          const j = hdr ? JSON.parse(Buffer.from(hdr, "base64").toString("utf8")) : await c.res.clone().json();
          reason = j?.error ?? j?.errorReason ?? reason;
        } catch {}
        void send({ kind: "payment_failed", requestId, endpoint, ts, reason });
        return;
      }
      const settle = decodeSettle(c.res.headers.get("PAYMENT-RESPONSE") ?? c.res.headers.get("X-PAYMENT-RESPONSE"));
      if (settle?.success && settle.payer) {
        void send({
          kind: "payment_settled",
          requestId,
          endpoint,
          ts,
          payer: settle.payer,
          txHash: settle.transaction,
          network: settle.network,
          amountUsd: opts.prices[endpoint] ?? 0,
          agentId: c.req.header("x-agent-id") ?? null,
          ...facts,
        });
      }
    };
  },
};
