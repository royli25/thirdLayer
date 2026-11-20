import type { Enrichment } from "../enrich/enrich";

export type DatasetName = "real" | "demo";

export type PaymentView = {
  payer: string;
  txHash: string;
  endpoint: string;
  amountUsd: number;
  requestId: string;
  ts: string;
  network: string;
  onchainConfirmed: boolean;
};

export type ExternalPaymentView = { payer: string; payTo: string; seller: string; amountUsd: number; ts: string; txHash: string; network: string };

export type WalletView = {
  address: string;
  source: "live" | "mainnet";
  persona: string;
  score: number;
  firstSeen: string;
  lastSeen: string;
  flagged: boolean;
  enrichmentStatus: "pending" | "done" | "error";
  enrichment: Enrichment | null;
};

export type Dataset = {
  name: DatasetName;
  wallets: WalletView[];
  payments: PaymentView[]; // first-party: paid to us
  external: ExternalPaymentView[]; // observed payments to other x402 sellers
};
