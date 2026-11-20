/**
 * Builds payment history: every agent makes paid calls according to its persona.
 * Requires the server running (bun run dev).
 *
 *   bun run seed [rounds=5]
 */
import { agentCall, loadAgents, pickEndpoint } from "../src/agents/agents";

const rounds = Number(process.argv[2] ?? 5);
const agents = loadAgents();
// Trading bots buy more often per round than the others.
const callsPerRound: Record<string, number> = { "trading-bot": 3, "whale-watcher": 2 };

let ok = 0,
  fail = 0;
for (let r = 1; r <= rounds; r++) {
  await Promise.all(
    agents.map(async (a) => {
      for (let k = 0; k < (callsPerRound[a.persona] ?? 1); k++) {
        const ep = pickEndpoint(a.persona);
        try {
          const res = await agentCall(a, ep);
          if (res.status === 200) ok++;
          else {
            fail++;
            console.warn(`${a.name} ${ep} -> ${res.status}`, JSON.stringify(res.body)?.slice(0, 200));
          }
        } catch (e) {
          fail++;
          console.warn(`${a.name} ${ep} error`, (e as Error).message);
        }
      }
    }),
  );
  console.log(`round ${r}/${rounds}: ok=${ok} fail=${fail}`);
}
