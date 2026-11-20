/**
 * Give a demo agent wallet a real (devnet) history so its profile has substance.
 * Everything is a real signed Solana devnet transaction; nothing is written to the DB by hand.
 *
 *   bun run simulate <agentName> [paidCalls=48]
 *
 *  1. x402 purchases from our API (captured by the thirdLayer SDK if it is enabled)
 *  2. x402 purchases from other devnet sellers (Pulse News, Chain Radar, Gas Oracle)
 *  3. ordinary on-chain activity: SOL/USDC transfers with other wallets + memos
 *  4. re-enrich the wallet from that history
 *
 * Requires the backend running (bun run dev). Restart it after the first run so the
 * other sellers' routes are mounted.
 */
import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { base58 } from "@scure/base";
import { getAddMemoInstruction, LEGACY_MEMO_PROGRAM_ADDRESS_V3 } from "@solana-program/memo";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { agentCall, generateAgents, loadAgents } from "../src/agents/agents";
import { config, USDC_MINT } from "../src/config";
import { EXT_SELLER_DEFS, EXT_SELLERS_FILE } from "../src/ext-sellers";

const [name, callsArg] = process.argv.slice(2);
if (!name) throw new Error("usage: bun run simulate <agentName> [paidCalls]");
const PAID_CALLS = Number(callsArg ?? 48);
const agent = loadAgents().find((a) => a.name === name);
if (!agent) throw new Error(`no agent named ${name}`);

const rpc = createSolanaRpc(config.devnetRpc);
const mint = address(USDC_MINT.devnet);
const sleep = (ms: number) => Bun.sleep(ms);
const jitter = (a: number, b: number) => a + Math.random() * (b - a);

async function send(ixs: Instruction[], payer: TransactionSigner) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { value: blockhash } = await rpc.getLatestBlockhash().send();
      const msg = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(payer, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
        (m) => appendTransactionMessageInstructions(ixs, m),
      );
      const tx = await signTransactionMessageWithSigners(msg);
      const sig = getSignatureFromTransaction(tx);
      await rpc.sendTransaction(getBase64EncodedWireTransaction(tx), { encoding: "base64" }).send();
      for (let i = 0; i < 40; i++) {
        const st = (await rpc.getSignatureStatuses([sig]).send()).value[0];
        if (st?.err) throw new Error(`tx failed ${sig}`);
        if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return sig;
        await sleep(750);
      }
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw new Error("unreachable");
}

const memoIx = (signer: TransactionSigner, text: string): Instruction =>
  getAddMemoInstruction({ memo: text, signers: [signer] }, { programAddress: LEGACY_MEMO_PROGRAM_ADDRESS_V3 }) as Instruction;

const treasury = await createKeyPairSignerFromBytes(base58.decode(JSON.parse(readFileSync("data/treasury.json", "utf8")).secretKey));
const me = await createKeyPairSignerFromBytes(base58.decode(agent.secretKey));
const others = loadAgents().filter((a) => a.name !== name && a.persona !== "hero-agent").slice(0, 4);
console.log(`simulating ${name} (${me.address})`);

// --- 0. other sellers: wallets + USDC accounts --------------------------------------------
let createdSellers = false;
if (!existsSync(EXT_SELLERS_FILE)) {
  const keys = await generateAgents(EXT_SELLER_DEFS.length);
  const sellers = EXT_SELLER_DEFS.map((d, i) => ({ ...d, payTo: keys[i]!.address, secretKey: keys[i]!.secretKey }));
  writeFileSync(EXT_SELLERS_FILE, JSON.stringify(sellers, null, 2));
  createdSellers = true;
}
const sellers = JSON.parse(readFileSync(EXT_SELLERS_FILE, "utf8")) as { name: string; path: string; payTo: string }[];
const ataIxs = await Promise.all(sellers.map((s) => getCreateAssociatedTokenIdempotentInstructionAsync({ payer: treasury, owner: address(s.payTo), mint })));
console.log("seller USDC accounts:", await send(ataIxs, treasury));

// Gas for ordinary transfers (x402 payments themselves are fee-sponsored).
console.log("0.05 SOL for fees:", await send([getTransferSolInstruction({ source: treasury, destination: me.address, amount: 50_000_000n })], treasury));

// --- 1. x402 purchases from our API ----------------------------------------------------------
const MIX: Record<string, number> = { "x402-pulse": 0.62, price: 0.26, sentiment: 0.08, whales: 0.04 };
const pickEp = () => {
  let r = Math.random();
  for (const [k, w] of Object.entries(MIX)) if ((r -= w) <= 0) return `/api/paid/${k}`;
  return "/api/paid/x402-pulse";
};
let ok = 0;
for (let i = 0; i < PAID_CALLS; i++) {
  const ep = pickEp();
  try {
    const r = await agentCall(agent, ep);
    if (r.status === 200) ok++;
    else console.warn(`  ${ep} -> ${r.status}`);
  } catch (e) {
    console.warn(`  ${ep} error ${(e as Error).message.slice(0, 80)}`);
    await sleep(4000);
  }
  if (i % 8 === 7) console.log(`  our API: ${ok}/${i + 1}`);
  await sleep(jitter(1500, 6000));
}
console.log(`our API purchases: ${ok}/${PAID_CALLS}`);

// --- 2. x402 purchases from other sellers ----------------------------------------------------
if (createdSellers) console.log("NOTE: restart the backend so /ext/* seller routes mount, then re-run with 0 calls: bun run simulate", name, "0");
let ext = 0;
const extPlan = [...Array(4).fill(sellers[0]), ...Array(3).fill(sellers[1]), ...Array(2).fill(sellers[2])].filter(Boolean);
for (const s of extPlan) {
  try {
    const r = await agentCall(agent, s.path);
    if (r.status === 200) ext++;
    else console.warn(`  ${s.name} -> ${r.status}`);
  } catch (e) {
    console.warn(`  ${s.name} error ${(e as Error).message.slice(0, 80)}`);
  }
  await sleep(jitter(1500, 4000));
}
console.log(`other-seller purchases: ${ext}/${extPlan.length}`);

// --- 3. ordinary on-chain activity -----------------------------------------------------------
const [myAta] = await findAssociatedTokenPda({ owner: me.address, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
let misc = 0;
for (const o of others) {
  const [dest] = await findAssociatedTokenPda({ owner: address(o.address), mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  try {
    await send([getTransferCheckedInstruction({ source: myAta, mint, destination: dest, authority: me, amount: 20_000n, decimals: 6 })], me);
    misc++;
    await send([getTransferSolInstruction({ source: me, destination: address(o.address), amount: 1_000_000n })], me);
    misc++;
    await send([memoIx(me, `thirdlayer demo: settle with ${o.name}`)], me);
    misc++;
  } catch (e) {
    console.warn(`  transfer with ${o.name} failed: ${(e as Error).message.slice(0, 80)}`);
  }
  await sleep(1200);
}
console.log(`ordinary transactions: ${misc}`);

// --- 4. re-profile --------------------------------------------------------------------------
await fetch(`${config.publicBaseUrl}/wallets/${me.address}/enrich`, { method: "POST" }).catch(() => {});
console.log(`done. re-enrichment requested for ${me.address}`);
