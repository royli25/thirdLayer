/**
 * Realistic background traffic: the simulated fleet buys from our API (and from other x402
 * sellers) over real devnet x402 payments, each wallet following its own hidden traits.
 *
 *   bun run traffic                    # run until stopped (Ctrl-C)
 *   bun run traffic --speed 6          # compress time 6x (faster gaps, for an initial backfill)
 *   bun run traffic --minutes 20       # stop after N minutes
 *
 * Every payment is a real signed Solana devnet transaction settled by the facilitator. Our API
 * receives no hint about who the wallet is (no persona, no agent id) — only the payment.
 *
 * Rate limiting: the public devnet RPC 429s under load, so calls are globally serialized with a
 * minimum spacing and exponential backoff.
 */
import { agentCall } from "../src/agents/agents";
import { fleetAgents, isActive, pickFromMix, requestPath, type Traits } from "../src/agents/fleet";
import { config } from "../src/config";
import { loadExtSellers } from "../src/ext-sellers";

const arg = (k: string, d: number) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? Number(process.argv[i + 1]) : d;
};
const SPEED = arg("speed", 1);
const MINUTES = arg("minutes", 0);
const MIN_SPACING_MS = arg("spacing", 4500);

const fleet = fleetAgents();
if (!fleet.length) throw new Error("no fleet. Create one first: bun run fleet:create 30");
const ext = new Map(loadExtSellers().map((s) => [s.key, s]));

type State = { a: (typeof fleet)[number]; next: number; calls: number; retired: boolean; fails: number };
const expo = (meanSec: number) => -Math.log(1 - Math.random()) * meanSec * 1000;
const now = Date.now();
const states: State[] = fleet.map((a) => ({
  a,
  next: now + (a.traits.startDelaySec * 1000) / SPEED + expo(Math.min(a.traits.meanGapSec, 300)) / SPEED,
  calls: 0,
  retired: false,
  fails: 0,
}));

const stopAt = MINUTES ? now + MINUTES * 60_000 : Infinity;
let lastCall = 0;
let total = 0, ok = 0;
const sleep = (ms: number) => Bun.sleep(Math.max(0, ms));

async function pay(s: State, path: string) {
  const wait = lastCall + MIN_SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  total++;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await agentCall(s.a, path, crypto.randomUUID(), s.a.traits.userAgent);
      if (r.status === 200) {
        ok++;
        s.fails = 0;
        console.log(`${new Date().toISOString().slice(11, 19)}  ${s.a.name}  ${path.slice(0, 60).padEnd(60)} ok (${ok}/${total})`);
        return true;
      }
      const reason = JSON.stringify(r.body ?? "").slice(0, 120);
      if (/insufficient|balance/i.test(reason)) {
        s.retired = true;
        console.log(`${s.a.name} out of funds, retiring`);
        return false;
      }
      console.warn(`${s.a.name} ${path} -> ${r.status} ${reason}`);
    } catch (e) {
      console.warn(`${s.a.name} ${path} error: ${(e as Error).message.slice(0, 100)}`);
    }
    await sleep(3000 * 2 ** attempt); // 429 backoff
  }
  if (++s.fails >= 5) s.retired = true;
  return false;
}

/** Unpaid price check: GET without payment -> 402 quote. Logged by the SDK; nothing on-chain. */
async function probe(s: State, path: string) {
  const wait = lastCall + 1500 - Date.now();
  if (wait > 0) await sleep(wait);
  try {
    const r = await fetch(`${config.publicBaseUrl}${path}`, { headers: { "user-agent": s.a.traits.userAgent, "x-request-id": crypto.randomUUID() } });
    console.log(`${new Date().toISOString().slice(11, 19)}  ${s.a.name}  price check ${path.split("?")[0]} -> ${r.status}`);
  } catch {}
}

async function session(s: State) {
  const t: Traits = s.a.traits;
  if (Math.random() < t.probe.p) {
    await probe(s, requestPath(pickFromMix(t.mix), t));
    if (Math.random() < t.probe.abandon) return; // saw the price, walked away
  }
  const n = Math.random() < t.burst.p ? t.burst.min + Math.floor(Math.random() * (t.burst.max - t.burst.min + 1)) : 1;
  for (let i = 0; i < n && s.calls < t.maxCalls && !s.retired; i++) {
    if (await pay(s, requestPath(pickFromMix(t.mix), t))) s.calls++;
  }
  for (const e of t.extSellers) {
    const seller = ext.get(e.key);
    if (seller && !s.retired && Math.random() < e.p) await pay(s, seller.path);
  }
}

process.on("SIGINT", () => {
  console.log(`\nstopped. ${ok}/${total} payments settled.`);
  process.exit(0);
});
console.log(`traffic: ${fleet.length} wallets, speed ${SPEED}x, spacing ${MIN_SPACING_MS}ms${MINUTES ? `, ${MINUTES} min` : ""}`);

while (Date.now() < stopAt) {
  const live = states.filter((s) => !s.retired && s.calls < s.a.traits.maxCalls);
  if (!live.length) {
    console.log("every wallet has churned or run out of funds. done.");
    break;
  }
  const s = live.reduce((a, b) => (a.next < b.next ? a : b));
  if (s.next > Date.now()) {
    await sleep(Math.min(s.next - Date.now(), 5000));
    continue;
  }
  if (!isActive(s.a.traits)) {
    s.next = Date.now() + (15 * 60_000) / SPEED; // asleep outside its hours; check again later
    continue;
  }
  await session(s);
  s.next = Date.now() + expo(s.a.traits.meanGapSec) / SPEED;
}
console.log(`done. ${ok}/${total} payments settled.`);
