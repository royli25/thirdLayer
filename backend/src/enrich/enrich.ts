/**
 * Enrichment pipeline: payer wallet -> customer profile.
 *
 *   history       signatures on devnet + mainnet (activity, wallet age)
 *   x402_sellers  which OTHER x402 sellers (CDP Discovery registry) this wallet paid
 *   protocols     which DeFi/NFT programs it touches + token holdings
 *   score         0-100 customer value score + persona label
 *   narrative     LLM-written profile (falls back to a deterministic template)
 */
import { bus, now } from "../bus";
import { config, USDC_MINT } from "../config";
import { db, externalPaymentsFor, getWallet, paymentsFor, type PaymentRow } from "../db";
import { writeNarrative } from "./narrative";
import { loadAgents } from "../agents/agents";
import { IGNORED_PROGRAMS, KNOWN_MINTS, PROGRAMS, SELLERS, STABLES } from "./registry";
import { getParsedTx, getSignatures, pool, rpc, type Cluster } from "./rpc";

export type Enrichment = {
  chains: { chain: string; txCount: number; firstTx: string | null }[];
  protocols: { name: string; category: string; interactions: number }[];
  tokens: { symbol: string; balanceUsd: number }[];
  otherX402Sellers: { name: string; payTo: string; payments: number; totalUsd: number }[];
  narrative: string | null;
  signals: Record<string, number | string>;
};

const rpcUrl = (c: Cluster) => (c === "devnet" ? config.devnetRpc : config.mainnetRpc);
const iso = (t: number | null | undefined) => (t ? new Date(t * 1000).toISOString() : null);
const step = (address: string, s: Parameters<typeof emitStep>[1], status: "running" | "done") =>
  emitStep(address, s, status);
function emitStep(
  address: string,
  s: "history" | "x402_sellers" | "protocols" | "score" | "narrative",
  status: "running" | "done",
) {
  bus.emit({ type: "enrichment_step", data: { address, step: s, status, ts: now() } });
}

let solPrice = { usd: 0, at: 0 };
async function getSolUsd(): Promise<number> {
  if (Date.now() - solPrice.at < 5 * 60_000 && solPrice.usd) return solPrice.usd;
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
    const j = (await r.json()) as { solana?: { usd?: number } };
    if (j.solana?.usd) solPrice = { usd: j.solana.usd, at: Date.now() };
  } catch {}
  return solPrice.usd || 150;
}

/** Sample recent transactions and extract program usage + USDC payments to known x402 sellers. */
async function analyzeTxs(cluster: Cluster, address: string, sigs: string[]) {
  const programs = new Map<string, number>();
  const sellerPays = new Map<string, { payments: number; totalUsd: number }>();
  const usdcMint = cluster === "devnet" ? USDC_MINT.devnet : USDC_MINT.mainnet;

  // Public RPCs rate-limit hard; go gently (cached txs return instantly anyway).
  const conc = rpcUrl(cluster).includes("solana.com") ? 2 : 6;
  const txs = await pool(sigs, conc, (s) => getParsedTx(rpcUrl(cluster), s).catch(() => null));
  for (const tx of txs) {
    if (!tx?.transaction) continue;
    const seen = new Set<string>();
    const ixs = [
      ...(tx.transaction.message.instructions ?? []),
      ...((tx.meta?.innerInstructions ?? []) as any[]).flatMap((i: any) => i.instructions),
    ];
    for (const ix of ixs) {
      const pid: string = ix.programId;
      if (!pid || IGNORED_PROGRAMS.has(pid) || seen.has(pid)) continue;
      seen.add(pid);
      programs.set(pid, (programs.get(pid) ?? 0) + 1);
    }
    // USDC balance deltas: who received USDC from this wallet?
    const pre = new Map<number, number>();
    for (const b of tx.meta?.preTokenBalances ?? [])
      if (b.mint === usdcMint) pre.set(b.accountIndex, Number(b.uiTokenAmount.uiAmount ?? 0));
    let spent = 0;
    const receivers: [string, number][] = [];
    for (const b of tx.meta?.postTokenBalances ?? []) {
      if (b.mint !== usdcMint) continue;
      const delta = Number(b.uiTokenAmount.uiAmount ?? 0) - (pre.get(b.accountIndex) ?? 0);
      if (b.owner === address && delta < 0) spent = -delta;
      if (b.owner !== address && delta > 0) receivers.push([b.owner, delta]);
    }
    if (spent > 0)
      for (const [owner, amt] of receivers) {
        if (!SELLERS.has(owner) && owner !== config.payTo && cluster === "devnet") continue;
        if (cluster === "mainnet" && !SELLERS.has(owner) && amt > 5) continue; // non-x402 transfers
        const e = sellerPays.get(owner) ?? { payments: 0, totalUsd: 0 };
        e.payments++;
        e.totalUsd += amt;
        sellerPays.set(owner, e);
      }
  }
  return { programs, sellerPays };
}

