// QuickNode Streams filter — Solana Devnet, dataset: "Block".
// Paste into the Stream's "Filter" step. Set PAY_TO to your seller address.
// Destination: Webhook -> https://<your-tunnel>/webhooks/quicknode
//              with custom header  x-qn-token: <QUICKNODE_STREAM_TOKEN>
//
// Emits only transactions where the seller's USDC balance increased, i.e. every
// x402 payment settled to us — an independent, on-chain confirmation stream.

const PAY_TO = "EAoAQPdxP2JQpzTDR82myxt2Et2eqfcwNdhM3q1s3HhL";
const USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"; // devnet USDC

function main(stream) {
  const blocks = Array.isArray(stream.data) ? stream.data : [stream.data];
  const matches = [];
  for (const block of blocks) {
    if (!block || !block.transactions) continue;
    for (const tx of block.transactions) {
      const meta = tx.meta;
      if (!meta || meta.err) continue;
      const pre = {};
      for (const b of meta.preTokenBalances || []) pre[b.accountIndex] = b;
      let received = 0;
      let payer = null;
      for (const b of meta.postTokenBalances || []) {
        if (b.mint !== USDC) continue;
        const before = pre[b.accountIndex] ? Number(pre[b.accountIndex].uiTokenAmount.uiAmount || 0) : 0;
        const d = Number(b.uiTokenAmount.uiAmount || 0) - before;
        if (b.owner === PAY_TO && d > 0) received = d;
        if (b.owner !== PAY_TO && d < 0) payer = b.owner;
      }
      if (received > 0) {
        matches.push({
          signature: tx.transaction.signatures[0],
          slot: block.slot || block.parentSlot + 1,
          blockTime: block.blockTime,
          payer: payer,
          amount: received,
        });
      }
    }
  }
  return matches.length ? { matches } : null;
}
