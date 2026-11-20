import { db } from "../db";

// Minimal Solana JSON-RPC client with retry/backoff (works with QuickNode or public endpoints).

export type Cluster = "devnet" | "mainnet";

let id = 0;
export async function rpc<T = any>(url: string, method: string, params: unknown[], attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`rpc ${method} http ${res.status}`);
      const body = (await res.json()) as { result?: T; error?: { message: string } };
      if (body.error) throw new Error(`rpc ${method}: ${body.error.message}`);
      return body.result as T;
    } catch (e) {
      lastErr = e;
      await Bun.sleep(400 * 2 ** i);
    }
  }
  throw lastErr;
}

/** Run async fn over items with bounded concurrency. */
export async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]!);
      }
    }),
  );
  return out;
}

export type SigInfo = { signature: string; blockTime: number | null; err: unknown };

export async function getSignatures(url: string, address: string, maxPages = 2): Promise<SigInfo[]> {
  const all: SigInfo[] = [];
  let before: string | undefined;
  for (let p = 0; p < maxPages; p++) {
    const page = await rpc<SigInfo[]>(url, "getSignaturesForAddress", [address, { limit: 1000, before }]);
    all.push(...page);
    if (page.length < 1000) break;
    before = page[page.length - 1]!.signature;
  }
  return all;
}

// Confirmed transactions are immutable: cache them forever so repeated enrichment (and the
// public RPC's rate limits) never re-fetch the same transaction.
db.exec("CREATE TABLE IF NOT EXISTS tx_cache (sig TEXT PRIMARY KEY, json TEXT NOT NULL)");
export async function getParsedTx(url: string, sig: string): Promise<any> {
  const hit = db.query("SELECT json FROM tx_cache WHERE sig=?").get(sig) as { json: string } | null;
  if (hit) return JSON.parse(hit.json);
  const tx = await rpc<any>(url, "getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }], 6);
  if (tx) db.query("INSERT OR IGNORE INTO tx_cache (sig,json) VALUES (?,?)").run(sig, JSON.stringify(tx));
  return tx;
}