async function holdings(cluster: Cluster, address: string) {
  const url = rpcUrl(cluster);
  const out: { symbol: string; balanceUsd: number }[] = [];
  const [lamports, ...tokenAccts] = await Promise.all([
    rpc<{ value: number }>(url, "getBalance", [address]).catch(() => ({ value: 0 })),
    ...["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"].map((programId) =>
      rpc<{ value: any[] }>(url, "getTokenAccountsByOwner", [address, { programId }, { encoding: "jsonParsed" }]).catch(
        () => ({ value: [] }),
      ),
    ),
  ]);
  const sol = lamports.value / 1e9;
  const solUsd = await getSolUsd();
  if (sol > 0) out.push({ symbol: cluster === "devnet" ? "SOL (devnet)" : "SOL", balanceUsd: +(sol * solUsd).toFixed(2) });

  const others: { mint: string; amount: number }[] = [];
  for (const acct of tokenAccts.flatMap((t) => t.value)) {
    const info = acct.account.data.parsed.info;
    const amount = Number(info.tokenAmount.uiAmount ?? 0);
    if (amount <= 0) continue;
    const sym = KNOWN_MINTS[info.mint];
    if (sym && STABLES.has(sym)) out.push({ symbol: cluster === "devnet" ? `${sym} (devnet)` : sym, balanceUsd: +amount.toFixed(2) });
    else others.push({ mint: info.mint, amount });
  }
  // Price non-stable mainnet tokens via Jupiter's public price API (best effort).
  if (cluster === "mainnet" && others.length) {
    const top = others.slice(0, 40);
    try {
      const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${top.map((o) => o.mint).join(",")}`);
      const prices = (await r.json()) as Record<string, { usdPrice?: number }>;
      for (const o of top) {
        const p = prices[o.mint]?.usdPrice;
        if (p) out.push({ symbol: KNOWN_MINTS[o.mint] ?? `${o.mint.slice(0, 4)}…`, balanceUsd: +(p * o.amount).toFixed(2) });
      }
    } catch {}
  }
  return out;
}

export function inferPersona(first: PaymentRow[], categories: Map<string, number>, sellerCount: number): string {
  if (first.length >= 2) {
    const byEndpoint = new Map<string, number>();
    for (const p of first) byEndpoint.set(p.endpoint, (byEndpoint.get(p.endpoint) ?? 0) + 1);
    const [topEp, topN] = [...byEndpoint.entries()].sort((a, b) => b[1] - a[1])[0]!;
    const share = topN / first.length;
    const times = first.map((p) => Date.parse(p.ts)).sort((a, b) => a - b);
    const gaps = times.slice(1).map((t, i) => t - times[i]!);
    const medianGap = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? Infinity;
    if (share > 0.5) {
      if (topEp.endsWith("/price")) return medianGap < 120_000 ? "trading-bot" : "price-tracker";
      if (topEp.endsWith("/sentiment") || topEp.endsWith("/x402-pulse")) return "research-agent";
      if (topEp.endsWith("/whales")) return "whale-watcher";
    }
    return "portfolio-agent";
  }
  const top = [...categories.entries()].filter(([c]) => c !== "core").sort((a, b) => b[1] - a[1])[0]?.[0];
  if (sellerCount >= 3) return "x402-power-agent";
  if (top === "memecoin") return "memecoin-trader";
  if (top === "dex" || top === "dex-aggregator") return "defi-trader";
  if (top === "lending" || top === "staking") return "yield-farmer";
  if (top === "perps") return "perps-trader";
  if (top === "nft") return "nft-collector";
  return "x402-buyer";
}

export function computeScore(s: {
  spendUsd: number;
  paymentCount: number;
  txCount: number;
  protocolCount: number;
  sellerCount: number;
  ageDays: number;
}) {
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const spend = clamp(Math.log10(1 + s.spendUsd * 100) / 4) * 30; // $0.01 -> ~2, $100 -> 30
  const freq = clamp(Math.log10(1 + s.paymentCount) / 2) * 20; // 100 payments -> 20
  const activity = clamp(Math.log10(1 + s.txCount) / 3.3) * 15;
  const age = clamp(s.ageDays / 365) * 5;
  const defi = clamp(s.protocolCount / 6) * 15;
  const x402 = clamp(s.sellerCount / 4) * 15;
  return Math.round(spend + freq + activity + age + defi + x402);
}

const inflight = new Map<string, Promise<void>>();
export function enrichWallet(address: string): Promise<void> {
  const existing = inflight.get(address);
  if (existing) return existing;
  const p = runEnrichment(address).finally(() => inflight.delete(address));
  inflight.set(address, p);
  return p;
}

async function runEnrichment(address: string) {
  const wallet = getWallet(address);
  if (!wallet) return;
  db.query("UPDATE wallets SET enrichment_status='pending' WHERE address=?").run(address);
  try {
    const clusters: Cluster[] = wallet.source === "live" ? ["devnet", "mainnet"] : ["mainnet"];

    // 1. history
    step(address, "history", "running");
    const sigsByCluster = new Map<Cluster, Awaited<ReturnType<typeof getSignatures>>>();
    await Promise.all(
      clusters.map(async (c) => sigsByCluster.set(c, await getSignatures(rpcUrl(c), address).catch(() => []))),
    );
    const chains = clusters.map((c) => {
      const sigs = sigsByCluster.get(c) ?? [];
      const oldest = sigs.at(-1)?.blockTime ?? null;
      return { chain: `solana-${c}`, txCount: sigs.length, firstTx: iso(oldest) };
    });
    step(address, "history", "done");

    const declared = loadAgents().find((a) => a.address === address)?.persona;
    // 2. x402 sellers + 3. protocols (share the same tx sample)
    step(address, "x402_sellers", "running");
    step(address, "protocols", "running");
    const programs = new Map<string, number>();
    const sellerPays = new Map<string, { payments: number; totalUsd: number }>();
    for (const c of clusters) {
      const sample = (sigsByCluster.get(c) ?? []).filter((s) => !s.err).slice(0, c === "mainnet" ? (declared === "hero-agent" ? 80 : 40) : 80);
      const r = await analyzeTxs(c, address, sample.map((s) => s.signature));
      for (const [k, v] of r.programs) programs.set(k, (programs.get(k) ?? 0) + v);
      for (const [k, v] of r.sellerPays) {
        const e = sellerPays.get(k) ?? { payments: 0, totalUsd: 0 };
        e.payments += v.payments;
        e.totalUsd += v.totalUsd;
        sellerPays.set(k, e);
      }
    }
    // Merge payments observed by the mainnet importer.
    const ext = new Map<string, { payments: number; totalUsd: number }>();
    for (const ep of externalPaymentsFor(address)) {
      const e = ext.get(ep.pay_to) ?? { payments: 0, totalUsd: 0 };
      e.payments++;
      e.totalUsd += ep.amount_usd;
      ext.set(ep.pay_to, e);
    }
    for (const [k, v] of ext) {
      const e = sellerPays.get(k);
      if (!e || v.payments > e.payments) sellerPays.set(k, v);
    }
    sellerPays.delete(config.payTo); // "other" sellers only
    const otherX402Sellers = [...sellerPays.entries()]
      .map(([payTo, v]) => ({
        name: SELLERS.get(payTo)?.name ?? `${payTo.slice(0, 4)}…${payTo.slice(-4)}`,
        payTo,
        payments: v.payments,
        totalUsd: +v.totalUsd.toFixed(4),
      }))
      .sort((a, b) => b.totalUsd - a.totalUsd);
    step(address, "x402_sellers", "done");

    const protocols = [...programs.entries()]
      .map(([pid, n]) => {
        const k = PROGRAMS[pid];
        return { name: k?.name ?? `${pid.slice(0, 4)}…${pid.slice(-4)}`, category: k?.category ?? "unknown", interactions: n };
      })
      .filter((p) => p.category !== "unknown")
      .sort((a, b) => b.interactions - a.interactions)
      .slice(0, 12);
    const tokens = (await Promise.all(clusters.map((c) => holdings(c, address).catch(() => []))))
      .flat()
      .sort((a, b) => b.balanceUsd - a.balanceUsd)
      .slice(0, 10);
    step(address, "protocols", "done");

    // 4. score + persona
    step(address, "score", "running");
    const first = paymentsFor(address);
    const firstSpend = first.reduce((s, p) => s + p.amount_usd, 0);
    const externalSpend = otherX402Sellers.reduce((s, x) => s + x.totalUsd, 0);
    const categories = new Map<string, number>();
    for (const p of protocols) categories.set(p.category, (categories.get(p.category) ?? 0) + p.interactions);
    const txCount = chains.reduce((s, c) => s + c.txCount, 0);
    const firstTxs = chains.map((c) => c.firstTx).filter(Boolean) as string[];
    const ageDays = firstTxs.length ? (Date.now() - Math.min(...firstTxs.map(Date.parse))) / 86_400_000 : 0;
    // Real data: persona comes from observed behavior only (never from what the agent claims to be).
    const persona =
      declared === "hero-agent"
        ? inferPersona([], categories, otherX402Sellers.length) // judged by its real mainnet behavior
        : inferPersona(first, categories, otherX402Sellers.length);
    const score = computeScore({
      spendUsd: firstSpend + externalSpend,
      paymentCount: first.length + otherX402Sellers.reduce((s, x) => s + x.payments, 0),
      txCount,
      protocolCount: protocols.filter((p) => p.category !== "core" && p.category !== "unknown").length,
      sellerCount: otherX402Sellers.length,
      ageDays,
    });
    step(address, "score", "done");

    const enrichment: Enrichment = {
      chains,
      protocols,
      tokens,
      otherX402Sellers,
      narrative: null,
      signals: { firstPartySpendUsd: +firstSpend.toFixed(4), externalX402SpendUsd: +externalSpend.toFixed(4), ageDays: Math.round(ageDays) },
    };
    db.query(
      "UPDATE wallets SET persona=?, score=?, enrichment_json=?, enrichment_status='done', enriched_at=? WHERE address=?",
    ).run(persona, score, JSON.stringify(enrichment), now(), address);

    // 5. narrative (slowest; profile is already usable before it lands)
    step(address, "narrative", "running");
    enrichment.narrative = await writeNarrative({ address, source: wallet.source, persona, score, payments: first, enrichment });
    db.query("UPDATE wallets SET enrichment_json=? WHERE address=?").run(JSON.stringify(enrichment), address);
    step(address, "narrative", "done");

    bus.emit({ type: "enrichment_done", data: { address, ts: now() } });
  } catch (err) {
    console.error("[enrich] failed", address, err);
    db.query("UPDATE wallets SET enrichment_status='error' WHERE address=?").run(address);
  }
}
