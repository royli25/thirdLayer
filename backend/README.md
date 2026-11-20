# thirdLayer backend

Customer intelligence for x402 sellers on Solana. Sellers add a few lines in front
of their x402 paywall; every paying AI agent becomes a rich customer profile.

```ts
app.use("/api/paid/*", thirdLayer.track({ prices, ingest }));   // ← thirdLayer SDK
app.use("/api/paid/*", paymentMiddleware(routes, resourceServer)); // ← x402 (Solana devnet USDC)
```

On-chain-only analytics can see *that* a wallet paid. Only the seller knows *what it bought*.
The SDK captures `{payer wallet, tx signature, endpoint, amount, requestId}` at settlement,
then the profiler adds the wallet's on-chain life (history, DeFi protocols, holdings, other x402
sellers it pays) and writes a customer profile.

## Pipeline

```
AI agent ──GET──▶ /api/paid/* ──402──▶ agent signs USDC transfer ──retry──▶ PayAI facilitator settles on Solana devnet
                     │
                     └─ thirdLayer.track()  → payment_required / payment_settled / payment_failed
                                              → wallet_flagged (new customer)
                                              → enrichment: history → x402_sellers → protocols → score → narrative (Claude)
QuickNode Streams (Solana devnet blocks) ──▶ /webhooks/quicknode → onchain_confirmed (independent on-chain verification)
PayAI facilitator fee-payer feed (Solana mainnet) ──▶ import:mainnet → real x402 payers, same profile shape
```

## Run

```sh
bun install
bun run setup          # generates seller, treasury, 6 agent wallets; writes .env
# fund the TREASURY address it prints:
#   devnet SOL : https://faucet.solana.com
#   devnet USDC: https://faucet.circle.com  (Solana Devnet)
bun run fund           # creates seller USDC account, sends USDC to each agent
bun run dev            # :4000
bun run seed 5         # agents build payment history (server must be running)
bun run import:mainnet 150 8   # real Solana-mainnet x402 payers (use a QuickNode mainnet RPC)
```

Agents only need USDC: the facilitator sponsors SOL fees.

## API (frontend contract)

| Route | |
|---|---|
| `GET /wallets` | `{ wallets: WalletSummary[] }` |
| `GET /wallets/:address` | full profile: payments, chains, protocols, tokens, otherX402Sellers, narrative |
| `GET /events` | SSE: `payment_required`, `payment_settled`, `payment_failed`, `wallet_flagged`, `enrichment_step`, `enrichment_done`, `onchain_confirmed` |
| `POST /demo/trigger` | `{persona?, endpoint?}` → one live agent payment |
| `GET /demo/agents` | agent names / personas / addresses |
| `POST /webhooks/quicknode` | QuickNode Streams destination (header `x-qn-token`) |
| `GET /api/paid/{price,sentiment,whales}` | the x402-paywalled seller API ($0.01 each) |

## QuickNode Streams setup

1. QuickNode → Streams → New stream → **Solana Devnet**, dataset **Block**, start at latest.
2. Filter: paste `quicknode/stream-filter.js` (set `PAY_TO` to your seller address).
3. Destination: Webhook → `https://<tunnel>/webhooks/quicknode`, custom header `x-qn-token: <QUICKNODE_STREAM_TOKEN>`.
   Tunnel: `brew install cloudflared && cloudflared tunnel --url http://localhost:4000`.
4. Put your QuickNode devnet/mainnet HTTPS endpoints in `.env` as the RPC URLs too.
