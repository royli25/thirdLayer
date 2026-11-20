"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ScreenNav } from "@/components/ScreenNav";
import { Dossier } from "@/components/Dossier";
import { WalletRow } from "@/components/Ledger";
import { PaymentsBar, SegmentCard, SegmentProfile, num } from "@/components/business/parts";
import { getPaymentsPage, getSegmentWallets, getSegments, type Dataset, type PaymentRow, type SegmentsResponse } from "@/lib/segments";
import { short, subscribe } from "@/lib/api";
import type { WalletSummary } from "@/lib/types";

export default function BusinessPage() {
  return <Suspense><BusinessScreen /></Suspense>;
}

type Tab = "profile" | "wallets" | "wallet";

function BusinessScreen() {
  const params = useSearchParams();
  const [dataset, setDataset] = useState<Dataset>(params.get("dataset") === "real" || params.get("wallet") ? "real" : "demo");
  const [data, setData] = useState<SegmentsResponse | null>(null);
  const [segKey, setSegKey] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(params.get("wallet") ? "wallet" : "profile");
  const [wallet, setWallet] = useState<string | null>(params.get("wallet"));
  const [segWallets, setSegWallets] = useState<WalletSummary[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [pay, setPay] = useState<{ count: number; revenue: number; rows: (PaymentRow & { fresh?: boolean })[] }>({ count: 0, revenue: 0, rows: [] });
  const [pulse, setPulse] = useState(0);
  const [version, setVersion] = useState(0);

  const load = useCallback(async (ds: Dataset) => {
    const [segs, p] = await Promise.all([getSegments(ds), getPaymentsPage(ds, 50)]);
    setData(segs);
    setPay({ count: p.total.count, revenue: p.total.revenueUsd, rows: p.payments });
    setSegKey((k) => (k && segs.segments.some((s) => s.key === k) ? k : [...segs.segments].sort((a, b) => b.revenueUsd - a.revenueUsd)[0]?.key ?? null));
  }, []);

  useEffect(() => { void load(dataset); }, [dataset, load]);
  useEffect(() => {
    if (dataset !== "real") return;
    const t = setInterval(() => getSegments("real").then(setData), 20000);
    return () => clearInterval(t);
  }, [dataset]);

  useEffect(() => { if (segKey) getSegmentWallets(segKey, dataset).then(setSegWallets); }, [segKey, dataset]);

  // Live traffic only exists on the real dataset.
  useEffect(() => subscribe((e) => {
    if (dataset !== "real") return;
    if (e.type === "payment_settled") {
      setPulse((n) => n + 1);
      setPay((p) => p.rows.some((r) => r.txHash === e.data.txHash) ? p : {
        count: p.count + 1, revenue: +(p.revenue + e.data.amountUsd).toFixed(2),
        rows: [{ ...e.data, fresh: true }, ...p.rows].slice(0, 50),
      });
    }
    if (e.type === "enrichment_done" || e.type === "enrichment_step") setVersion((v) => v + 1);
  }), [dataset]);

  const segments = useMemo(() => [...(data?.segments ?? [])].sort((a, b) => b.revenueUsd - a.revenueUsd), [data]);
  const seg = segments.find((s) => s.key === segKey) ?? null;

  const openWallet = (a: string) => { setWallet(a); setTab("wallet"); };
  const switchDataset = (d: Dataset) => { setDataset(d); setWallet(null); setTab("profile"); };

  const toggle = (
    <div className="flex items-center gap-2">
      <nav className="flex rounded-md bg-sunk p-0.5 text-[13px] font-medium">
        {(["real", "demo"] as const).map((d) => (
          <button key={d} onClick={() => switchDataset(d)} className="relative px-3 py-1.5">
            {dataset === d && <motion.span layoutId="ds" className="absolute inset-0 rounded-[5px] bg-card shadow-sm" transition={{ type: "spring", bounce: 0.15, duration: 0.4 }} />}
            <span className={`relative ${dataset === d ? "text-ink" : "text-muted"}`}>{d === "real" ? "Real" : "Demo"}</span>
          </button>
        ))}
      </nav>
    </div>
  );

  return (
    <main className="flex h-screen flex-col gap-2 p-2">
      <ScreenNav right={toggle} />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(330px,0.85fr)_minmax(480px,1.6fr)] gap-2">
        <div className="flex min-h-0 flex-col gap-2">
          <PaymentsBar open={payOpen} onToggle={() => setPayOpen((o) => !o)} count={pay.count} revenue={pay.revenue}
            live={dataset === "real"} pulse={pulse} rows={pay.rows} onPayer={openWallet} />
          <section className="flex min-h-0 flex-1 flex-col rounded-lg bg-panel">
            <div className="flex items-center justify-between px-4 pb-3 pt-4">
              <h2 className="text-lg font-medium tracking-tight text-ink">Segments</h2>
            </div>
            <div className="scroll-thin min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 pb-4">
              {segments.map((s, i) => (
                <SegmentCard key={`${dataset}-${s.key}`} s={s} i={i} active={s.key === segKey}
                  onClick={() => { setSegKey(s.key); if (tab !== "wallets") setTab("profile"); }} />
              ))}
            </div>
          </section>
        </div>

        <section className="flex min-h-0 flex-col rounded-lg bg-panel">
          <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4">
            <h2 className="truncate text-lg font-medium tracking-tight text-ink">{tab === "wallet" && wallet ? short(wallet, 6) : seg?.label ?? "…"}</h2>
            <nav className="flex rounded-md bg-sunk p-0.5 text-[13px] font-medium">
              {(["profile", "wallets", ...(wallet ? ["wallet"] : [])] as Tab[]).map((t) => (
                <button key={t} onClick={() => setTab(t)} className="relative px-3 py-1.5">
                  {tab === t && <motion.span layoutId="segtab" className="absolute inset-0 rounded-[5px] bg-card shadow-sm" transition={{ type: "spring", bounce: 0.15, duration: 0.4 }} />}
                  <span className={`relative ${tab === t ? "text-ink" : "text-muted"}`}>
                    {t === "profile" ? "Profile" : t === "wallets" ? `Wallets${seg ? ` · ${num(seg.walletCount)}` : ""}` : "Wallet"}
                  </span>
                </button>
              ))}
            </nav>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={`${tab}-${segKey}-${wallet}-${dataset}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                {tab === "profile" && seg && <SegmentProfile s={seg} />}
                {tab === "wallets" && (
                  <div className="space-y-1.5">
                    {segWallets.length === 0 && <p className="py-2 text-sm text-dim">No wallets in this segment</p>}
                    {segWallets.map((w) => <WalletRow key={w.address} w={w} active={wallet === w.address} onClick={() => openWallet(w.address)} />)}
                  </div>
                )}
                {tab === "wallet" && wallet && <Dossier address={wallet} version={version} dataset={dataset} bare />}
              </motion.div>
            </AnimatePresence>
          </div>
        </section>
      </div>
    </main>
  );
}
