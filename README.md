# thirdLayer

Customer intelligence for x402 sellers on Solana. AI agents (including Claude through an MCP tool) pay for data with x402 in USDC. The thirdLayer SDK, which is three lines added to the seller's API, records what each payment bought, and thirdLayer turns the paying wallets into customer profiles and segments.

- `backend/`: Hono on Bun. x402 paid API, thirdLayer SDK middleware, wallet enrichment, segments, MCP server, QuickNode Streams webhook. See `backend/README.md`.
- `frontend/`: Next.js. Seller screen (SDK on/off before/after) and Business screen (segments and profiles).

## Build timeline

Built during the UBC 2026 Hackathon. The project began with the scaffold commit (2026-11-20 04:04 CST). The rest was pushed at the end of the build and split into logical commits.

Every payment in the demo is a real Solana devnet transaction, timestamped on-chain. You can check them on the seller wallet:
[EAoAQPdxP2JQpzTDR82myxt2Et2eqfcwNdhM3q1s3HhL](https://explorer.solana.com/address/EAoAQPdxP2JQpzTDR82myxt2Et2eqfcwNdhM3q1s3HhL?cluster=devnet)
