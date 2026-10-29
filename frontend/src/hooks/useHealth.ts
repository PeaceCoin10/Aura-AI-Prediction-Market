import { useEffect, useState } from "react";
import { RPC_URLS } from "../lib/config";

export interface HealthState {
  rpcMs?: number;
  rpcUrl?: string;
  rpcOk: boolean;
  blockNumber?: number;
}

/**
 * RPC health probe: every 20 seconds, send eth_blockNumber to the candidate RPCs and record the
 * round-trip latency of the first one that answers. Measured entirely in the browser (real
 * browser-to-RPC timing), with no backend involved.
 */
export function useHealth(): HealthState {
  const [state, setState] = useState<HealthState>({ rpcOk: false });

  useEffect(() => {
    let alive = true;
    const probe = async () => {
      for (const url of RPC_URLS) {
        const t0 = performance.now();
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
          });
          const json = (await res.json()) as { result?: string };
          const ms = Math.round(performance.now() - t0);
          if (!alive) return;
          setState({ rpcOk: !!json.result, rpcMs: ms, rpcUrl: url, blockNumber: json.result ? parseInt(json.result, 16) : undefined });
          return;
        } catch {
          /* Try the next endpoint */
        }
      }
      if (alive) setState({ rpcOk: false });
    };
    void probe();
    const t = window.setInterval(probe, 20_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  return state;
}
