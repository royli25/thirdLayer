"use client";
import { motion } from "motion/react";
import type { WalletSummary } from "@/lib/types";
import { short } from "@/lib/api";

export function WalletRow({ w, active, fresh, onClick }: { w: WalletSummary; active: boolean; fresh?: boolean; onClick: () => void }) {
  return (
    <motion.button layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} onClick={onClick}
      className={`relative grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${active ? "bg-card ring-1 ring-inset ring-accent/50" : "bg-card/60 hover:bg-card"}`}>
      {fresh && <motion.span className="absolute inset-0 rounded-md ring-2 ring-inset ring-flag" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 2.2 }} />}
      <span className={`h-2 w-2 rounded-full ${w.source === "mainnet" ? "bg-verify" : "bg-flag"}`} />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-mono text-[13px] text-ink">{short(w.address, 6)}</span>
          {w.source === "mainnet" && <span className="rounded-md bg-verify/12 px-1.5 text-[11px] font-medium text-verify">Market</span>}
        </span>
        <span className="block text-xs text-muted">{w.persona} · {w.paymentCount} {w.paymentCount === 1 ? "payment" : "payments"} · ${w.totalPaidUsd.toFixed(2)}</span>
      </span>
      <ScorePill score={w.score} />
    </motion.button>
  );
}

export function ScorePill({ score }: { score: number }) {
  const c = score >= 80 ? "bg-accent text-card" : score >= 55 ? "bg-sunk text-ink" : "bg-sunk text-muted";
  return <span className={`rounded-md px-2 py-0.5 text-xs font-medium tabular-nums ${c}`}>{score}</span>;
}

export const Count = ({ n }: { n: number }) => <span className="rounded-md bg-sunk px-2 py-0.5 text-xs font-medium tabular-nums text-muted">{n}</span>;
export const Label = ({ children }: { children: React.ReactNode }) => <h3 className="mb-2 text-sm font-medium text-ink">{children}</h3>;
export const Empty = ({ children }: { children: React.ReactNode }) => <p className="py-2 text-sm text-dim">{children}</p>;
