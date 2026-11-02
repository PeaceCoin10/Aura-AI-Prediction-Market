/**
 * Micro-interactions: a coin burst anchored to the element that triggered it.
 *
 * Purely visual, no layout impact, no timers left behind. The burst is dispatched on `window`
 * so any component can fire it without lifting state into the tree; `CoinBurst` is the single
 * listener and unmounts itself after the animation window.
 */
export interface BurstDetail {
  x: number;
  y: number;
  count?: number;
}

const EVENT = "aura:burst";
export const BURST_EVENT = EVENT;

/** Fire a burst centred on an element (or at the pointer when no element is given). */
export function burstFrom(target?: Element | null, count = 14): void {
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;
  const rect = target?.getBoundingClientRect();
  const detail: BurstDetail = {
    x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
    y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
    count,
  };
  window.dispatchEvent(new CustomEvent<BurstDetail>(EVENT, { detail }));
}
