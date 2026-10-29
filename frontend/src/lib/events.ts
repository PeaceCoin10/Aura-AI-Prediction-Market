import { en } from "../locales/en";

export { eventLabel, countdown, shortTime } from "../lib/format";

export function outcomeText(o: number): string {
  const t = en.content.outcomes;
  return o === 1 ? t.yesWins : o === 0 ? t.noWins : t.invalid;
}

export function outcomeColor(o: number): string {
  return o === 1 ? "text-brand" : o === 0 ? "text-danger" : "text-slate-400";
}

/** Market lifecycle phase (drives UI colour) */
export type MarketPhase = "trading" | "awaiting" | "disputing" | "final" | "closed" | "empty";

export function marketPhase(s: {
  exists: boolean;
  resolved: boolean;
  finalized: boolean;
  disputing: boolean;
  resolutionTime: bigint;
}, now: number): MarketPhase {
  if (!s.exists) return "empty";
  if (s.resolved) {
    if (s.finalized) return "final";
    return s.disputing ? "disputing" : "disputing";
  }
  if (Number(s.resolutionTime) <= now) return "awaiting";
  return "trading";
}

export const PHASE_TEXT: Record<MarketPhase, string> = en.content.phase;
