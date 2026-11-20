"use client";
/**
 * Presentation of the live analysis. The backend does the real work and streams results;
 * this layer paces how they are revealed: one step at a time, with uneven, human-feeling
 * timing (on-chain reads take the longest), then the findings line by line.
 *
 * Four prototype variants (1–4) share the same pacing engine.
 */
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

export type RawStep = { status: "running" | "done"; lines: string[] };

export const STEPS = [
  { k: "purchases", verb: "Checking what they bought", done: "Checked purchases", base: 900 },
  { k: "params", verb: "Reading what they asked for", done: "Read request parameters", base: 1300 },
  { k: "client", verb: "Fingerprinting their client", done: "Fingerprinted client", base: 650 },
  { k: "cadence", verb: "Measuring how often they call", done: "Measured call rhythm", base: 1500 },
  { k: "pricing", verb: "Comparing price seen vs paid", done: "Compared price seen vs paid", base: 1050 },
  { k: "onchain", verb: "Identifying previous on-chain spending", done: "Identified on-chain spending", base: 2900 },
  { k: "decide", verb: "Deciding customer type", done: "Decided customer type", base: 1700 },
] as const;
const SOURCE: Record<string, string> = { purchases: "SDK", params: "SDK", client: "SDK", cadence: "SDK", pricing: "SDK", onchain: "On-chain", decide: "" };

type Shown = { i: number; phase: "checking" | "done"; lines: number }; // current step index, its phase, evidence lines revealed

/** Reveals steps sequentially with irregular delays. Never runs ahead of real data. */
function usePacer(raw: Record<string, RawStep>, onFinished: () => void) {
  const [s, setS] = useState<Shown>({ i: 0, phase: "checking", lines: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finished = useRef(false);
  const jitter = useRef(STEPS.map(() => 0.55 + Math.random() * 1.05));

  useEffect(() => {
    if (finished.current) return;
    const step = STEPS[s.i];
    if (!step) return;
    const data = raw[step.k];
    const clear = () => { if (timer.current) clearTimeout(timer.current); };
    clear();
    if (s.phase === "checking") {
      // Wait at least the paced duration AND until the backend has the real result.
      if (data?.status !== "done") return;
      timer.current = setTimeout(() => setS((x) => ({ ...x, phase: "done", lines: 0 })), step.base * jitter.current[s.i]!);
    } else if (s.lines < (data?.lines.length ?? 0)) {
      timer.current = setTimeout(() => setS((x) => ({ ...x, lines: x.lines + 1 })), 140 + Math.random() * 260);
    } else if (s.i < STEPS.length - 1) {
      timer.current = setTimeout(() => setS({ i: s.i + 1, phase: "checking", lines: 0 }), 250 + Math.random() * 550);
    } else {
      finished.current = true;
      timer.current = setTimeout(onFinished, 500);
    }
    return clear;
  }, [s, raw, onFinished]);

  return s;
}

const state = (sh: Shown, i: number) => (i < sh.i ? "done" : i === sh.i ? sh.phase : "todo");
const linesFor = (sh: Shown, i: number, raw: Record<string, RawStep>) => {
  const all = raw[STEPS[i]!.k]?.lines ?? [];
  return i < sh.i ? all : i === sh.i && sh.phase === "done" ? all.slice(0, sh.lines) : [];
};

/** Dots that grow irregularly: "", ".", "..", "...", sometimes stalling. */
function GrowingDots() {
  const [n, setN] = useState(0);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const tick = () => { setN((x) => (x + 1) % 4); t = setTimeout(tick, 180 + Math.random() * 520); };
    t = setTimeout(tick, 200);
    return () => clearTimeout(t);
  }, []);
  return <span className="inline-block w-[1.5em] text-left">{".".repeat(n)}</span>;
}

const Check = () => (
  <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", bounce: 0.5, duration: 0.35 }} className="text-verify">✓</motion.span>
);

export function Process({ variant, raw, onFinished }: { variant: 1 | 2 | 3 | 4; raw: Record<string, RawStep>; onFinished: () => void }) {
  const sh = usePacer(raw, onFinished);
  if (variant === 2) return <Terminal sh={sh} raw={raw} />;
  if (variant === 3) return <Focus sh={sh} raw={raw} />;
  if (variant === 4) return <Ledger sh={sh} raw={raw} />;
  return <Log sh={sh} raw={raw} />;
}

