/**
 * Other (non-us) x402 sellers on Solana devnet, used to give demo agents a real purchase
 * history elsewhere. Each has its own payTo wallet. Our SDK does NOT track them: they are
 * separate businesses that just happen to be hosted on this server under /ext/*.
 * Created by `bun run simulate` (data/ext-sellers.json).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ExtSeller = { key: string; name: string; path: string; price: string; amountUsd: number; description: string; payTo: string };

export const EXT_SELLERS_FILE = join(import.meta.dir, "../data/ext-sellers.json");

export const EXT_SELLER_DEFS: Omit<ExtSeller, "payTo">[] = [
  { key: "pulse-news", name: "Pulse News", path: "/ext/pulse-news/headlines", price: "$0.005", amountUsd: 0.005, description: "Crypto headlines feed" },
  { key: "chain-radar", name: "Chain Radar", path: "/ext/chain-radar/flows", price: "$0.02", amountUsd: 0.02, description: "Cross-chain flow analytics" },
  { key: "gas-oracle", name: "Gas Oracle", path: "/ext/gas-oracle/fees", price: "$0.002", amountUsd: 0.002, description: "Priority fee estimates" },
];

export function loadExtSellers(): ExtSeller[] {
  if (!existsSync(EXT_SELLERS_FILE)) return [];
  try {
    return (JSON.parse(readFileSync(EXT_SELLERS_FILE, "utf8")) as (ExtSeller & { secretKey?: string })[]).map(({ secretKey, ...s }) => s);
  } catch {
    return [];
  }
}
