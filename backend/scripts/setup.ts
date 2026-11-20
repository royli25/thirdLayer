/**
 * One-time setup: generates the seller (payTo) wallet, a treasury wallet, and N agent wallets.
 * Writes data/*.json and PAY_TO_ADDRESS into .env. Safe to re-run (never overwrites keys).
 *
 *   bun run setup [agentCount=6]
 */
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { generateAgents, loadAgents, saveAgents } from "../src/agents/agents";

mkdirSync("data", { recursive: true });

async function walletFile(path: string) {
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as { address: string; secretKey: string };
  const [a] = await generateAgents(1);
  const w = { address: a!.address, secretKey: a!.secretKey };
  writeFileSync(path, JSON.stringify(w, null, 2));
  return w;
}

const seller = await walletFile("data/seller.json");
const treasury = await walletFile("data/treasury.json");

let agents = loadAgents();
if (!agents.length) {
  agents = await generateAgents(Number(process.argv[2] ?? 6));
  saveAgents(agents);
}
// sanity check keys round-trip
await createKeyPairSignerFromBytes(base58.decode(agents[0]!.secretKey));

// .env
const envPath = ".env";
let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : readFileSync(".env.example", "utf8");
if (/^PAY_TO_ADDRESS=.*$/m.test(env)) env = env.replace(/^PAY_TO_ADDRESS=.*$/m, `PAY_TO_ADDRESS=${seller.address}`);
else env += `\nPAY_TO_ADDRESS=${seller.address}\n`;
writeFileSync(envPath, env);

console.log(`
Seller (payTo):  ${seller.address}
Treasury:        ${treasury.address}
Agents:
${agents.map((a) => `  ${a.name.padEnd(20)} ${a.address}`).join("\n")}

FUND THE TREASURY (devnet, free):
  1. Devnet SOL  -> https://faucet.solana.com      address: ${treasury.address}   (1-5 SOL)
  2. Devnet USDC -> https://faucet.circle.com      network: Solana Devnet, address: ${treasury.address}
Then run:  bun run fund
`);
