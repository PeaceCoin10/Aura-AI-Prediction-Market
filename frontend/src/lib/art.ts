/**
 * Market artwork resolver.
 *
 * Every featured market owns a generated SVG at `public/art/<id>.svg` (see
 * `scripts/gen_market_art.py`). Serving local vector art keeps the hall populated offline, keeps the
 * bundle small, and gives each vertical a recognisable visual language.
 */
const BASE = import.meta.env.BASE_URL || "/";

export function artUrl(id: string): string {
  return `${BASE}art/${id}.svg`;
}

export function bannerUrl(vertical: string): string {
  return `${BASE}art/banner-${vertical}.svg`;
}

/** Accent colour per vertical — used for glow rings and chips so art and chrome agree. */
export const VERTICAL_ACCENT: Record<string, string> = {
  crypto: "245,158,11",
  news: "56,189,248",
  sports: "52,211,153",
  esports: "232,121,249",
  tech: "167,139,250",
};
