/**
 * Localised market copy.
 *
 * The catalogue's questions and resolution criteria are editorial data, not UI chrome, so they live
 * in `src/locales/markets.<code>.json` (one row per market id) instead of the message tree. English
 * is the source of truth and the fallback; a locale that has not translated a row simply gets the
 * English row rather than an empty card.
 *
 * The tables are loaded eagerly at build time (a few hundred short strings per locale, ~30 KB gzipped
 * in total) so switching locale never causes a network round-trip or a flash of English.
 */
import type { DemoMarket } from "./demo";
import { useI18n } from "./i18n";

export interface MarketRow {
  id: string;
  question: string;
  criteria: string;
}

const modules = import.meta.glob<{ default: MarketRow[] }>("../locales/markets.*.json", { eager: true });

const TABLES: Record<string, Map<string, MarketRow>> = {};
for (const [path, mod] of Object.entries(modules)) {
  const code = path.match(/markets\.([a-z]{2})\.json$/)?.[1];
  if (!code) continue;
  const rows = (mod as { default: MarketRow[] }).default ?? [];
  TABLES[code] = new Map(rows.map((r) => [r.id, r]));
}

/** Locales that have a market table (used by the acceptance check). */
export function translatedLocales(): string[] {
  return Object.keys(TABLES).sort();
}

export function localQuestion(market: Pick<DemoMarket, "id" | "question">, locale: string): string {
  return TABLES[locale]?.get(market.id)?.question ?? market.question;
}

export function localCriteria(market: Pick<DemoMarket, "id" | "criteria">, locale: string): string {
  return TABLES[locale]?.get(market.id)?.criteria ?? market.criteria;
}

/** Locale-aware copy for catalogue markets, bound to the active locale. */
export function useMarketText() {
  const { locale } = useI18n();
  return {
    locale,
    q: (m: Pick<DemoMarket, "id" | "question">) => localQuestion(m, locale),
    c: (m: Pick<DemoMarket, "id" | "criteria">) => localCriteria(m, locale),
    /** BCP-47 tag for Intl formatting (zh -> zh-CN, ja -> ja-JP, …). */
    intl: INTL[locale] ?? "en-US",
  };
}

const INTL: Record<string, string> = { en: "en-US", zh: "zh-CN", ja: "ja-JP", ko: "ko-KR", de: "de-DE" };
