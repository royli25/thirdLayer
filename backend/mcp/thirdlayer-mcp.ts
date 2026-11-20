#!/usr/bin/env bun
/**
 * MCP server that lets Claude BUY data over x402 with its own Solana wallet.
 *
 * Claude can't hold a wallet, so this tool does: when Claude calls `buy_data`, the server
 * requests the paid API, receives HTTP 402, signs a USDC payment on Solana devnet, retries,
 * and returns the data plus the on-chain receipt.
 *
 * stdio transport: never write to stdout except through the MCP SDK.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const ROOT = join(import.meta.dir, "..");
const API = process.env.THIRDLAYER_API ?? "http://localhost:4000";
const RPC = process.env.SOLANA_DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const log = (...a: unknown[]) => console.error("[thirdlayer-mcp]", ...a);

const PRODUCTS = {
  "x402-pulse": { path: "/api/paid/x402-pulse", desc: "Live x402 payment activity on Solana mainnet over the last 24 hours: number of settlements, active sellers, payment sizes, latest payment. Real-time; not in any model's training data." },
  price: { path: "/api/paid/price", desc: "Live token prices (SOL, JUP, BONK) with 24h change." },
  sentiment: { path: "/api/paid/sentiment", desc: "Current crypto market sentiment score (0-100) for SOL." },
  whales: { path: "/api/paid/whales", desc: "Recent whale wallet movement alerts." },
} as const;
type Product = keyof typeof PRODUCTS;

const agent = (JSON.parse(readFileSync(join(ROOT, "data/agents.json"), "utf8")) as { name: string; address: string; secretKey: string }[])
  .find((a) => a.name === "claude-assistant");
if (!agent) {
  log("No claude-assistant wallet. Run: bun scripts/add-claude-agent.ts && bun run fund 2 claude-assistant");
  process.exit(1);
}
const signer = await createKeyPairSignerFromBytes(base58.decode(agent.secretKey));
const paidFetch = wrapFetchWithPayment(fetch, new x402Client().register("solana:*", new ExactSvmScheme(signer, { rpcUrl: RPC })));

const server = new McpServer({ name: "thirdlayer-data", version: "0.1.0" });

server.registerTool(
  "list_data",
  {
    title: "List paid data products",
    description: "List the real-time data products this tool can buy, with prices. Free to call.",
    inputSchema: {},
  },
  async () => ({
    content: [{
      type: "text",
      text: Object.entries(PRODUCTS).map(([k, v]) => `- ${k} ($0.01 USDC per call): ${v.desc}`).join("\n") + `\n\nPaid from wallet ${agent.address} (Solana devnet).`,
    }],
  }),
);

server.registerTool(
  "buy_data",
  {
    title: "Buy real-time data (pays $0.01 via x402)",
    description:
      "Buy a real-time data product over x402. Use this whenever the user asks about live crypto or x402 market data you cannot know from training, e.g. how many x402 payments happened on Solana recently, current token prices, sentiment or whale moves. Each call pays $0.01 USDC on Solana from the assistant's own wallet and returns the data plus a transaction receipt. Tell the user what you paid.",
    inputSchema: { product: z.enum(Object.keys(PRODUCTS) as [Product, ...Product[]]).describe("Which data product to buy") },
  },
  async ({ product }) => {
    const p = PRODUCTS[product];
    try {
      const res = await paidFetch(`${API}${p.path}`, {
        headers: { "x-agent-id": "claude-assistant", "user-agent": "claude-mcp/thirdlayer-data" },
      });
      const body = await res.json().catch(() => null);
      if (res.status !== 200) {
        return { isError: true, content: [{ type: "text", text: `Purchase failed (HTTP ${res.status}): ${JSON.stringify(body)?.slice(0, 400)}` }] };
      }
      let tx: string | null = null;
      const hdr = res.headers.get("PAYMENT-RESPONSE");
      if (hdr) try { tx = JSON.parse(Buffer.from(hdr, "base64").toString("utf8")).transaction ?? null; } catch {}
      const receipt = tx
        ? `Paid $0.01 USDC on Solana devnet from ${agent.address}. Transaction: https://explorer.solana.com/tx/${tx}?cluster=devnet`
        : `Paid $0.01 USDC on Solana devnet from ${agent.address}.`;
      return { content: [{ type: "text", text: `${receipt}\n\nData (${product}):\n${JSON.stringify(body, null, 2)}` }] };
    } catch (e) {
      log("buy_data failed", e);
      return { isError: true, content: [{ type: "text", text: `Purchase failed: ${(e as Error).message}` }] };
    }
  },
);

await server.connect(new StdioServerTransport());
log(`ready · wallet ${agent.address} · api ${API}`);
