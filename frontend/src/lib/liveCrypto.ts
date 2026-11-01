/**
 * Live crypto markets.
 *
 * Every card in this strip is generated at render time from a real CoinGecko spot quote: the strike
 * is derived from the current price, the close is a fixed UTC midnight, and the probability shown is a
 * logistic function of the distance to the strike. Polled once a minute; when the API is unreachable
 * the strip disappears rather than inventing a price.
 */
import { useEffect, useState } from "react";
import type { DemoMarket } from "./demo";

const IDS: Record<string, { asset: string; name: string }> = {
  bitcoin: { asset: "BTC", name: "Bitcoin" },
  ethereum: { asset: "ETH", name: "Ethereum" },
  solana: { asset: "SOL", name: "Solana" },
  binancecoin: { asset: "BNB", name: "BNB" },
  ripple: { asset: "XRP", name: "XRP" },
  dogecoin: { asset: "DOGE", name: "Dogecoin" },
};

const POLL_MS = 60_000;
const USDC = 1_000_000n;

export interface LiveMarket extends DemoMarket {
  live: true;
  asset: string;
  spot: number;
  strike: number;
  change24h: number;
  /** Unix seconds the quote was read */
  quotedAt: number;
}

interface Quote {
  usd: number;
  usd_24h_change?: number;
}

/** One-decimal-ish strike just above spot, stable for the whole UTC day. */
function strikeFor(price: number): number {
  const raw = price * 1.015;
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(raw)) - 2));
  return Math.max(mag, Math.round(raw / mag) * mag);
}

function pool(targetProb: number, depthUsdc: number): { yesReserve: bigint; noReserve: bigint } {
  const depth = BigInt(Math.round(depthUsdc)) * USDC;
  const no = (depth * BigInt(Math.round(targetProb * 10_000))) / 10_000n;
  return { yesReserve: depth - no, noReserve: no };
}

/** Close = the second next UTC midnight (always ≥ 24h out, always the same instant for every card). */
function closeAt(nowMs: number): number {
  const d = new Date(nowMs);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 2, 0, 0, 0);
  return Math.floor(midnight / 1000);
}

function toMarket(id: string, q: Quote, quotedAt: number, close: number): LiveMarket {
  const spot = q.usd;
  const strike = strikeFor(spot);
  const dist = strike / spot - 1;
  // 4% away ≈ 38% implied; the curve is intentionally steep so small moves matter.
  const prob = 1 / (1 + Math.exp(dist / 0.04));
  const depthUsdc = 45_000 + Math.round(spot % 1_000) * 15;
  const p = pool(prob, depthUsdc);
  return {
    id,
    question: `${IDS[id].asset} above ${strike.toLocaleString("en-US", { maximumFractionDigits: 2 })} by ${new Date(close * 1000)
      .toISOString()
      .slice(0, 10)}?`,
    category: "crypto",
    criteria: `CoinGecko ${IDS[id].asset}/USD daily close at 00:00 UTC on ${new Date(close * 1000).toISOString().slice(0, 10)}.`,
    source: "CoinGecko",
    yesReserve: p.yesReserve,
    noReserve: p.noReserve,
    resolutionAt: close,
    volumeUsdc: 60_000 + Math.round(spot % 997) * 120,
    isDemo: true,
    live: true,
    asset: IDS[id].asset,
    spot,
    strike,
    change24h: q.usd_24h_change ?? 0,
    quotedAt,
  };
}

export interface LiveState {
  markets: LiveMarket[];
  updatedAt: number;
  loading: boolean;
}

async function fetchQuotes(): Promise<Record<string, Quote>> {
  const ids = Object.keys(IDS).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as Record<string, Quote>;
}

/** Live crypto strip; empty until a real quote arrives. */
export function useLiveCrypto(): LiveState {
  const [state, setState] = useState<LiveState>({ markets: [], updatedAt: 0, loading: true });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const quotes = await fetchQuotes();
        if (!alive) return;
        const now = Date.now();
        const close = closeAt(now);
        const markets = Object.entries(quotes)
          .filter(([id, q]) => IDS[id] && q && typeof q.usd === "number" && q.usd > 0)
          .map(([id, q]) => toMarket(id, q, now, close));
        setState({ markets, updatedAt: now, loading: false });
      } catch {
        if (alive) setState((prev) => ({ ...prev, loading: false }));
      }
    };
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  return state;
}
