"use client";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Process } from "./Process";
import { accountUrl, explorer, short, subscribe } from "@/lib/api";
import { analyze, getAnalysis, paramSummary, type Analysis, type InflowRow } from "@/lib/seller";
import { Card, usd } from "@/components/business/parts";

type StepState = { status: "running" | "done"; lines: string[] };

/** Opens a captured wallet: shows this payment's SDK capture, then analyzes the wallet live. */
export function Analyzer({ row }: { row: InflowRow }) {
  const address = row.from!;
  const c = row.captured!;
  const [steps, setSteps] = useState<Record<string, StepState>>({});
  const [fetched, setFetched] = useState<Analysis | null>(null);
  const [paced, setPaced] = useState(false);
  const [variant, setVariantState] = useState<1 | 2 | 3 | 4>(() => {
    try { return (Number(localStorage.getItem("tl-process-variant")) || 1) as 1 | 2 | 3 | 4; } catch { return 1; }
  });
  const [replay, setReplay] = useState(0);
  const setVariant = (v: 1 | 2 | 3 | 4) => {
    setVariantState(v); setPaced(false); setReplay((r) => r + 1);
    try { localStorage.setItem("tl-process-variant", String(v)); } catch {}
  };
  const finish = useCallback(() => setPaced(true), []);
  // The verdict is revealed only after the paced sequence has finished.
  const result = paced ? fetched : null;
  const [failed, setFailed] = useState(false);
  const started = useRef<string | null>(null);

  useEffect(() => {
    setSteps({}); setFetched(null); setPaced(false); setFailed(false);
    const off = subscribe((e) => {
      if (e.type === "analysis_step" && e.data.address === address)
        setSteps((s) => ({ ...s, [e.data.step]: { status: e.data.status, lines: e.data.lines.length ? e.data.lines : s[e.data.step]?.lines ?? [] } }));
      if (e.type === "analysis_done" && e.data.address === address) getAnalysis(address).then(setFetched);
    });
    if (started.current !== `${address}:${row.txHash}`) {
      started.current = `${address}:${row.txHash}`;
      analyze(address).then((ok) => !ok && setFailed(true));
    }
    return off;
  }, [address, row.txHash]);


  return (
    <div className="space-y-2">
      {/* Who + verdict */}
      <Card>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <a href={accountUrl(address, "solana-devnet")} target="_blank" rel="noreferrer" className="block truncate font-mono text-[13px] text-muted hover:text-ink">{short(address, 10)}</a>
            <AnimatePresence mode="wait">
              {result ? (
                <motion.div key="r" initial={{ opacity: 0, y: 6, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} className="mt-1 text-3xl font-medium tracking-tight text-ink">{result.label}</motion.div>
              ) : (
                <motion.div key="p" exit={{ opacity: 0 }} className="mt-1 flex items-center gap-2 text-2xl font-medium tracking-tight text-dim">
                  {failed ? "Analysis failed" : <>Analyzing<Dots /></>}
                </motion.div>
              )}
            </AnimatePresence>
            {result && <div className="mt-1.5 text-xs text-muted">{Math.round(result.confidence * 100)}% of the evidence weight{result.ranking[1]?.weight ? ` · runner-up ${result.ranking[1].label}` : ""}</div>}
          </div>
          <Ring score={result?.score ?? null} />
        </div>
        {result && (
          <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="mt-3 space-y-1 border-t border-line/70 pt-3 text-[13px] text-ink">
            {result.reasons.map((r) => <li key={r} className="flex gap-2"><span className="text-accent">→</span>{r}</li>)}
          </motion.ul>
        )}
      </Card>

      {/* This payment, as captured by the SDK */}
      <Card title="This payment">
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          <span className="text-muted">Bought</span><span className="font-mono text-ink">{c.endpoint.replace("/api/paid", "")}</span>
          <span className="text-muted">Asked for</span><span className="text-ink">{paramSummary(c.params) || "no parameters"}</span>
          <span className="text-muted">Client</span><span className="text-ink">{c.client ?? "unknown"}</span>
          <span className="text-muted">Paid</span>
          <span className="text-ink">{usd(row.amountUsd)} · <a href={explorer(row.txHash, "solana-devnet")} target="_blank" rel="noreferrer" className="font-mono underline decoration-line-2 underline-offset-2 hover:decoration-ink">{short(row.txHash, 6)}</a></span>
        </div>
      </Card>

      {/* Live analysis, paced */}
      <Card title="Building the profile" right={
        <div className="flex rounded-md bg-sunk p-0.5 text-xs">
          {([1, 2, 3, 4] as const).map((v) => (
            <button key={v} onClick={() => setVariant(v)} className={`rounded-[5px] px-2 py-0.5 tabular-nums ${variant === v ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"}`}>{v}</button>
          ))}
        </div>
      }>
        <Process key={`${row.txHash}-${variant}-${replay}`} variant={variant} raw={steps} onFinished={finish} />
      </Card>

      {result && (
        <Link href={`/business?dataset=real&wallet=${address}`} className="flex items-center justify-between rounded-md bg-ink px-4 py-3 text-sm font-medium text-card hover:brightness-125">
          <span>Open full profile in Business</span><span>→</span>
        </Link>
      )}
    </div>
  );
}

function Ring({ score }: { score: number | null }) {
  const r = 26, C = 2 * Math.PI * r;
  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--sunk)" strokeWidth="4" />
        <motion.circle cx="32" cy="32" r={r} fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" strokeDasharray={C}
          initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: score == null ? C : C * (1 - score / 100) }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-xl font-medium tabular-nums text-ink">{score ?? "–"}</div>
    </div>
  );
}
const Dots = () => (
  <span className="inline-flex gap-0.5">
    {[0, 1, 2].map((i) => <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-dim" animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1, delay: i * 0.15 }} />)}
  </span>
);
