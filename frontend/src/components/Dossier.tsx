"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { EnrichStep, WalletProfile } from "@/lib/types";
import { accountUrl, explorer, getWallet, short } from "@/lib/api";
import { Header } from "./Header";
import { SEGMENT_LABEL } from "@/lib/seller";
import { Empty, Label } from "./Ledger";

const STEPS: { k: EnrichStep; label: string }[] = [
  { k: "history", label: "Pull Solana tx history" },
  { k: "x402_sellers", label: "Match other x402 sellers (CDP Discovery)" },
  { k: "protocols", label: "Classify protocols & holdings" },
  { k: "score", label: "Score customer value" },
  { k: "narrative", label: "Write profile" },
];

type StepState = Partial<Record<EnrichStep, "running" | "done">>;

export function Dossier({ address, steps, version, dataset, bare }: { address: string | null; steps?: StepState; version: number; dataset?: "real" | "demo"; bare?: boolean }) {
  const [p, setP] = useState<WalletProfile | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!address) return;
    let off = false;
    getWallet(address, dataset).then((w) => { if (!off) { setP(w); setMissing(!w); } });
    return () => { off = true; };
  }, [address, version, dataset]);

  // When no live enrichment is tracked for this wallet, everything is already known → show all.
  const shown = (k: EnrichStep) => !steps || steps[k] === "done";
  const tracing = !!steps && STEPS.some((s) => steps[s.k] !== "done");

  if (!address) return (
    <section className="flex min-h-0 flex-col rounded-lg bg-panel">
      <Header title="Trace" />
      <div className="px-4"><Empty>Select a wallet</Empty></div>
    </section>
  );

  const net = p?.source === "live" ? "solana-devnet" : "solana-mainnet";
  if (missing) return <div className={bare ? "" : "rounded-lg bg-panel p-4"}><Empty>Wallet not found in this dataset</Empty></div>;

  return (
    <section className={bare ? "" : "scroll-thin flex min-h-0 flex-col overflow-y-auto rounded-lg bg-panel"}>
      {!bare && <Header title="Trace"
        right={p && <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${p.source === "live" ? "bg-accent/12 text-accent" : "bg-verify/12 text-verify"}`}>{p.source === "live" ? "Live · devnet" : "Real · mainnet"}</span>} />}

      <motion.div key={address} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={bare ? "" : "px-4 pb-4"}>
        <div className="flex items-center justify-between gap-4 rounded-md bg-card p-4">
          <div className="min-w-0">
            <a href={accountUrl(address, net)} target="_blank" rel="noreferrer" className="block truncate font-mono text-[13px] text-muted hover:text-ink">{short(address, 10)}</a>
            <div className="mt-1 text-3xl font-medium tracking-tight text-ink">{p?.persona ?? "…"}</div>
            {p && <div className="mt-1.5 text-xs text-muted">{p.paymentCount} x402 {p.paymentCount === 1 ? "payment" : "payments"} · ${p.totalPaidUsd.toFixed(2)} · first seen {new Date(p.firstSeen).toLocaleDateString()}</div>}
          </div>
          <ScoreRing score={shown("score") ? p?.score ?? null : null} />
        </div>

        <AnimatePresence initial={false}>
        {steps && tracing && (
          <motion.ul exit={{ opacity: 0, height: 0, marginTop: 0, paddingTop: 0, paddingBottom: 0 }} transition={{ duration: 0.4 }} className="mt-2 space-y-1.5 overflow-hidden rounded-md bg-card p-4 text-[13px]">
            {STEPS.map((s) => {
              const st = steps[s.k];
              return (
                <li key={s.k} className="flex items-center gap-2.5">
                  <span className={`w-4 ${st === "done" ? "text-verify" : st === "running" ? "text-accent" : "text-dim"}`}>
                    {st === "done" ? "✓" : st === "running" ? <Spinner /> : "·"}
                  </span>
                  <span className={st ? "text-ink" : "text-dim"}>{s.label}</span>
                </li>
              );
            })}
          </motion.ul>
        )}
        </AnimatePresence>

        {p?.usage && p.usage.calls > 0 && <Usage u={p.usage} />}

        <AnimatePresence>
          {p && shown("history") && (
            <Block key="chains" title="On-chain footprint">
              <div className="grid grid-cols-2 gap-2">
                {p.chains.map((c) => (
                  <div key={c.chain} className="rounded-md bg-sunk/70 p-3">
                    <div className="text-xs font-medium text-muted">{c.chain}</div>
                    <div className="mt-1 text-2xl font-medium tabular-nums tracking-tight text-ink"><Count to={c.txCount} /></div>
                    <div className="text-xs text-dim">txs{c.firstTx ? ` · since ${new Date(c.firstTx).toLocaleDateString(undefined, { month: "short", year: "2-digit" })}` : ""}</div>
                  </div>
                ))}
              </div>
            </Block>
          )}

          {p && shown("x402_sellers") && p.otherX402Sellers.length > 0 && (
            <Block key="sellers" title="Also pays these x402 sellers">
              {p.otherX402Sellers.map((s) => (
                <div key={s.payTo} className="flex items-center justify-between border-b border-line/70 py-2 text-[13px] last:border-0">
                  <span className="text-ink">{s.name} <span className="font-mono text-[11px] text-dim">{short(s.payTo)}</span></span>
                  <span className="text-xs tabular-nums text-muted">{s.payments}× · <span className="font-medium text-accent">{money(s.totalUsd)}</span></span>
                </div>
              ))}
            </Block>
          )}

          {p && shown("protocols") && (p.protocols.some((x) => x.category !== "core") || p.tokens.length > 0) && (
            <Block key="protocols" title={p.protocols.some((x) => x.category !== "core") ? "Protocols & holdings" : "Holdings"}>
              {p.protocols.some((x) => x.category !== "core") && <Bars items={p.protocols.filter((x) => x.category !== "core").sort((a, b) => b.interactions - a.interactions)} />}
              <div className={`${p.protocols.some((x) => x.category !== "core") ? "mt-3" : ""} flex flex-wrap gap-1.5`}>
                {p.tokens.map((t) => (
                  <span key={t.symbol} className="rounded-md bg-sunk/70 px-2 py-1 text-xs text-muted">
                    {t.symbol} <span className="font-medium tabular-nums text-ink">${t.balanceUsd.toLocaleString()}</span>
                  </span>
                ))}
              </div>
            </Block>
          )}

          {p && shown("narrative") && p.narrative && (
            <Block key="narr" title="Profile">
              <Typed text={p.narrative} animate={!!steps} />
            </Block>
          )}

          {p && !tracing && (p.externalPayments?.length ?? 0) > 0 && (
            <Block key="ext" title="Recent purchases at other sellers">
              {[...p.externalPayments!].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 8).map((x) => (
                <a key={`${x.txHash}-${x.payTo}`} href={explorer(x.txHash, x.network)} target="_blank" rel="noreferrer"
                  className="grid grid-cols-[1fr_72px_96px] items-center gap-3 border-b border-line/70 py-2 text-[13px] last:border-0 hover:bg-sunk/30">
                  <span className="truncate text-ink">{x.seller}</span>
                  <span className="text-right tabular-nums text-ink">{money(x.amountUsd)}</span>
                  <span className="text-right tabular-nums text-muted">{fmtDate(x.ts)}</span>
                </a>
              ))}
            </Block>
          )}

          {p && !tracing && p.payments.length > 0 && (
            <Block key="pays" title="x402 payments to us">
              {p.payments.slice(0, 6).map((x) => (
                <a key={x.txHash} href={explorer(x.txHash, x.network)} target="_blank" rel="noreferrer"
                  className="grid grid-cols-[1fr_120px_96px] items-center gap-3 border-b border-line/70 py-2 text-[13px] last:border-0 hover:bg-sunk/30">
                  <span className="truncate font-mono text-ink">{x.endpoint.replace("/api/paid", "")}</span>
                  <span className="text-right font-mono text-xs text-muted">{short(x.txHash, 6)}</span>
                  <span className="text-right tabular-nums text-muted">{fmtDate(x.ts)}</span>
                </a>
              ))}
            </Block>
          )}
        </AnimatePresence>
      </motion.div>
    </section>
  );
}

const gap = (s: number | null) =>
  s == null ? "once" : s < 60 ? `every ~${Math.round(s)}s` : s < 3600 ? `every ~${Math.round(s / 60)} min` : s < 86400 ? `every ~${Math.round(s / 3600)} h` : `every ~${Math.round(s / 86400)} d`;

function Usage({ u }: { u: NonNullable<WalletProfile["usage"]> }) {
  const max = Math.max(1, ...u.byEndpoint.map((e) => e.count));
  const eps = [...u.byEndpoint].sort((a, b) => b.count - a.count);
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-2 rounded-md bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-ink">How they use our API</h3>
        <div className="flex gap-1.5">
          {u.client && <span className="rounded-md bg-ink px-2 py-0.5 text-xs font-medium text-card">{u.client}</span>}
          {u.segment && <span className="rounded-md bg-accent/12 px-2 py-0.5 text-xs font-medium text-accent">{SEGMENT_LABEL[u.segment] ?? u.segment}</span>}
        </div>
      </div>
      <div className="mb-3 grid grid-cols-3 gap-2">
        {[["Calls", u.calls.toLocaleString()], ["Spent", money(u.spendUsd)], ["Cadence", gap(u.medianGapSec)]].map(([k, v]) => (
          <div key={k} className="rounded-md bg-sunk/70 p-2.5">
            <div className="text-xs text-muted">{k}</div>
            <div className="mt-0.5 truncate text-base font-medium tabular-nums tracking-tight text-ink">{v}</div>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {eps.map((e, i) => (
          <div key={e.endpoint}>
            <div className="flex justify-between text-[13px]">
              <span className="font-mono text-ink">{e.endpoint.replace("/api/paid/", "/")}</span>
              <span className="tabular-nums text-muted">{e.count}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunk">
              <motion.div className="h-full rounded-full bg-accent" initial={{ width: 0 }} animate={{ width: `${(e.count / max) * 100}%` }} transition={{ duration: 0.6, delay: i * 0.06 }} />
            </div>
          </div>
        ))}
      </div>
      {u.firstPaid && <div className="mt-3 text-xs text-muted">Customer since {new Date(u.firstPaid).toLocaleDateString()}{u.lastPaid ? ` · last paid ${new Date(u.lastPaid).toLocaleString()}` : ""}</div>}
    </motion.div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} className="mt-2 rounded-md bg-card p-4">
      <Label>{title}</Label>
      {children}
    </motion.div>
  );
}

function Bars({ items }: { items: { name: string; category: string; interactions: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.interactions));
  return (
    <div className="space-y-2">
      {items.map((i, idx) => (
        <div key={i.name}>
          <div className="flex justify-between text-[13px]"><span className="text-ink">{i.name} <span className="text-dim">· {i.category}</span></span><span className="tabular-nums text-muted">{i.interactions}</span></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunk">
            <motion.div className="h-full rounded-full bg-accent" initial={{ width: 0 }} animate={{ width: `${(i.interactions / max) * 100}%` }} transition={{ duration: 0.8, delay: idx * 0.08, ease: [0.22, 1, 0.36, 1] }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ScoreRing({ score }: { score: number | null }) {
  const r = 26, c = 2 * Math.PI * r;
  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--sunk)" strokeWidth="4" />
        <motion.circle cx="32" cy="32" r={r} fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: score == null ? c : c * (1 - score / 100) }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="text-xl font-medium tabular-nums text-ink">{score ?? "–"}</span>
      </div>
    </div>
  );
}

function Count({ to }: { to: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / 900); setN(Math.round(to * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{n.toLocaleString()}</>;
}

function Typed({ text, animate }: { text: string; animate: boolean }) {
  const [n, setN] = useState(animate ? 0 : text.length);
  useEffect(() => {
    if (!animate) { setN(text.length); return; }
    setN(0);
    const id = setInterval(() => setN((v) => { if (v >= text.length) { clearInterval(id); return v; } return v + 2; }), 14);
    return () => clearInterval(id);
  }, [text, animate]);
  return <p className={`text-[15px] leading-relaxed text-ink ${n < text.length ? "caret" : ""}`}>{text.slice(0, n)}</p>;
}

function Spinner() {
  return <motion.span className="inline-block" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }}>◐</motion.span>;
}

const money = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);

/** Same-day → time, otherwise short date. Fixed format so columns line up. */
const fmtDate = (ts: string) => {
  const d = new Date(ts);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
