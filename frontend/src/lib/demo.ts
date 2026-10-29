/**
 * Featured demo markets
 *
 * Purpose: the hall never renders empty while the contracts are freshly deployed and the
 * Hermes brain has not written any market yet.
 *
 * Key decisions:
 *   - Prices and quotes **reuse the SDK's real CPMM math** (priceYesOffline / previewBuyOffline /
 *     previewSellOffline) instead of a parallel toy implementation, so the quote a visitor sees
 *     on a demo market is structurally identical to the live engine's.
 *   - Every market carries a category (crypto / news / sports / esports / tech), an explicit
 *     settlement time and objective criteria, matching the field semantics of an on-chain market;
 *     the UI only has to add a "demo" badge.
 *   - All entries set isDemo: true and never send transactions or spend real money — they exist
 *     to let people feel the flow and argue about the outcome.
 */
import type { Outcome } from "@sdk";
import { previewBuyOffline, previewSellOffline, priceYesOffline } from "@sdk";
import { en } from "../locales/en";

export type Vertical = "crypto" | "news" | "sports" | "esports" | "tech";

export interface DemoMarket {
  id: string;
  question: string;
  category: Vertical;
  /** Objective resolution criteria (same meaning as an on-chain `criteria`) */
  criteria: string;
  source: string;
  /** Pool reserves (6-decimal USDC); quotes run through the real CPMM formula */
  yesReserve: bigint;
  noReserve: bigint;
  /** Settlement time (unix seconds) */
  resolutionAt: number;
  /** Cumulative traded volume (display only) */
  volumeUsdc: number;
  isDemo: true;
}

const USDC = 1_000_000n;
const HOUR = 3600;
/** Fixed "now" anchor: computed once at module load so render time cannot drift */
const BOOT = Math.floor(Date.now() / 1000);

/** Invert "target YES probability + total pool depth" into both reserves (matching engine CPMM) */
function pool(targetProb: number, depthUsdc: number): { yesReserve: bigint; noReserve: bigint } {
  const depth = BigInt(Math.round(depthUsdc * Number(USDC)));
  const no = BigInt(Math.round(Number(depth) * targetProb));
  return { yesReserve: depth - no, noReserve: no };
}

function demo(
  id: string,
  category: Vertical,
  question: string,
  criteria: string,
  source: string,
  targetProb: number,
  depthUsdc: number,
  hoursToSettle: number,
  volumeUsdc: number,
): DemoMarket {
  const p = pool(targetProb, depthUsdc);
  return {
    id,
    question,
    category,
    criteria,
    source,
    yesReserve: p.yesReserve,
    noReserve: p.noReserve,
    resolutionAt: BOOT + Math.round(hoursToSettle * HOUR),
    volumeUsdc,
    isDemo: true,
  };
}

/** Demo copy lives in the i18n tree so translators get the questions and criteria too. */
const M = en.content.demoMarkets;

/** The catalogue lives in `src/data/markets.ts` (130 sample markets). */
export { DEMO_MARKETS } from "../data/markets";


/** YES probability of a demo market (1e18 fixed point) */
export function demoPriceYes(m: DemoMarket): bigint {
  return priceYesOffline({ yesReserve: m.yesReserve, noReserve: m.noReserve });
}

/** Demo buy quote: identical to on-chain previewBuy (1.5% trade fee deducted) */
export function demoBuyQuote(m: DemoMarket, outcome: Outcome, amountIn: bigint): bigint {
  return previewBuyOffline({ yesReserve: m.yesReserve, noReserve: m.noReserve }, outcome, amountIn);
}

/** Demo sell quote */
export function demoSellQuote(m: DemoMarket, outcome: Outcome, sharesIn: bigint): bigint {
  return previewSellOffline({ yesReserve: m.yesReserve, noReserve: m.noReserve }, outcome, sharesIn);
}

/** Post-trade impact (bps): deviation between the realized average price and spot, via the real formula */
export function demoImpactBps(m: DemoMarket, outcome: Outcome, amountIn: bigint): number {
  const shares = demoBuyQuote(m, outcome, amountIn);
  if (shares === 0n) return 0;
  const px = demoPriceYes(m);
  const cur = outcome === 0 ? px : 10n ** 18n - px;
  if (cur === 0n) return 0;
  const avg = (amountIn * 10n ** 18n) / shares;
  const diff = avg > cur ? avg - cur : cur - avg;
  return Number((diff * 10_000n) / cur);
}
