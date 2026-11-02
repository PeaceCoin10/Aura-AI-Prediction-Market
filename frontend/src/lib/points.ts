/**
 * Aura Points · Season 1 ledger.
 *
 * Points are a record of actions this browser can prove it took: a daily check-in and a debate
 * take you actually published. Trading points are NOT stored here — they are derived from the
 * engine's own `SharesBought` / `SharesSold` events, so a paper fill (no chain transaction) earns
 * nothing and the number cannot be inflated by editing localStorage beyond the two signed-in
 * actions below.
 *
 * This is not a token and not a claim on one. See `disclaimer` in the UI copy.
 */
const KEY = "aura.points.v1";

export type PointKind = "checkin" | "take";

export interface PointEvent {
  kind: PointKind;
  at: number;
  points: number;
  /** take id, so the same take cannot be counted twice across tabs */
  id?: string;
}

export const SEASON = {
  id: "season-1",
  title: "Genesis Predictor Season 1",
  /** UTC window */
  startsAt: Date.UTC(2026, 10, 1),
  endsAt: Date.UTC(2027, 0, 1),
} as const;

/** Every number here is shown to the user in the rules card — keep the two in sync. */
export const RULES = {
  pointsPer10Usdc: 1,
  checkIn: 25,
  take: 40,
  invite: 150,
} as const;

function load(): PointEvent[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is PointEvent =>
        !!e && typeof e === "object" && (e as PointEvent).kind !== undefined &&
        ((e as PointEvent).kind === "checkin" || (e as PointEvent).kind === "take") &&
        Number.isFinite((e as PointEvent).at) && Number.isFinite((e as PointEvent).points),
    );
  } catch {
    return [];
  }
}

function save(events: PointEvent[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(events.slice(-500)));
  } catch {
    /* private mode: the ledger simply does not persist */
  }
}

const dayKey = (ts: number) => new Date(ts).toISOString().slice(0, 10);

export interface LocalPoints {
  total: number;
  checkins: number;
  takes: number;
  /** consecutive UTC days with a check-in, counting back from today */
  streak: number;
  lastCheckIn: number;
  canCheckIn: boolean;
}

export function localPoints(now = Date.now()): LocalPoints {
  const events = load();
  const checkins = events.filter((e) => e.kind === "checkin");
  const takes = events.filter((e) => e.kind === "take");
  const days = new Set(checkins.map((e) => dayKey(e.at)));
  let streak = 0;
  for (let i = 0; i < 400; i++) {
    const d = new Date(now - i * 86_400_000);
    if (days.has(d.toISOString().slice(0, 10))) streak++;
    else if (i > 0) break;
  }
  const lastCheckIn = checkins.reduce((m, e) => Math.max(m, e.at), 0);
  return {
    total: events.reduce((s, e) => s + e.points, 0),
    checkins: checkins.length,
    takes: takes.length,
    streak,
    lastCheckIn,
    canCheckIn: dayKey(lastCheckIn) !== dayKey(now),
  };
}

/** Awards today's check-in, or returns 0 when today is already claimed. */
export function checkIn(now = Date.now()): number {
  const state = localPoints(now);
  if (!state.canCheckIn) return 0;
  const events = load();
  events.push({ kind: "checkin", at: now, points: RULES.checkIn });
  save(events);
  window.dispatchEvent(new CustomEvent("aura:points"));
  return RULES.checkIn;
}

/** Awards a take once per id. Returns the points given (0 if already counted). */
export function recordTake(id: string, now = Date.now()): number {
  const events = load();
  if (events.some((e) => e.kind === "take" && e.id === id)) return 0;
  events.push({ kind: "take", at: now, points: RULES.take, id });
  save(events);
  window.dispatchEvent(new CustomEvent("aura:points"));
  return RULES.take;
}

/** Trading points from real engine volume. Paper fills never reach this function. */
export function tradePoints(volumeUsdc: number): number {
  if (!Number.isFinite(volumeUsdc) || volumeUsdc <= 0) return 0;
  return Math.floor(volumeUsdc / 10) * RULES.pointsPer10Usdc;
}

export interface Trader {
  address: string;
  volumeUsdc: number;
  fills: number;
  points: number;
}

/** Aggregates the public event feed into a real standings table (no simulated rows). */
export function standings(feed: Array<{ event: { name: string; args: Record<string, unknown> } }>): Trader[] {
  const by = new Map<string, { volumeUsdc: number; fills: number }>();
  const num = (v: unknown) => (typeof v === "bigint" ? Number(v) / 1e6 : typeof v === "number" ? v / 1e6 : 0);
  for (const item of feed) {
    const { name, args } = item.event;
    const who = (name === "SharesBought" ? args.buyer : name === "SharesSold" ? args.seller : null) as string | null;
    if (typeof who !== "string") continue;
    const usdc = Number(num(name === "SharesBought" ? args.amountIn : args.amountOut).toFixed(6));
    if (!(usdc > 0)) continue;
    const row = by.get(who.toLowerCase()) ?? { volumeUsdc: 0, fills: 0 };
    row.volumeUsdc += usdc;
    row.fills += 1;
    by.set(who.toLowerCase(), row);
  }
  return [...by.entries()]
    .map(([address, row]) => ({ address, ...row, points: tradePoints(row.volumeUsdc) }))
    .sort((a, b) => b.points - a.points || b.volumeUsdc - a.volumeUsdc);
}
