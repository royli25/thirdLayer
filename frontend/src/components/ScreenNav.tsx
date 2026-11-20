"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { useMode } from "@/lib/live";

const SCREENS = [
  { href: "/seller", label: "Seller" },
  { href: "/business", label: "Business" },
] as const;

export function ScreenNav({ right }: { right?: React.ReactNode }) {
  const path = usePathname();
  const mode = useMode();
  return (
    <header className="flex items-center justify-between rounded-lg bg-panel px-4 py-3">
      <div className="flex items-center gap-5">
        <h1 className="text-xl font-medium tracking-tight text-ink">third<span className="text-accent">Layer</span></h1>
        <nav className="flex rounded-md bg-sunk p-0.5 text-[13px] font-medium">
          {SCREENS.map((s) => {
            const on = path.startsWith(s.href);
            return (
              <Link key={s.href} href={s.href} className="relative px-3.5 py-1.5">
                {on && <motion.span layoutId="screen" className="absolute inset-0 rounded-[5px] bg-card shadow-sm" transition={{ type: "spring", bounce: 0.15, duration: 0.4 }} />}
                <span className={`relative ${on ? "text-ink" : "text-muted hover:text-ink"}`}>{s.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        {right}
        {mode === "mock" && (
          <span className="flex items-center gap-1.5 rounded-md bg-flag/10 px-2.5 py-1.5 text-xs font-medium text-flag">
            <span className="h-1.5 w-1.5 rounded-full bg-flag" />Backend offline
          </span>
        )}
      </div>
    </header>
  );
}
