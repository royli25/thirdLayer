"use client";
import { AnimatePresence, motion } from "motion/react";

type Line = { t: string; add?: boolean };

// The seller's real server (backend/src/server.ts), trimmed to what matters.
const CODE: Line[] = [
  { t: `import { Hono } from "hono";` },
  { t: `import { paymentMiddleware } from "@x402/hono";` },
  { t: `import { thirdLayer } from "@thirdlayer/sdk";`, add: true },
  { t: `` },
  { t: `const app = new Hono();` },
  { t: `` },
  { t: `app.use("/api/*", thirdLayer.track({`, add: true },
  { t: `  key: env.THIRDLAYER_KEY }));`, add: true },
  { t: `app.use("/api/*", paymentMiddleware(routes));` },
  { t: `` },
  { t: `app.get("/api/price", priceHandler);` },
  { t: `app.get("/api/sentiment", sentimentHandler);` },
  { t: `app.get("/api/whales", whalesHandler);` },
];

export function CodePanel({ enabled, busy, onToggle }: { enabled: boolean; busy: boolean; onToggle: () => void }) {
  let n = 0;
  return (
    <div className="rounded-md bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="font-mono text-[13px] text-muted">server.ts</span>
        <button
          onClick={onToggle}
          disabled={busy}
          aria-pressed={enabled}
          className="flex items-center gap-2.5 rounded-md bg-sunk py-1 pl-3 pr-1 text-[13px] font-medium text-ink transition-opacity disabled:opacity-60"
        >
          thirdLayer SDK
          <span className={`relative h-6 w-11 rounded-full transition-colors duration-200 ${enabled ? "bg-verify" : "bg-line-2"}`}>
            <motion.span
              className="absolute top-0.5 h-5 w-5 rounded-full bg-card shadow-sm"
              animate={{ left: enabled ? 22 : 2 }}
              transition={{ type: "spring", bounce: 0.2, duration: 0.35 }}
            />
          </span>
        </button>
      </div>
      <pre className="overflow-x-auto rounded-md bg-sunk/60 py-3 font-mono text-[12px] leading-[1.7]">
        <AnimatePresence initial={false}>
          {CODE.map((l, i) => {
            if (l.add && !enabled) return null;
            const ln = ++n;
            return (
              <motion.div
                key={i}
                layout
                initial={l.add ? { opacity: 0, height: 0 } : false}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                className={`flex overflow-hidden ${l.add ? "bg-verify/12" : ""}`}
              >
                <span className="w-9 shrink-0 select-none pr-3 text-right text-dim">{ln}</span>
                <span className={`w-4 shrink-0 select-none ${l.add ? "text-verify" : "text-transparent"}`}>+</span>
                <span className={`whitespace-pre pr-4 ${l.add ? "text-ink" : "text-muted"}`}>{l.t || " "}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </pre>
    </div>
  );
}