/* 1 · Log — plain sentences, growing dots, "check!" appended inline, findings beneath */
function Log({ sh, raw }: { sh: Shown; raw: Record<string, RawStep> }) {
  return (
    <ol className="space-y-2.5 text-[13.5px]">
      {STEPS.map((st, i) => {
        const p = state(sh, i);
        if (p === "todo") return null;
        return (
          <motion.li key={st.k} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
            <div className={p === "checking" ? "text-ink" : "text-muted"}>
              {st.verb}{p === "checking" ? <GrowingDots /> : <>... <Check /></>}
            </div>
            <ul className="mt-0.5 space-y-0.5 pl-4 text-[12.5px] text-ink">
              {linesFor(sh, i, raw).map((l, j) => <motion.li key={j} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{l}</motion.li>)}
            </ul>
          </motion.li>
        );
      })}
    </ol>
  );
}

/* 2 · Terminal — monospace, dot leaders that fill toward the status column */
function Terminal({ sh, raw }: { sh: Shown; raw: Record<string, RawStep> }) {
  return (
    <div className="rounded-md bg-sunk/70 p-3 font-mono text-[12px] leading-relaxed">
      {STEPS.map((st, i) => {
        const p = state(sh, i);
        if (p === "todo") return null;
        return (
          <div key={st.k}>
            <div className="flex gap-2">
              <span className="text-dim">›</span>
              <span className={p === "checking" ? "text-ink" : "text-muted"}>{st.verb.toLowerCase()}</span>
              <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-dim">
                {p === "checking" ? <Leader /> : "·".repeat(80)}
              </span>
              <span className="w-10 text-right">{p === "checking" ? <span className="text-accent">…</span> : <span className="text-verify">ok</span>}</span>
            </div>
            {linesFor(sh, i, raw).map((l, j) => (
              <motion.div key={j} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pl-4 text-ink/80">{l}</motion.div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
function Leader() {
  const [n, setN] = useState(1);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const tick = () => { setN((x) => Math.min(80, x + 1 + Math.floor(Math.random() * 3))); t = setTimeout(tick, 60 + Math.random() * 240); };
    t = setTimeout(tick, 80);
    return () => clearTimeout(t);
  }, []);
  return <>{"·".repeat(n)}</>;
}

/* 3 · Focus — one big current step; finished steps collapse to a one-line finding */
function Focus({ sh, raw }: { sh: Shown; raw: Record<string, RawStep> }) {
  const cur = STEPS[sh.i];
  return (
    <div>
      <ul className="space-y-1.5 text-[13px]">
        {STEPS.slice(0, sh.i).map((st) => (
          <motion.li key={st.k} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-baseline gap-2.5">
            <Check />
            <span className="w-44 shrink-0 text-muted">{st.done}</span>
            <span className="truncate text-ink">{raw[st.k]?.lines[0] ?? ""}</span>
          </motion.li>
        ))}
      </ul>
      {cur && (
        <div className="mt-4 rounded-md bg-sunk/60 p-4">
          <AnimatePresence mode="wait">
            <motion.div key={cur.k} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-lg font-medium tracking-tight text-ink">{cur.verb}{sh.phase === "checking" ? <GrowingDots /> : <> <Check /></>}</span>
                {SOURCE[cur.k] && <span className="shrink-0 text-xs text-muted">{SOURCE[cur.k]}</span>}
              </div>
              <ul className="mt-2 space-y-0.5 text-[13px] text-ink/80">
                {linesFor(sh, sh.i, raw).map((l, j) => <motion.li key={j} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{l}</motion.li>)}
              </ul>
            </motion.div>
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

/* 4 · Ledger — every step listed up front; status column flips from "checking…" to the key finding */
function Ledger({ sh, raw }: { sh: Shown; raw: Record<string, RawStep> }) {
  return (
    <ul className="divide-y divide-line/70 text-[13px]">
      {STEPS.map((st, i) => {
        const p = state(sh, i);
        const first = raw[st.k]?.lines[0] ?? "";
        return (
          <li key={st.k} className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-baseline gap-4 py-2.5">
            <span className={`truncate ${p === "todo" ? "text-dim" : "text-ink"}`}>{st.verb}</span>
            <span className="min-w-0 truncate text-right">
              <AnimatePresence mode="wait" initial={false}>
                {p === "todo" ? <motion.span key="t" className="text-dim">waiting</motion.span>
                  : p === "checking" ? <motion.span key="c" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-accent">checking<GrowingDots /></motion.span>
                  : <motion.span key="d" initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} className="text-ink"><Check /> {first}</motion.span>}
              </AnimatePresence>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
