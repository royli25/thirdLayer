/**
 * Create N anonymous fleet wallets with independently sampled traits.
 *   bun run fleet:create 30
 * Then fund them:  bun run fund 0.28 'w-*'
 */
import { createFleet } from "../src/agents/fleet";

const n = Number(process.argv[2] ?? 30);
const members = await createFleet(n);
for (const m of members) {
  const top = Object.entries(m.traits.mix).sort((a, b) => b[1] - a[1])[0]!;
  console.log(
    `${m.name} ${m.address.slice(0, 6)}…  top=${top[0].split("/").pop()}(${Math.round(top[1] * 100)}%)  gap≈${m.traits.meanGapSec}s  ` +
      `burst=${m.traits.burst.max}  max=${m.traits.maxCalls}  ext=${m.traits.extSellers.map((e) => e.key).join(",") || "-"}  ua=${m.traits.userAgent}`,
  );
}
console.log(`created ${members.length} wallets. Fund them: bun run fund 0.28 'w-*'`);
