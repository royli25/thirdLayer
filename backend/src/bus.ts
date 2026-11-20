// In-process event bus feeding the SSE stream at GET /events.

export type BusEvent =
  | { type: "payment_required"; data: { endpoint: string; requestId: string; ts: string } }
  | {
      type: "payment_settled";
      data: {
        payer: string;
        txHash: string;
        endpoint: string;
        amountUsd: number;
        requestId: string;
        ts: string;
        network: string;
      };
    }
  | {
      type: "agent_response";
      data: { requestId: string; endpoint: string; status: number; body: unknown; txHash: string | null; payer: string; amountUsd: number; ts: string };
    }
  | { type: "sdk_toggled"; data: { enabled: boolean; ts: string } }
  | { type: "payment_failed"; data: { requestId: string; reason: string; ts: string } }
  | { type: "wallet_flagged"; data: { address: string; ts: string } }
  | {
      type: "enrichment_step";
      data: {
        address: string;
        step: "history" | "x402_sellers" | "protocols" | "score" | "narrative";
        status: "running" | "done";
        ts: string;
      };
    }
  | { type: "enrichment_done"; data: { address: string; ts: string } }
  | {
      type: "analysis_step";
      data: { address: string; step: string; status: "running" | "done"; source: "sdk" | "chain" | "model" | null; lines: string[]; ts: string };
    }
  | { type: "analysis_done"; data: { address: string; category: string; label: string; score: number; ts: string } }
  | {
      type: "onchain_confirmed";
      data: { txHash: string; payer: string | null; amountUsd: number | null; source: "quicknode-stream"; ts: string };
    };

type Listener = (e: BusEvent) => void;
const listeners = new Set<Listener>();

export const bus = {
  emit(e: BusEvent) {
    for (const l of listeners) {
      try {
        l(e);
      } catch {}
    }
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export const now = () => new Date().toISOString();
