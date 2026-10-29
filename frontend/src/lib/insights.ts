/**
 * Hermes AI desk · market commentary
 *
 * Two sources:
 *   1) Server side: the brain writes commentary for real markets into `insights.json`
 *      (produced by hermes/insights.py); the frontend polls it every 60 seconds. This is the
 *      real AI brain's output, matched to markets by marketId.
 *   2) Local fallback: for demo markets, or before the brain has produced anything, a rule
 *      engine generates commentary from **actual pool state** and the UI marks it
 *      "local inference" — never disguised as brain output.
 */
import { toProb } from "./format";
import { format } from "./i18n";
import { en } from "../locales/en";

export type InsightTone = "bull" | "bear" | "warn" | "geek" | "calm";

export interface Insight {
  text: string;
  tone: InsightTone;
  ts: number;
  source: "brain" | "local";
  /** Data behind the call (rendered in the tooltip) */
  basis?: string;
}

interface ServerFile {
  generatedAt: number;
  items: Record<string, { text: string; tone: InsightTone; ts: number; basis?: string }>;
}

let cache: ServerFile | null = null;
let fetchedAt = 0;
let inflight: Promise<ServerFile | null> | null = null;

async function fetchServer(): Promise<ServerFile | null> {
  if (Date.now() - fetchedAt < 60_000 && cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}insights.json?ts=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as ServerFile;
      cache = json;
      fetchedAt = Date.now();
      return json;
    } catch {
      fetchedAt = Date.now();
      return cache;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function brainInsight(marketId: string): Insight | null {
  const item = cache?.items?.[marketId];
  if (!item) return null;
  return { text: item.text, tone: item.tone, ts: item.ts, source: "brain", basis: item.basis };
}

export async function refreshInsights(): Promise<void> {
  await fetchServer();
}

/** Whether the brain has produced anything (footer heartbeat light + UI labelling) */
export function insightsHealth(): { online: boolean; generatedAt?: number } {
  return { online: !!cache && Object.keys(cache.items ?? {}).length > 0, generatedAt: cache?.generatedAt };
}

const C = en.content.insights;

const CATEGORY_FLAVOR: Record<string, string> = {
  crypto: C.flavor.crypto,
  news: C.flavor.news,
  tech: C.flavor.tech,
  sports: C.flavor.sports,
  esports: C.flavor.esports,
};

/**
 * Local inference: uses only real pool data (probability / depth / volume / time to settlement).
 * No external facts are invented.
 */
export function localInsight(input: {
  marketId: string;
  question: string;
  category?: string;
  priceYes: bigint;
  depth: bigint;
  volume?: bigint;
  resolutionTime?: number;
  now?: number;
}): Insight {
  const p = toProb(input.priceYes);
  const depthUsdc = Number(input.depth) / 1e6;
  const volUsdc = Number(input.volume ?? 0n) / 1e6;
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const leftH = input.resolutionTime ? Math.max(0, (input.resolutionTime - now) / 3600) : undefined;
  const flavor = CATEGORY_FLAVOR[(input.category ?? "").toLowerCase()] ?? C.flavor.fallback;

  let tone: InsightTone = "calm";
  let text: string;

  if (p >= 0.75) {
    tone = "warn";
    text = format(C.crowded, { prob: (p * 100).toFixed(1) });
  } else if (p >= 0.58) {
    tone = "bull";
    text = format(C.edge, { prob: (p * 100).toFixed(1), flavor });
  } else if (p >= 0.42) {
    tone = "geek";
    text = format(C.neutral, { prob: (p * 100).toFixed(1) });
  } else if (p >= 0.25) {
    tone = "bear";
    text = format(C.fade, { prob: (p * 100).toFixed(1) });
  } else {
    tone = "bear";
    text = format(C.priced, { prob: (p * 100).toFixed(1), flavor });
  }

  if (depthUsdc > 0 && depthUsdc < 500) {
    text += format(C.thinPool, { depth: depthUsdc.toFixed(0) });
    if ((["calm", "geek"] as InsightTone[]).includes(tone)) tone = "warn";
  } else if (volUsdc > 0 && volUsdc > depthUsdc * 2 && depthUsdc > 0) {
    text += format(C.heavyVolume, { vol: volUsdc.toFixed(0), multiple: (volUsdc / depthUsdc).toFixed(1) });
  }

  if (leftH !== undefined) {
    if (leftH <= 1) text += C.closingSoon;
    else if (leftH <= 6) text += format(C.finalHours, { hours: leftH.toFixed(1) });
  }

  return {
    text,
    tone,
    ts: Date.now(),
    source: "local",
    basis: format(C.basis, {
      prob: (p * 100).toFixed(1),
      depth: depthUsdc.toFixed(0),
      vol: volUsdc.toFixed(0),
    }),
  };
}
