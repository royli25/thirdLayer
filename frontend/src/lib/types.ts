export type Source = "live" | "mainnet";

export interface WalletSummary {
  address: string;
  source: Source;
  persona: string;
  score: number;
  firstSeen: string;
  lastSeen: string;
  paymentCount: number;
  totalPaidUsd: number;
  flagged: boolean;
}

export interface Payment {
  txHash: string;
  endpoint: string;
  amountUsd: number;
  requestId: string;
  ts: string;
  network: string;
  onchainConfirmed?: boolean;
}

export interface WalletProfile extends WalletSummary {
  payments: Payment[];
  chains: { chain: string; txCount: number; firstTx: string | null }[];
  protocols: { name: string; category: string; interactions: number }[];
  tokens: { symbol: string; balanceUsd: number }[];
  otherX402Sellers: { name: string; payTo: string; payments: number; totalUsd: number }[];
  narrative: string | null;
  usage?: {
    segment: string | null;
    byEndpoint: { endpoint: string; count: number }[];
    calls: number;
    spendUsd: number;
    medianGapSec: number | null;
    firstPaid: string | null;
    lastPaid: string | null;
    client: string | null;
  };
  externalPayments?: { payer: string; payTo: string; seller: string; amountUsd: number; ts: string; txHash: string; network: string }[];
  enrichmentStatus: "pending" | "done" | "error";
}

export type EnrichStep = "history" | "x402_sellers" | "protocols" | "score" | "narrative";

export type ServerEvent =
  | { type: "payment_required"; data: { endpoint: string; requestId: string; ts: string } }
  | { type: "payment_settled"; data: { payer: string; txHash: string; endpoint: string; amountUsd: number; requestId: string; ts: string; network: string } }
  | { type: "onchain_confirmed"; data: { txHash: string; payer: string; amountUsd: number; source: string; ts: string } }
  | { type: "wallet_flagged"; data: { address: string; ts: string } }
  | { type: "enrichment_step"; data: { address: string; step: EnrichStep; status: "running" | "done"; ts: string } }
  | { type: "enrichment_done"; data: { address: string; ts: string } }
  | { type: "payment_failed"; data: { requestId: string; reason: string; ts: string } }
  | { type: "analysis_step"; data: { address: string; step: string; status: "running" | "done"; source: "sdk" | "chain" | "model" | null; lines: string[]; ts: string } }
  | { type: "analysis_done"; data: { address: string; category: string; label: string; score: number; ts: string } }
  | { type: "agent_response"; data: { requestId: string; endpoint: string; status: number; body: unknown; txHash: string; payer: string; amountUsd: number; ts: string } };

export const EVENT_TYPES: ServerEvent["type"][] = [
  "payment_required", "payment_settled", "onchain_confirmed", "wallet_flagged", "enrichment_step", "enrichment_done", "payment_failed", "agent_response", "analysis_step", "analysis_done",
];
