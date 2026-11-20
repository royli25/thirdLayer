// Adds a dedicated wallet for Claude (used by mcp/thirdlayer-mcp.ts). Idempotent.
import { generateAgents, loadAgents, saveAgents } from "../src/agents/agents";
const agents = loadAgents().filter((a) => a.persona !== "hero-agent");
if (!agents.some((a) => a.name === "claude-assistant")) {
  const [a] = await generateAgents(1);
  agents.push({ ...a!, name: "claude-assistant", persona: "claude-assistant" });
  saveAgents(agents);
}
console.log("claude-assistant:", agents.find((a) => a.name === "claude-assistant")!.address);
