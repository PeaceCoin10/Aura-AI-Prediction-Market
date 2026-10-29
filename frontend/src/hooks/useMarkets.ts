import { useCallback, useEffect, useState } from "react";
import type { Hex, MarketSnapshot } from "@sdk";
import { makeSdk } from "../lib/sdk";
import { errText } from "../lib/format";

const MAX_MARKETS = 100;

export interface MarketsState {
  markets: MarketSnapshot[];
  total: number;
  loading: boolean;
  error?: string;
  refresh: () => Promise<void>;
  lastUpdated?: number;
}

/**
 * Hall data source:
 *   marketCount() → marketId(i) (reverse order, newest first) → marketSnapshots(ids) in one Multicall3
 * Everything goes through the SDK; no hand-rolled ABI calls.
 */
export function useMarkets(pollMs = 15_000): MarketsState {
  const [markets, setMarkets] = useState<MarketSnapshot[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [lastUpdated, setLastUpdated] = useState<number | undefined>();

  const refresh = useCallback(async () => {
    try {
      const sdk = makeSdk();
      const count = await sdk.marketCount();
      setTotal(count);
      if (count === 0) {
        setMarkets([]);
        setError(undefined);
        setLastUpdated(Date.now());
        return;
      }
      const n = Math.min(count, MAX_MARKETS);
      const ids: Hex[] = await Promise.all(
        Array.from({ length: n }, (_, i) => sdk.marketId(count - 1 - i)),
      );
      const snaps = await sdk.marketSnapshots(ids, { withMeta: true });
      setMarkets(snaps.filter((s) => s.exists));
      setError(undefined);
      setLastUpdated(Date.now());
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), pollMs);
    return () => window.clearInterval(t);
  }, [refresh, pollMs]);

  return { markets, total, loading, error, refresh, lastUpdated };
}
