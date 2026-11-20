"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Header } from "@/components/Header";
import { Analyzer } from "@/components/seller/Analyzer";
import { Card, usd } from "@/components/business/parts";
import { CodePanel } from "@/components/seller/CodePanel";
import { ScreenNav } from "@/components/ScreenNav";
import { accountUrl, explorer, getAgents, short, subscribe, trigger } from "@/lib/api";
import { getOnchain, getSdk, paramSummary, setSdk, type InflowRow, type OnchainResponse } from "@/lib/seller";
import type { ServerEvent } from "@/lib/types";

// Data the seller never got: rendered as unreadable, blurred text.
const Unknown = ({ w = "w-16", text = "/endpoint" }: { w?: string; text?: string }) => (
  <span aria-label="unknown" className={`inline-block ${w} select-none truncate align-middle text-xs text-muted blur-[3.5px]`}>{text}</span>
);

const ago = (ts: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(ts)) / 1000);
  return s < 60 ? `${Math.round(s)}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};

export default function SellerPage() {
  const [sdk, setSdkState] = useState<boolean | null>(null);
  const [toggling, setToggling] = useState(false);
  const [data, setData] = useState<OnchainResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [personas, setPersonas] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "bad" | "muted"; text: string } | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string> | null>(null);
  const [toasts, setToasts] = useState<{ address: string; id: number }[]>([]);
  useEffect(() => {
    if (!toasts.length) return;
    const t = setTimeout(() => setToasts((x) => x.slice(0, -1)), 9000);
    return () => clearTimeout(t);
  }, [toasts]);
  const openWallet = (addr: string) => {
    const r = data?.rows.find((x) => x.from === addr && x.captured);
    if (r) setSelected(r.txHash);
    setToasts((t) => t.filter((x) => x.address !== addr));
  };

  const load = useCallback(async () => {
    const d = await getOnchain();
    if (!d) return;
    const ids = new Set(d.rows.map((r) => r.txHash));
    if (seen.current) {
      const nu = d.rows.filter((r) => !seen.current!.has(r.txHash)).map((r) => r.txHash);
      if (nu.length) {
        const hit = d.rows.find((r) => r.txHash === nu[0]);
        setStatus(d.sdkEnabled && hit?.captured
          ? { tone: "ok", text: `Received on-chain · thirdLayer captured who paid and what they bought` }
          : { tone: "muted", text: `Received on-chain · you got paid, but you don't know who or for what` });
        setFresh(new Set(nu));
        setTimeout(() => setFresh(new Set()), 2600);
      }
    }
    seen.current = ids;
    setData(d);
    setSdkState(d.sdkEnabled);

  }, []);

  useEffect(() => {
    getSdk().then((e) => e != null && setSdkState(e));
    getAgents().then((as) => setPersonas(as.map((a) => a.persona).filter((p) => p !== "hero-agent")));
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => subscribe((e: ServerEvent) => {
    if (e.type === "agent_response") {
      pending.current = Math.max(0, pending.current - 1);
      if (pending.current === 0) setSending(false);
      setStatus(e.data.status === 200
        ? { tone: "ok", text: `Agent paid ${usd(e.data.amountUsd)} for ${e.data.endpoint.split("/").pop()} · waiting for the chain…` }
        : { tone: "bad", text: `Payment failed (${e.data.status})` });
      // On-chain view lags settlement by a few seconds; poll a little faster.
      [2000, 4500, 8000].forEach((ms) => setTimeout(load, ms));
    }
    if (e.type === "payment_failed") { setSending(false); setStatus({ tone: "bad", text: `Payment failed · ${e.data.reason}` }); }
    if (e.type === "wallet_flagged") setToasts((t) => [{ address: e.data.address, id: Date.now() }, ...t.filter((x) => x.address !== e.data.address)].slice(0, 3));
  }), [load]);

  const toggle = async () => {
    if (sdk == null) return;
    setToggling(true);
    const next = await setSdk(!sdk);
    if (next != null) setSdkState(next);
    setToggling(false);
    load();
  };

  const BATCH = 5;
  const pending = useRef(0);
  const send = async () => {
    if (!personas.length) return;
    setSending(true);
    pending.current = BATCH;
    setStatus({ tone: "muted", text: `${BATCH} agents are paying…` });
    for (let i = 0; i < BATCH; i++) {
      const err = await trigger("fleet"); // unnamed -> backend picks a random fleet wallet each time
      if (err) { pending.current--; setStatus({ tone: "bad", text: err }); }
      if (i < BATCH - 1) await new Promise((r) => setTimeout(r, 1200)); // stagger: public devnet RPC rate-limits bursts
    }
    if (pending.current <= 0) setSending(false);
    setTimeout(() => setSending(false), 60000);
  };

  const on = !!sdk;
  const rows = data?.rows ?? [];
  const row = rows.find((r) => r.txHash === selected) ?? null;
  const t = data?.totals;

  return (
    <main className="flex h-screen flex-col gap-2 p-2">
      <ScreenNav />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(430px,1.05fr)_minmax(440px,1.25fr)_minmax(360px,0.95fr)] gap-2">
        {/* Your API */}
        <section className="scroll-thin flex min-h-0 flex-col overflow-y-auto rounded-lg bg-panel">
          <Header title="Your API" />
          <div className="space-y-2 px-4 pb-4">
            <CodePanel enabled={on} busy={toggling || sdk == null} onToggle={toggle} />
            <button
              onClick={send}
              disabled={sending || !personas.length}
              className="w-full rounded-md bg-accent py-2.5 text-sm font-medium text-card transition-[transform,opacity,filter] hover:brightness-105 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
            >
              {sending ? "Agents paying…" : "Send 5 agent payments · $0.05"}
            </button>
            <AnimatePresence mode="wait">
              {status && (
                <motion.p key={status.text} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className={`px-1 text-[13px] ${status.tone === "ok" ? "text-verify" : status.tone === "bad" ? "text-flag" : "text-muted"}`}>
                  {status.text}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </section>

        {/* Payments received */}
        <section className="relative flex min-h-0 flex-col rounded-lg bg-panel">
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 flex w-[min(420px,90%)] -translate-x-1/2 flex-col gap-2">
            <AnimatePresence>
              {toasts.map((t) => (
                <motion.button key={t.id} layout initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}
                  transition={{ type: "spring", bounce: 0.25, duration: 0.45 }} onClick={() => openWallet(t.address)}
                  className="pointer-events-auto flex items-center justify-between gap-3 rounded-md bg-ink px-4 py-3 text-left text-sm text-card shadow-lg">
                  <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-accent" />New customer <span className="font-mono text-card/70">{short(t.address, 4)}</span></span>
                  <span className="font-medium">View →</span>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
          <Header title="Payments received" />
          <div className="grid grid-cols-4 gap-2 px-4 pb-3">
            <Stat label="Revenue" value={t ? usd(t.revenueUsd) : "…"} accent />
            <Stat label="Payments" value={t ? String(t.payments) : "…"} />
            <Stat label="Wallets" value={t ? String(t.senders) : "…"} />
            <Identified on={on} captured={t ? t.captured : null} total={t?.payments ?? 0} />
          </div>
          <div className="grid grid-cols-[60px_118px_48px_1fr_104px] gap-3 px-7 pb-1.5 text-xs font-medium text-muted">
            <span>Time</span><span>From</span><span className="text-right">Amount</span><span>Bought</span><span>Client</span>
          </div>
          <div className="scroll-thin min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 pb-4">
            {rows.length === 0 && <p className="px-3 py-2 text-sm text-dim">{data ? "No payments yet" : "Reading the chain…"}</p>}
            {rows.map((r) => (
              <PaymentRow key={r.txHash} r={r} on={on} active={r.txHash === selected} fresh={fresh.has(r.txHash)} onClick={() => setSelected(r.txHash)} />
            ))}
          </div>
        </section>

        {/* Customer */}
        <section className="scroll-thin flex min-h-0 flex-col overflow-y-auto rounded-lg bg-panel">
          <Header title="Customer" />
          <div className="px-4 pb-4">
            {!row ? (
              <p className="py-2 text-sm text-dim">Select a payment</p>
            ) : row.captured && row.from ? (
              <Analyzer key={row.txHash} row={row} />
            ) : (
              <UnknownCustomer r={row} />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function Identified({ on, captured, total }: { on: boolean; captured: number | null; total: number }) {
  const pct = captured == null || !total ? 0 : captured / total;
  const lit = (captured ?? 0) > 0;
  return (
    <motion.div animate={{ backgroundColor: lit ? "rgba(46,122,87,0.12)" : "var(--card)" }} transition={{ duration: 0.5 }} className="relative overflow-hidden rounded-md p-3">
      <div className={`text-xs font-medium ${lit ? "text-verify" : "text-muted"}`}>Identified</div>
      <div className="mt-1 flex items-baseline gap-1 tabular-nums tracking-tight">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={captured ?? "x"} initial={{ y: 10, opacity: 0, scale: 1.3 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -10, opacity: 0 }}
            transition={{ type: "spring", bounce: 0.35, duration: 0.5 }}
            className={`text-lg font-medium ${lit ? "text-verify" : "text-dim"}`}>{captured ?? "…"}</motion.span>
        </AnimatePresence>
        <span className="text-sm text-muted">of {total}</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-1 bg-sunk">
        <motion.div className="h-full bg-verify" initial={false} animate={{ width: `${pct * 100}%` }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
      </div>
    </motion.div>
  );
}

function Stat({ label, value, accent, tone }: { label: string; value: string; accent?: boolean; tone?: string }) {
  return (
    <div className="rounded-md bg-card p-3">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-1 truncate text-lg font-medium tabular-nums tracking-tight ${tone ?? (accent ? "text-accent" : "text-ink")}`}>{value}</div>
    </div>
  );
}

function PaymentRow({ r, on, active, fresh, onClick }: { r: InflowRow; on: boolean; active: boolean; fresh: boolean; onClick: () => void }) {
  const c = r.captured; // a capture is permanent; the toggle only affects new payments
  return (
    <motion.button
      layout
      initial={fresh ? { opacity: 0, y: -6 } : false}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className={`relative grid w-full grid-cols-[60px_118px_48px_1fr_104px] items-center gap-3 rounded-md px-3 py-2.5 text-left text-[13px] transition-colors ${active ? "bg-card ring-1 ring-inset ring-accent/50" : "bg-card/60 hover:bg-card"}`}
    >
      {fresh && <motion.span className="absolute inset-0 rounded-md ring-2 ring-inset ring-accent" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 2.4 }} />}
      <span className="tabular-nums text-muted">{ago(r.ts)}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-mono text-ink">{r.from ? short(r.from, 4) : "unknown"}</span>
        {c && !c.analyzed && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title="New customer, not analyzed yet" />}
      </span>
      <span className="text-right font-medium tabular-nums text-accent">{usd(r.amountUsd)}</span>
      <Cell show={!!c} placeholder="/sentiment 24h">{c && <span className="truncate"><span className="font-mono text-ink">/{c.endpoint.split("/").pop()}</span>{paramSummary(c.params) && <span className="ml-1.5 text-xs text-muted">{paramSummary(c.params)}</span>}</span>}</Cell>
      <Cell show={!!c} placeholder="Node (axios)">{c && <span className="truncate text-xs text-ink">{c.client ?? "unknown"}</span>}</Cell>
    </motion.button>
  );
}

function Cell({ show, placeholder, children }: { show: boolean; placeholder: string; children: React.ReactNode }) {
  return (
    <span className="min-w-0 truncate">
      <AnimatePresence mode="wait" initial={false}>
        {show ? (
          <motion.span key="v" initial={{ opacity: 0, filter: "blur(3px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} transition={{ duration: 0.35 }} className="block truncate">{children}</motion.span>
        ) : (
          <motion.span key="u" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><Unknown w="w-full" text={placeholder} /></motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

function UnknownCustomer({ r }: { r: InflowRow }) {
  const fields = ["Bought", "Agent type", "Segment", "Customer score", "Also buys from", "On-chain activity"];
  return (
    <div className="space-y-2">
      <Card>
        {r.from ? (
          <a href={accountUrl(r.from, "solana-devnet")} target="_blank" rel="noreferrer" className="block truncate font-mono text-[13px] text-muted hover:text-ink">{r.from}</a>
        ) : <span className="text-[13px] text-dim">Sender unknown</span>}
        <div className="mt-1 text-2xl font-medium tracking-tight text-dim">Unknown wallet</div>
        <div className="mt-1.5 text-xs text-muted">
          Paid {usd(r.amountUsd)} · {new Date(r.ts).toLocaleTimeString()} ·{" "}
          <a href={explorer(r.txHash, "solana-devnet")} target="_blank" rel="noreferrer" className="underline decoration-line-2 underline-offset-2 hover:text-ink">{short(r.txHash, 6)}</a>
        </div>
      </Card>
      <Card>
        <div className="space-y-2.5">
          {fields.map((f) => (
            <div key={f} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="text-muted">{f}</span>
              <Unknown w={f === "On-chain activity" ? "w-28" : "w-20"} text={f === "Bought" ? "/x402-pulse" : f === "Segment" ? "Researchers" : f === "Customer score" ? "72" : "Chain Radar"} />
            </div>
          ))}
        </div>
      </Card>
      <p className="px-1 text-[13px] text-muted">
        {`thirdLayer was off for this payment. All the chain tells you: an address and ${usd(r.amountUsd)}.`}
      </p>
    </div>
  );
}
