"use client";
import { AnimatePresence, motion } from "motion/react";
import { explorer, short } from "@/lib/api";
import type { PaymentRow, Segment } from "@/lib/segments";

export const usd = (n: number) => n > 0 && n < 0.01 ? "<$0.01" : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const num = (n: number) => n.toLocaleString();
export const plural = (n: number, word: string) => `${num(n)} ${word}${n === 1 ? "" : "s"}`;
export const cadence = (s: number | null) =>
  s == null ? "one-off" : s < 60 ? `every ~${Math.round(s)}s` : s < 3600 ? `every ~${Math.round(s / 60)} min` : s < 86400 ? `every ~${Math.round(s / 3600)} h` : `every ~${Math.round(s / 86400)} d`;

/* ---------------- Payments: slim bar that expands ---------------- */
export function PaymentsBar({ open, onToggle, count, revenue, live, pulse, rows, onPayer }: {
  open: boolean; onToggle: () => void; count: number; revenue: number; live: boolean; pulse: number;
  rows: (PaymentRow & { fresh?: boolean })[]; onPayer: (a: string) => void;
}) {
  return (
    <section className="flex min-h-0 flex-col rounded-lg bg-panel">
      <button onClick={onToggle} className="flex items-center justify-between gap-3 px-4 py-3.5 text-left">
        <span className="flex items-baseline gap-2 text-sm">
          <motion.span key={count} initial={{ y: -4, opacity: 0.4 }} animate={{ y: 0, opacity: 1 }} className="text-lg font-medium tabular-nums tracking-tight text-ink">{num(count)}</motion.span>
          <span className="text-muted">{count === 1 ? "payment" : "payments"}</span>
          <span className="text-dim">·</span>
          <motion.span key={`r${count}`} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} className="font-medium tabular-nums text-accent">{usd(revenue)}</motion.span>
        </span>
        <span className="flex items-center gap-3">
          {live && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-verify">
              <span className="relative flex h-2 w-2">
                <motion.span key={pulse} className="absolute inset-0 rounded-full bg-verify" initial={{ scale: 1, opacity: 0.7 }} animate={{ scale: 3, opacity: 0 }} transition={{ duration: 1.1 }} />
                <span className="relative h-2 w-2 rounded-full bg-verify" />
              </span>
              live
            </span>
          )}
          <motion.span animate={{ rotate: open ? 180 : 0 }} className="text-muted">⌄</motion.span>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
            <div className="scroll-thin max-h-[34vh] space-y-1.5 overflow-y-auto px-4 pb-4">
              {rows.length === 0 && <p className="py-2 text-sm text-dim">No payments yet</p>}
              {rows.map((r) => (
                <motion.div key={r.txHash} layout initial={r.fresh ? { opacity: 0, y: -6 } : false} animate={{ opacity: 1, y: 0 }}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 rounded-md bg-card px-3 py-2 text-[13px]">
                  <span className="truncate">
                    <button onClick={() => onPayer(r.payer)} className="font-mono text-ink hover:text-accent">{short(r.payer, 5)}</button>
                    <span className="text-dim"> → </span><span className="text-muted">{r.endpoint}</span>
                  </span>
                  <span className="font-medium tabular-nums text-accent">{usd(r.amountUsd)}</span>
                  <a href={explorer(r.txHash, r.network)} target="_blank" rel="noreferrer" className="truncate font-mono text-[11px] text-dim hover:text-muted">{short(r.txHash, 8)}</a>
                  <span className="text-[11px] text-dim">{new Date(r.ts).toLocaleTimeString()}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/* ---------------- Segment cards ---------------- */
export function SegmentCard({ s, active, onClick, i }: { s: Segment; active: boolean; onClick: () => void; i: number }) {
  return (
    <motion.button initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} onClick={onClick}
      className={`w-full rounded-md px-4 py-3.5 text-left transition-colors ${active ? "bg-card ring-1 ring-inset ring-accent/50" : "bg-card/60 hover:bg-card"}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[15px] font-medium text-ink">{s.label}</span>
        <span className="tabular-nums text-ink">{usd(s.revenueUsd)}</span>
      </div>
      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-sunk">
        <motion.div className={`h-full rounded-full ${active ? "bg-accent" : "bg-line-2"}`} initial={{ width: 0 }} animate={{ width: `${s.share * 100}%` }} transition={{ duration: 0.7, delay: 0.1 + i * 0.04, ease: [0.22, 1, 0.36, 1] }} />
      </div>
    </motion.button>
  );
}

/* ---------------- Segment profile ---------------- */
export function SegmentProfile({ s }: { s: Segment }) {
  const mixMax = Math.max(1, ...s.endpointMix.map((e) => e.count));
  const mixTotal = s.endpointMix.reduce((a, e) => a + e.count, 0) || 1;
  const hMax = Math.max(1, ...s.hourly);
  const peak = s.hourly.indexOf(Math.max(...s.hourly));
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-5 divide-x divide-line/70 rounded-md bg-card py-4">
        <Stat value={usd(s.revenueUsd)} label={`${Math.round(s.share * 100)}% of revenue`} accent />
        <Stat value={num(s.walletCount)} label={s.walletCount === 1 ? "wallet" : "wallets"} />
        <Stat value={num(s.paymentCount)} label="payments" />
        <Stat value={s.avgCallsPerWallet.toFixed(1)} label="calls per wallet" />
        <Stat value={cadence(s.medianGapSec).replace("every ", "")} label="between calls" />
      </div>

      <div className="rounded-md bg-accent/10 p-4">
        <div className="text-[15px] font-medium text-accent">{s.action.title}</div>
        <p className="mt-1 text-[13px] leading-relaxed text-ink/80">{s.action.detail}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Card title="What they buy">
          <div className="space-y-2.5">
            {s.endpointMix.map((e, i) => (
              <div key={e.endpoint}>
                <div className="flex justify-between text-[13px]">
                  <span className="font-mono text-ink">{e.endpoint.replace("/api/paid/", "/")}</span>
                  <span className="tabular-nums text-muted">{Math.round((e.count / mixTotal) * 100)}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunk">
                  <motion.div className="h-full rounded-full bg-accent" initial={{ width: 0 }} animate={{ width: `${(e.count / mixMax) * 100}%` }} transition={{ duration: 0.6, delay: i * 0.06 }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="When they buy">
          <div className="flex h-24 items-end gap-[3px] pt-5">
            {s.hourly.map((v, h) => (
              <motion.div key={h} className={`relative flex-1 rounded-[2px] ${h === peak ? "bg-accent" : "bg-line-2"}`}
                initial={{ height: 0 }} animate={{ height: `${Math.max(4, (v / hMax) * 100)}%` }} transition={{ duration: 0.5, delay: h * 0.012 }}>
                {h === peak && <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] tabular-nums text-accent">{String(peak).padStart(2, "0")}:00</span>}
              </motion.div>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-dim"><span>00</span><span>06</span><span>12</span><span>18</span><span>23 UTC</span></div>
        </Card>
      </div>

      {s.topSellers.length > 0 && (
        <Card title="Also buys from">
          {s.topSellers.map((x) => (
            <div key={x.payTo} className="flex items-center justify-between border-b border-line/70 py-2 text-[13px] last:border-0">
              <span className="truncate text-ink">{x.name}</span>
              <span className="shrink-0 text-[13px] tabular-nums text-muted">{plural(x.wallets, "wallet")} · <span className="text-ink">{usd(x.totalUsd)}</span></span>
            </div>
          ))}
        </Card>
      )}

      {(s.topProtocols.length > 0 || s.topTokens.length > 0) && (
        <Card title="On-chain">
          {s.topProtocols.length > 0 && (
            <div className="mb-3 space-y-1.5">
              {s.topProtocols.map((p) => (
                <div key={p.name} className="flex justify-between text-[13px]">
                  <span className="text-ink">{p.name}</span>
                  <span className="tabular-nums text-muted">{plural(p.wallets, "wallet")}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {s.topTokens.map((t) => (
              <span key={t.symbol} className="rounded-md bg-sunk/70 px-2 py-1 text-xs text-muted">{t.symbol} <span className="font-medium tabular-nums text-ink">{t.wallets}</span></span>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

const Stat = ({ label, value, accent }: { label: string; value: string; accent?: boolean }) => (
  <div className="min-w-0 px-4">
    <div className={`truncate text-xl font-medium tabular-nums tracking-tight ${accent ? "text-accent" : "text-ink"}`}>{value}</div>
    <div className="truncate text-[13px] text-muted">{label}</div>
  </div>
);

export function Card({ title, right, children }: { title?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-card p-4">
      {title && <div className="mb-2.5 flex items-center justify-between"><h3 className="text-sm font-medium text-ink">{title}</h3>{right}</div>}
      {children}
    </div>
  );
}
