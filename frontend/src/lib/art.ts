/**
 * Market artwork resolver.
 *
 * Cards use real photography per vertical (Wikimedia Commons, 1200×675, credited in
 * `public/art/photos/CREDITS.md`) and fall back to the deterministic per-market SVG when a photo is
 * missing or fails to load. The mapping is a hash of the market id, so a market always keeps the same
 * picture across reloads while neighbouring cards differ.
 */
const BASE = import.meta.env.BASE_URL || "/";

export function artUrl(id: string): string {
  return `${BASE}art/${id}.svg`;
}

export function bannerUrl(vertical: string): string {
  return `${BASE}art/banner-${vertical}.svg`;
}

/** How many curated photos exist per vertical (see scripts/fetch_photos.py). */
export const PHOTO_COUNT: Record<string, number> = {
  crypto: 8,
  news: 8,
  sports: 8,
  esports: 8,
  tech: 8,
};

function fnv1a(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = (h ^ text.charCodeAt(i)) * 16777619;
  return Math.abs(h);
}

/** Deterministic photo for a market, or null when the vertical has no curated set. */
export function photoUrl(id: string, category: string): string | null {
  const n = PHOTO_COUNT[category];
  if (!n) return null;
  const idx = (fnv1a(`${category}:${id}`) % n) + 1;
  return `${BASE}art/photos/${category}-${idx}.jpg`;
}

/** Accent colour per vertical — used for glow rings and chips so art and chrome agree. */
export const VERTICAL_ACCENT: Record<string, string> = {
  crypto: "245,158,11",
  news: "56,189,248",
  sports: "52,211,153",
  esports: "232,121,249",
  tech: "167,139,250",
};
