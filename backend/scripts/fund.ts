/**
 * Distributes devnet USDC from the treasury to every agent and creates the
 * seller's USDC token account. Treasury pays SOL fees + ATA rent.
 *
 *   bun run fund [usdcPerAgent=1.5]
 */
import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { base58 } from "@scure/base";
import { readFileSync } from "node:fs";
import { loadAgents } from "../src/agents/agents";
import { config, USDC_MINT } from "../src/config";

const rpc = createSolanaRpc(config.devnetRpc);
const mint = address(USDC_MINT.devnet);
const perAgent = Number(process.argv[2] ?? 1.5);

const treasuryKey = JSON.parse(readFileSync("data/treasury.json", "utf8"));
const treasury = await createKeyPairSignerFromBytes(base58.decode(treasuryKey.secretKey));
const seller = JSON.parse(readFileSync("data/seller.json", "utf8")).address as string;
// Optional 2nd arg: only fund agents whose name matches (e.g. `bun run fund 2 hero-agent`).
const only = process.argv[3];
const agents = loadAgents().filter((a) => !only || a.name === only || (only.endsWith("*") && a.name.startsWith(only.slice(0, -1))));

async function send(ixs: Instruction[], payer: TransactionSigner) {
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
    const { value } = await rpc.getSignatureStatuses([sig]).send();
    const st = value[0];
    if (st?.err) throw new Error(`tx failed ${sig}: ${JSON.stringify(st.err)}`);
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return sig;
    await Bun.sleep(750);
  }
  throw new Error(`tx not confirmed ${sig}`);
}

// 1. SOL check (try an airdrop if empty)
let { value: bal } = await rpc.getBalance(treasury.address).send();
console.log(`treasury ${treasury.address} SOL=${Number(bal) / 1e9}`);
if (bal < 50_000_000n) {
  console.log("requesting devnet airdrop…");
  try {
    await rpc.requestAirdrop(treasury.address, lamports(1_000_000_000n)).send();
    await Bun.sleep(8000);
    bal = (await rpc.getBalance(treasury.address).send()).value;
  } catch (e) {
    console.log("airdrop failed (rate-limited). Use https://faucet.solana.com instead.");
  }
  if (bal < 20_000_000n) process.exit(1);
}

// 2. USDC check
const [treasuryAta] = await findAssociatedTokenPda({ owner: treasury.address, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
const usdc = await rpc
  .getTokenAccountBalance(treasuryAta)
  .send()
  .then((r) => Number(r.value.amount))
  .catch(() => 0);
console.log(`treasury USDC=${usdc / 1e6}`);
const need = Math.round(perAgent * 1e6) * agents.length;
if (usdc < need) {
  console.log(`need ${need / 1e6} USDC. Get devnet USDC at https://faucet.circle.com (Solana Devnet) -> ${treasury.address}`);
  if (usdc === 0) process.exit(1);
}
const each = BigInt(Math.floor(Math.min(need, usdc) / agents.length));

// 3. Seller ATA + agent ATAs + transfers, batched 3 agents per tx
const sellerIx = await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: treasury, owner: address(seller), mint });
console.log("seller ATA:", await send([sellerIx], treasury));

for (let i = 0; i < agents.length; i += 3) {
  const ixs: Instruction[] = [];
  for (const a of agents.slice(i, i + 3)) {
    const owner = address(a.address);
    ixs.push(await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: treasury, owner, mint }));
    const [dest] = await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    ixs.push(
      getTransferCheckedInstruction({ source: treasuryAta, mint, destination: dest, authority: treasury, amount: each, decimals: 6 }),
    );
  }
  console.log(`funded agents ${i + 1}-${Math.min(i + 3, agents.length)} with ${Number(each) / 1e6} USDC:`, await send(ixs, treasury));
}
console.log("done. Agents pay with USDC only — the facilitator sponsors SOL fees.");
