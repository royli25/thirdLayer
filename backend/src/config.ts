// Central config. All values come from backend/.env (Bun loads it automatically).

export const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as const;
export const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" as const;

export const USDC_MINT = {
  devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  mainnet: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
} as const;

const env = (k: string, fallback = "") => process.env[k]?.trim() || fallback;

export const config = {
  port: Number(env("PORT", "4000")),
  corsOrigins: env("CORS_ORIGINS", "http://localhost:3000,http://localhost:3100").split(","),
  publicBaseUrl: env("PUBLIC_BASE_URL", `http://localhost:${env("PORT", "4000")}`),

  facilitatorUrl: env("FACILITATOR_URL", "https://facilitator.payai.network"),
  // Seller wallet that receives USDC. Required.
  payTo: env("PAY_TO_ADDRESS"),

  // RPC endpoints. Use QuickNode endpoints for reliability (public RPCs rate-limit hard).
  devnetRpc: env("SOLANA_DEVNET_RPC_URL", "https://api.devnet.solana.com"),
  mainnetRpc: env("SOLANA_MAINNET_RPC_URL", "https://api.mainnet-beta.solana.com"),

  // Shared secret QuickNode Streams sends in the `x-qn-token` header (set as a custom header on the stream).
  quicknodeStreamToken: env("QUICKNODE_STREAM_TOKEN"),

  anthropicApiKey: env("ANTHROPIC_API_KEY"),
  anthropicModel: env("ANTHROPIC_MODEL", "claude-opus-5-5"),

  dbPath: env("DB_PATH", "./data/thirdlayer.sqlite"),
  agentKeysPath: env("AGENT_KEYS_PATH", "./data/agents.json"),
};

export const PAID_ROUTES = {
  "/api/paid/price": { price: "$0.01", amountUsd: 0.01, description: "Real-time SOL/token price feed" },
  "/api/paid/sentiment": { price: "$0.01", amountUsd: 0.01, description: "Market sentiment score" },
  "/api/paid/whales": { price: "$0.01", amountUsd: 0.01, description: "Whale wallet movement alerts" },
  "/api/paid/x402-pulse": { price: "$0.01", amountUsd: 0.01, description: "Live x402 payment activity on Solana mainnet (last 24h)" },
} as const;

export type PaidPath = keyof typeof PAID_ROUTES;
