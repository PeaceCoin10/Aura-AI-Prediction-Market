/**
 * Simulated live feed for demo markets, so the landing page moves instead of looking like a
 * static screenshot.
 *
 * Honest boundary: this is a **local price simulation** (random walk plus mean reversion), not
 * on-chain fills. The UI labels it "simulated feed · updates every 7s" and never passes it off
 * as a real on-chain price.
 *
 * Pool depth stays constant and only the implied probability drifts, so share and slippage math
 * remains self-consistent.
 */
import { useEffect, useState } from "react";
import type { DemoMarket } from "./demo";

const TICK_MS = 7_000;
const MAX_DRIFT = 0.09; // Drift is capped at ±9% of the baseline probability
const MEAN_REVERT = 0.9; // Pulls back 10% toward baseline each tick

const walk: Record<string, number> = {};
const listeners = new Set<() => void>();
let timer: number | null = null;

function baseProb(m: DemoMarket): number {
  const d = m.yesReserve + m.noReserve;
  if (d === 0n) return 0.5;
  return Number(m.noReserve) / Number(d);
}

function clampProb(p: number): number {
  return Math.min(0.95, Math.max(0.05, p));
}

/** Current probability and reserves including drift; total depth is constant */
export function livePool(m: DemoMarket): { yesReserve: bigint; noReserve: bigint; prob: number } {
  const depth = m.yesReserve + m.noReserve;
  const n = walk[m.id] ?? 0;
  const p = clampProb(baseProb(m) * (1 + n));
  const no = BigInt(Math.round(Number(depth) * p));
  return { yesReserve: depth - no, noReserve: no, prob: p };
}

export function liveProb(m: DemoMarket): number {
  return livePool(m).prob;
}

function tick(): void {
  for (const id of Object.keys(walk)) {
    walk[id] = walk[id] * MEAN_REVERT + (Math.random() - 0.5) * 0.014;
    walk[id] = Math.max(-MAX_DRIFT, Math.min(MAX_DRIFT, walk[id]));
  }
  listeners.forEach((fn) => fn());
}

export function startLiveFeed(markets: DemoMarket[]): () => void {
  for (const m of markets) if (!(m.id in walk)) walk[m.id] = 0;
  if (timer === null) timer = window.setInterval(tick, TICK_MS);
  return () => {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

/** Subscribe to one market's live pool */
export function useLivePool(m: DemoMarket): { yesReserve: bigint; noReserve: bigint; prob: number } {
  const [pool, setPool] = useState(() => livePool(m));
  useEffect(() => {
    const update = () => setPool(livePool(m));
    update();
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, [m]);
  return pool;
}
