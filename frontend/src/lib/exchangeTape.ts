/**
 * Exchange order-flow tape.
 *
 * The hall's tape shows real public trades, not invented numbers: aggregated trades come from
 * Binance's public market-data endpoints (CORS-enabled, no key). Each print carries the real price,
 * size, notional and timestamp, and the UI always names the venue so nobody mistakes a spot print for
 * a fill on this venue's own book.
 *
 * If the endpoints are unreachable the hook returns an empty list and the tape hides itself; it never
 * substitutes fabricated prints.
 */
import { useEffect, useState } from "react";

const VENUES = ["https://api.binance.com", "https://data-api.binance.vision"];
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
const POLL_MS = 20_000;

export type PrintSide = "BUY" | "SELL";

export interface ExchangePrint {
  id: string;
  symbol: string;
  /** Base asset, e.g. BTC */
  base: string;
  side: PrintSide;
  price: number;
  qty: number;
  /** Quote-asset notional in USDT */
  notional: number;
  /** Unix ms of the trade */
  ts: number;
  venue: "Binance";
}

interface RawTrade {
  a: number;
  p: string;
  q: string;
  T: number;
  m: boolean;
}

async function fetchSymbol(venue: string, symbol: string): Promise<ExchangePrint[]> {
  const res = await fetch(`${venue}/api/v3/aggTrades?symbol=${symbol}&limit=500`, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  const rows = (await res.json()) as RawTrade[];
  const base = symbol.replace(/USDT$/, "");
  return rows.map((r) => {
    const price = Number(r.p);
    const qty = Number(r.q);
    return {
      // Binance aggTrade ids restart per symbol, so the symbol is part of the key.
      id: `${symbol}-${r.a}`,
      symbol: `${base}/USDT`,
      base,
      side: r.m ? "SELL" : "BUY",
      price,
      qty,
      notional: price * qty,
      ts: r.T,
      venue: "Binance",
    };
  });
}

export async function fetchExchangePrints(): Promise<ExchangePrint[]> {
  for (const venue of VENUES) {
    try {
      const batches = await Promise.all(SYMBOLS.map((s) => fetchSymbol(venue, s)));
      return batches.flat().sort((a, b) => b.ts - a.ts);
    } catch {
      /* try the next venue */
    }
  }
  return [];
}

export interface TapeState {
  prints: ExchangePrint[];
  /** true once at least one real batch has been received */
  live: boolean;
  updatedAt: number;
}

/** Polls real prints; `live` stays false until a batch actually arrives. */
export function useExchangeTape(pollMs = POLL_MS): TapeState {
  const [state, setState] = useState<TapeState>({ prints: [], live: false, updatedAt: 0 });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const prints = await fetchExchangePrints();
      if (!alive) return;
      setState((prev) => ({
        // Keep the previous tape when a poll fails, but never extend it with invented rows.
        prints: prints.length ? prints : prev.prints,
        live: prints.length ? true : prev.live,
        updatedAt: prints.length ? Date.now() : prev.updatedAt,
      }));
    };
    void load();
    const timer = window.setInterval(load, pollMs);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [pollMs]);

  return state;
}

/** Compact USD notional for a tape row: $1.2M, $84.5k, $912. */
export function money(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}
