// Known Solana programs + x402 seller registry (from CDP x402 Discovery).
import sellersJson from "../../data/x402-sellers-solana.json";
import { loadExtSellers } from "../ext-sellers";

export type Seller = { payTo: string; name: string; network: string; asset?: string; resources: string[] };
export const SELLERS = new Map<string, Seller>((sellersJson as Seller[]).map((s) => [s.payTo, s]));
// Devnet x402 sellers we host for demo agents (see src/ext-sellers.ts).
for (const s of loadExtSellers())
  SELLERS.set(s.payTo, { payTo: s.payTo, name: s.name, network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", resources: [s.path] });

export const PROGRAMS: Record<string, { name: string; category: string }> = {
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: { name: "Jupiter", category: "dex-aggregator" },
  JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB: { name: "Jupiter v4", category: "dex-aggregator" },
  jupoNjAxXgZ4rjzxzPMP4oxduvQsQtZzyknqvzYNrNu: { name: "Jupiter Limit Order", category: "dex" },
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": { name: "Raydium AMM", category: "dex" },
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: { name: "Raydium CLMM", category: "dex" },
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C: { name: "Raydium CPMM", category: "dex" },
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: { name: "Orca Whirlpools", category: "dex" },
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: { name: "Meteora DLMM", category: "dex" },
  Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB: { name: "Meteora Pools", category: "dex" },
  PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY: { name: "Phoenix", category: "dex" },
  opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb: { name: "OpenBook v2", category: "dex" },
  pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: { name: "PumpSwap", category: "memecoin" },
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P": { name: "pump.fun", category: "memecoin" },
  KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD: { name: "Kamino Lend", category: "lending" },
  MFv2hWf31Z9kbCa1snEPYctwafyvdvnV7FZnsebVacA: { name: "marginfi", category: "lending" },
  So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo: { name: "Solend", category: "lending" },
  dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH: { name: "Drift", category: "perps" },
  MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD: { name: "Marinade", category: "staking" },
  SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy: { name: "Stake Pool", category: "staking" },
  Stake11111111111111111111111111111111111111: { name: "Native Staking", category: "staking" },
  TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN: { name: "Tensor", category: "nft" },
  M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K: { name: "Magic Eden", category: "nft" },
  metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s: { name: "Metaplex", category: "nft" },
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: { name: "SPL Token", category: "core" },
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: { name: "Token-2022", category: "core" },
};

export const IGNORED_PROGRAMS = new Set([
  "11111111111111111111111111111111",
  "ComputeBudget111111111111111111111111111111",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  "Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH",
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",
]);

export const KNOWN_MINTS: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU": "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
  So11111111111111111111111111111111111111112: "wSOL",
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: "JUP",
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: "BONK",
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: "WIF",
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: "mSOL",
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: "JitoSOL",
  "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4": "JLP",
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": "RAY",
  orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE: "ORCA",
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: "PYTH",
};

export const STABLES = new Set(["USDC", "USDT"]);
