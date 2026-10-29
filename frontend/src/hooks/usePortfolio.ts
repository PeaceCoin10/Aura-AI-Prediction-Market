import { useCallback, useEffect, useState } from "react";
import type { Hex, MarketSnapshot } from "@sdk";
import { makeSdk, usdcBalance } from "../lib/sdk";
import { errText } from "../lib/format";

export interface Position {
  market: MarketSnapshot;
  yes: bigint;
  no: bigint;
  /** Resolved and past the dispute window → redeemable */
  redeemable: boolean;
  /** Resolved but still inside the 1h dispute window → button disabled + highlighted notice */
  disputing: boolean;
  /** Resolved, waiting for the user to redeem */
  pendingRedeem: boolean;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export function usePortfolio(markets: MarketSnapshot[], account?: string) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [balance, setBalance] = useState<bigint>(0n);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    if (!account) {
      setPositions([]);
      setBalance(0n);
      return;
    }
    setLoading(true);
    try {
      const sdk = makeSdk(account);
      const [bal, holdings] = await Promise.all([
        usdcBalance(account),
        mapLimit(markets, 5, async (m) => {
          const h = await sdk.sharesOf(m.marketId as Hex, account);
          return { m, h };
        }),
      ]);
      setBalance(bal);
      const rows: Position[] = holdings
        .filter(({ h }) => h.yes > 0n || h.no > 0n)
        .map(({ m, h }) => {
          const disputing = m.resolved && !m.finalized;
          return {
            market: m,
            yes: h.yes,
            no: h.no,
            redeemable: m.resolved && m.finalized,
            disputing,
            pendingRedeem: m.resolved && m.finalized,
          };
        });
      setPositions(rows);
      setError(undefined);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [markets, account]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { positions, balance, loading, error, refresh };
}
