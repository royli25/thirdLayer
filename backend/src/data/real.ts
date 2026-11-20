// Real dataset: live devnet payments to our API + real Solana-mainnet x402 payers.
import { db, type PaymentRow, type WalletRow } from "../db";
import type { Dataset } from "./types";

export function loadReal(): Dataset {
  const wallets = (db.query("SELECT * FROM wallets").all() as WalletRow[]).map((w) => ({
    address: w.address,
    source: w.source,
    persona: w.persona,
    score: w.score,
    firstSeen: w.first_seen,
    lastSeen: w.last_seen,
    flagged: !!w.flagged,
    enrichmentStatus: w.enrichment_status,
    enrichment: w.enrichment_json ? JSON.parse(w.enrichment_json) : null,
  }));
  const payments = (db.query("SELECT * FROM payments ORDER BY ts DESC").all() as PaymentRow[]).map((p) => ({
    payer: p.payer,
    txHash: p.tx_hash,
    endpoint: p.endpoint,
    amountUsd: p.amount_usd,
    requestId: p.request_id,
    ts: p.ts,
    network: p.network,
    onchainConfirmed: !!p.onchain_confirmed,
  }));
  const tracked = new Set(wallets.map((w) => w.address));
  const external = (db.query("SELECT * FROM external_payments ORDER BY ts DESC").all() as any[])
    .filter((e) => tracked.has(e.payer))
    .map((e) => ({ payer: e.payer, payTo: e.pay_to, seller: e.seller, amountUsd: e.amount_usd, ts: e.ts, txHash: e.tx_hash, network: e.network }));
  return { name: "real", wallets, payments, external };
}
