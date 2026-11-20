import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config";

mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new Database(config.dbPath, { create: true });
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
CREATE TABLE IF NOT EXISTS payments (
  tx_hash     TEXT PRIMARY KEY,
  payer       TEXT NOT NULL,
  endpoint    TEXT NOT NULL,
  amount_usd  REAL NOT NULL,
  request_id  TEXT NOT NULL,
  ts          TEXT NOT NULL,
  network     TEXT NOT NULL,
  user_agent  TEXT,
  persona_hint TEXT,
  onchain_confirmed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS payments_payer ON payments(payer);

CREATE TABLE IF NOT EXISTS wallets (
  address     TEXT PRIMARY KEY,
  source      TEXT NOT NULL,          -- live | mainnet
  persona     TEXT NOT NULL DEFAULT 'unknown',
  score       INTEGER NOT NULL DEFAULT 0,
  flagged     INTEGER NOT NULL DEFAULT 0,
  first_seen  TEXT NOT NULL,
  last_seen   TEXT NOT NULL,
  enrichment_status TEXT NOT NULL DEFAULT 'pending',
  enrichment_json   TEXT,             -- chains/protocols/tokens/otherX402Sellers/narrative
  enriched_at TEXT
);

-- Payments observed for mainnet (read-only) wallets: payer -> a known x402 seller.
CREATE TABLE IF NOT EXISTS external_payments (
  tx_hash    TEXT NOT NULL,
  payer      TEXT NOT NULL,
  pay_to     TEXT NOT NULL,
  seller     TEXT NOT NULL,
  amount_usd REAL NOT NULL,
  ts         TEXT NOT NULL,
  network    TEXT NOT NULL,
  PRIMARY KEY (tx_hash, payer, pay_to)
);
CREATE INDEX IF NOT EXISTS external_payments_payer ON external_payments(payer);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS onchain_confirms (
  tx_hash TEXT PRIMARY KEY,
  payer   TEXT,
  amount_usd REAL,
  slot    INTEGER,
  ts      TEXT NOT NULL
);
`);

// SDK-only capture (never visible on-chain). Additive migrations so existing data survives.
for (const sql of [
  "ALTER TABLE payments ADD COLUMN params TEXT", // JSON of the request's query parameters
  "ALTER TABLE payments ADD COLUMN client TEXT", // parsed client family, e.g. 'Claude (MCP)', 'Python httpx'
  "ALTER TABLE wallets ADD COLUMN analyzed_at TEXT", // set only when a human opens the wallet and it is analyzed
  "ALTER TABLE wallets ADD COLUMN analysis_json TEXT", // verdict + evidence from the last analysis
]) {
  try { db.exec(sql); } catch {}
}
db.exec(`
CREATE TABLE IF NOT EXISTS quotes (
  request_id TEXT PRIMARY KEY,
  endpoint   TEXT NOT NULL,
  ts         TEXT NOT NULL,
  user_agent TEXT,
  client     TEXT,
  params     TEXT,
  paid       INTEGER NOT NULL DEFAULT 0,
  payer      TEXT
);
CREATE INDEX IF NOT EXISTS quotes_endpoint ON quotes(endpoint);
`);

export function insertQuote(q: { request_id: string; endpoint: string; ts: string; user_agent: string | null; client: string | null; params: string | null }) {
  db.query("INSERT OR IGNORE INTO quotes (request_id,endpoint,ts,user_agent,client,params) VALUES (?,?,?,?,?,?)").run(
    q.request_id, q.endpoint, q.ts, q.user_agent, q.client, q.params,
  );
}
export function markQuotePaid(requestId: string, payer: string) {
  db.query("UPDATE quotes SET paid=1, payer=? WHERE request_id=?").run(payer, requestId);
}

export type PaymentRow = {
  tx_hash: string;
  payer: string;
  endpoint: string;
  amount_usd: number;
  request_id: string;
  ts: string;
  network: string;
  user_agent: string | null;
  persona_hint: string | null;
  onchain_confirmed: number;
  params?: string | null;
  client?: string | null;
};

export type WalletRow = {
  address: string;
  source: "live" | "mainnet";
  persona: string;
  score: number;
  flagged: number;
  first_seen: string;
  last_seen: string;
  enrichment_status: "pending" | "done" | "error";
  enrichment_json: string | null;
  enriched_at: string | null;
  analyzed_at?: string | null;
  analysis_json?: string | null;
};

export function insertPayment(p: Omit<PaymentRow, "onchain_confirmed">): boolean {
  const res = db
    .query(
      `INSERT OR IGNORE INTO payments (tx_hash,payer,endpoint,amount_usd,request_id,ts,network,user_agent,persona_hint,params,client,onchain_confirmed)
       VALUES ($tx,$payer,$endpoint,$amt,$rid,$ts,$net,$ua,$ph,$params,$client, COALESCE((SELECT 1 FROM onchain_confirms WHERE tx_hash=$tx),0))`,
    )
    .run({
      $tx: p.tx_hash,
      $payer: p.payer,
      $endpoint: p.endpoint,
      $amt: p.amount_usd,
      $rid: p.request_id,
      $ts: p.ts,
      $net: p.network,
      $ua: p.user_agent,
      $ph: p.persona_hint,
      $params: p.params ?? null,
      $client: p.client ?? null,
    });
  return res.changes > 0;
}

/** Upsert wallet; returns true if it is newly created. */
export function touchWallet(address: string, source: "live" | "mainnet", ts: string): boolean {
  const existing = db.query("SELECT address FROM wallets WHERE address=?").get(address);
  if (existing) {
    db.query("UPDATE wallets SET last_seen = MAX(last_seen, ?), first_seen = MIN(first_seen, ?) WHERE address=?").run(
      ts,
      ts,
      address,
    );
    return false;
  }
  db.query("INSERT INTO wallets (address,source,first_seen,last_seen) VALUES (?,?,?,?)").run(address, source, ts, ts);
  return true;
}

export const getWallet = (address: string) =>
  db.query("SELECT * FROM wallets WHERE address=?").get(address) as WalletRow | null;

export const listWallets = () => db.query("SELECT * FROM wallets ORDER BY last_seen DESC").all() as WalletRow[];

export const paymentsFor = (address: string) =>
  db.query("SELECT * FROM payments WHERE payer=? ORDER BY ts DESC").all(address) as PaymentRow[];

export const externalPaymentsFor = (address: string) =>
  db.query("SELECT * FROM external_payments WHERE payer=? ORDER BY ts DESC").all(address) as {
    tx_hash: string;
    payer: string;
    pay_to: string;
    seller: string;
    amount_usd: number;
    ts: string;
    network: string;
  }[];

export const getSetting = (key: string, fallback: string) =>
  (db.query("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | null)?.value ?? fallback;
export const setSetting = (key: string, value: string) =>
  db.query("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
