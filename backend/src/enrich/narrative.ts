import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import type { PaymentRow } from "../db";
import type { Enrichment } from "./enrich";

export type Input = {
  address: string;
  source: "live" | "mainnet";
  persona: string;
  score: number;
  payments: PaymentRow[];
  enrichment: Enrichment;
};

const client = config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;

function summarize(i: Input) {
  const byEndpoint: Record<string, number> = {};
  for (const p of i.payments) byEndpoint[p.endpoint] = (byEndpoint[p.endpoint] ?? 0) + 1;
  return {
    wallet: i.address,
    source: i.source === "live" ? "paid our x402 API (first-party data)" : "observed paying public x402 sellers on Solana mainnet",
    persona: i.persona,
    customerScore: i.score,
    firstPartyPurchases: { count: i.payments.length, byEndpoint, totalUsd: i.payments.reduce((s, p) => s + p.amount_usd, 0) },
    chains: i.enrichment.chains,
    protocols: i.enrichment.protocols,
    holdings: i.enrichment.tokens,
    otherX402Sellers: i.enrichment.otherX402Sellers,
    signals: i.enrichment.signals,
  };
}

export function template(i: Input): string {
  const s = summarize(i);
  const eps = Object.entries(s.firstPartyPurchases.byEndpoint)
    .sort((a, b) => b[1] - a[1])
    .map(([e, n]) => `${e.split("/").pop()} ×${n}`)
    .join(", ");
  const prot = i.enrichment.protocols.filter((p) => p.category !== "core").slice(0, 3).map((p) => p.name);
  const sellers = i.enrichment.otherX402Sellers.slice(0, 3).map((x) => x.name);
  const holdingsUsd = i.enrichment.tokens.reduce((a, t) => a + t.balanceUsd, 0);
  const parts = [
    `Likely a ${i.persona.replace(/-/g, " ")} (score ${i.score}/100).`,
    s.firstPartyPurchases.count
      ? `Bought ${s.firstPartyPurchases.count} call${s.firstPartyPurchases.count === 1 ? "" : "s"} from us ($${s.firstPartyPurchases.totalUsd.toFixed(2)}): ${eps}.`
      : "",
    i.payments[0]?.user_agent?.startsWith("claude-mcp") ? "Pays through Claude via an MCP tool, i.e. an AI assistant buying data on a user's behalf." : "",
    i.enrichment.chains.every((c) => c.txCount <= 10) ? "New wallet with little on-chain history, likely created just to pay for APIs." : "",
    prot.length ? `Active on ${prot.join(", ")}.` : "",
    sellers.length ? `Also pays other x402 sellers: ${sellers.join(", ")}.` : "",
    holdingsUsd > 0 ? `Holds ~$${holdingsUsd.toFixed(0)} in tracked assets.` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

export async function writeNarrative(i: Input): Promise<string> {
  if (!client) return template(i);
  try {
    const response = await client.beta.messages.create({
      model: config.anthropicModel,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system:
        "You are a customer-intelligence analyst for an API business that sells data to AI agents via x402 micropayments on Solana. " +
        "Given a JSON profile of one paying wallet, write a 3-4 sentence customer profile for the seller: who this customer likely is, " +
        "how and what they buy, what else they do on-chain, and one concrete upsell or retention idea. Be specific with numbers. " +
        "Only state what the data supports; say 'likely' for inferences. Plain prose, no headings or bullet points.",
      messages: [{ role: "user", content: JSON.stringify(summarize(i)) }],
    } as any);
    if ((response as any).stop_reason === "refusal") return template(i);
    const text = (response.content as any[])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return text || template(i);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) console.warn("[narrative] rate limited, using template");
    else if (err instanceof Anthropic.APIError) console.warn("[narrative] api error", err.status, err.message);
    else console.warn("[narrative] failed", err);
    return template(i);
  }
}
