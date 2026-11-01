/**
 * Market debate wall — local-storage backed
 *
 * Why local storage: there is no comment contract on chain, and adding one just to host
 * comments would mean redeploying the live engine. localStorage gives an immediately usable
 * "local community wall": it survives refreshes and browser restarts, and it is honest about
 * not syncing across devices (the UI says so). Moving to a backend later only means replacing
 * the two read/write functions in this file.
 */
import { en } from "../locales/en";

export type Stance = "YES" | "NO" | "NEUTRAL";

export interface Comment {
  id: string;
  marketId: string;
  author: string;
  stance: Stance;
  text: string;
  ts: number;
  /** Upvotes carried with the take (merged max across devices) */
  likes?: number;
  /** Pinned official prompt (cannot be deleted) */
  seeded?: boolean;
}

const KEY = "predict.comments.v2";
const LIKED_KEY = "predict.comments.liked.v1";
const MAX_PER_MARKET = 200;
const listeners = new Set<() => void>();

function canUseStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

function readAll(): Record<string, Comment[]> {
  if (!canUseStorage()) return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Comment[]>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, Comment[]>): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* quota exceeded / private mode: degrade silently, the main flow keeps working */
  }
  listeners.forEach((fn) => fn());
}

/** Ids this browser has upvoted — one vote per device, so the count stays honest. */
export function likedIds(): Set<string> {
  if (!canUseStorage()) return new Set();
  try {
    const raw = window.localStorage.getItem(LIKED_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function saveLiked(ids: Set<string>): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(LIKED_KEY, JSON.stringify([...ids]));
  } catch {
    /* quota / private mode: the vote simply does not persist */
  }
  listeners.forEach((fn) => fn());
}

/**
 * Toggle this device's upvote on a take and return the resulting count.
 * The count lives on the comment (so it travels with the cloud payload); the vote
 * itself lives in a per-browser set, which is what stops one person inflating it.
 */
export function toggleLike(marketId: string, id: string): number {
  const liked = likedIds();
  const all = readAll();
  const list = all[marketId] ?? [];
  const target = list.find((c) => c.id === id);
  if (!target) return 0;
  const base = target.likes ?? 0;
  if (liked.has(id)) {
    liked.delete(id);
    target.likes = Math.max(0, base - 1);
  } else {
    liked.add(id);
    target.likes = base + 1;
  }
  saveLiked(liked);
  writeAll(all);
  return target.likes;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

type Seed = Omit<Comment, "id" | "marketId" | "ts">;

/**
 * Seeded takes: so the debate wall on a fresh market is not empty (demo markets only).
 * This is cold-start filler, not fabricated users — the UI labels these as official topics.
 * The copy itself lives in the i18n tree under `content.seedComments`.
 */
const SEEDS: Record<string, Seed[]> = Object.fromEntries(
  Object.entries(en.content.seedComments).map(([marketId, seeds]) => [
    marketId,
    seeds.map((s) => ({ author: s.author, stance: s.stance, text: s.text, seeded: true as const })),
  ]),
);

let seededOnce = false;

/** Write the seeded takes into local storage on first visit (idempotent, never clobbers user data) */
export function ensureSeeded(marketIds: string[]): void {
  if (seededOnce || !canUseStorage()) return;
  seededOnce = true;
  const all = readAll();
  let changed = false;
  for (const id of marketIds) {
    const seeds = SEEDS[id];
    if (!seeds || (all[id] && all[id].length > 0)) continue;
    const now = Date.now();
    all[id] = seeds.map((s, i) => ({
      ...s,
      id: `seed-${id}-${i}`,
      marketId: id,
      ts: now - (seeds.length - i) * 11 * 60 * 1000,
    }));
    changed = true;
  }
  if (changed) writeAll(all);
}

export function listComments(marketId: string): Comment[] {
  const all = readAll();
  return (all[marketId] ?? []).slice().sort((a, b) => b.ts - a.ts);
}

export function addComment(
  marketId: string,
  input: { author: string; stance: Stance; text: string },
): Comment {
  const all = readAll();
  const text = input.text.trim().slice(0, 500);
  const author = (input.author || "anon predictor").trim().slice(0, 24) || "anon predictor";
  const item: Comment = {
    id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    marketId,
    author,
    stance: input.stance,
    text,
    ts: Date.now(),
    likes: 0,
  };
  const list = all[marketId] ?? [];
  all[marketId] = [item, ...list].slice(0, MAX_PER_MARKET);
  writeAll(all);
  return item;
}

export function removeComment(marketId: string, id: string): void {
  const all = readAll();
  const list = all[marketId] ?? [];
  all[marketId] = list.filter((c) => c.id !== id || c.seeded);
  writeAll(all);
}

export function stanceTally(marketId: string): { yes: number; no: number; neutral: number } {
  const out = { yes: 0, no: 0, neutral: 0 };
  for (const c of listComments(marketId)) {
    if (c.stance === "YES") out.yes += 1;
    else if (c.stance === "NO") out.no += 1;
    else out.neutral += 1;
  }
  return out;
}

/** Whole debate corpus — the wire shape the cloud layer carries. */
export function snapshotComments(): Record<string, Comment[]> {
  return readAll();
}

/**
 * Adopt remote debate takes: union by comment id, newest first, capped per market.
 * Seeded official prompts are never dropped, so a cold market keeps its opening question.
 */
export function mergeComments(remote: Record<string, Comment[]>): void {
  if (!remote || typeof remote !== "object") return;
  const local = readAll();
  let changed = false;
  for (const [marketId, incoming] of Object.entries(remote)) {
    if (!Array.isArray(incoming)) continue;
    const byId = new Map<string, Comment>();
    for (const c of local[marketId] ?? []) byId.set(c.id, c);
    for (const c of incoming) {
      if (!c || typeof c.id !== "string") continue;
      const seen = byId.get(c.id);
      if (!seen) {
        byId.set(c.id, c);
        changed = true;
      } else if (seen.seeded && !c.seeded) {
        byId.set(c.id, c);
        changed = true;
      } else if ((c.likes ?? 0) > (seen.likes ?? 0)) {
        // likes are monotone per comment id: adopt the higher count from the other device
        byId.set(c.id, { ...seen, likes: c.likes });
        changed = true;
      }
    }
    const merged = [...byId.values()].sort((a, b) => b.ts - a.ts).slice(0, MAX_PER_MARKET);
    if (merged.length !== (local[marketId] ?? []).length) changed = true;
    local[marketId] = merged;
  }
  if (changed) writeAll(local);
}
