import { useEffect, useMemo, useState } from "react";
import { brainInsight, insightsHealth, localInsight, refreshInsights, type Insight } from "../lib/insights";
import { format, useT } from "../lib/i18n";

const TONE_STYLE: Record<string, { border: string; text: string; badge: string }> = {
  bull: { border: "border-brand/35", text: "text-brand", badge: "bg-brand/15 text-brand" },
  bear: { border: "border-danger/35", text: "text-danger", badge: "bg-danger/15 text-danger" },
  warn: { border: "border-amber-400/40", text: "text-amber-300", badge: "bg-amber-400/15 text-amber-300" },
  geek: { border: "border-cyan-400/35", text: "text-cyan-300", badge: "bg-cyan-400/15 text-cyan-300" },
  calm: { border: "border-white/12", text: "text-slate-300", badge: "bg-white/10 text-slate-300" },
};

/**
 * Hermes AI desk commentary: brain output wins (insights.json), otherwise a local
 * rule-engine take — and the UI always says which one you are reading.
 */
export function AIInsights({
  marketId,
  question,
  category,
  priceYes,
  depth,
  volume,
  resolutionTime,
  compact = false,
}: {
  marketId: string;
  question: string;
  category?: string;
  priceYes: bigint;
  depth: bigint;
  volume?: bigint;
  resolutionTime?: number;
  compact?: boolean;
}) {
  const t = useT();
  const [tick, setTick] = useState(0);
  const [health, setHealth] = useState(() => insightsHealth());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      await refreshInsights();
      if (alive) {
        setHealth(insightsHealth());
        setTick((v) => v + 1);
      }
    };
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const insight: Insight = useMemo(() => {
    const fromBrain = brainInsight(marketId);
    if (fromBrain) return fromBrain;
    return localInsight({ marketId, question, category, priceYes, depth, volume, resolutionTime });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketId, question, category, priceYes, depth, volume, resolutionTime, tick]);

  const style = TONE_STYLE[insight.tone] ?? TONE_STYLE.calm;

  return (
    <section className={`rounded-xl border ${style.border} bg-white/[0.02] ${compact ? "p-3" : "p-4"}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
          <span className="relative flex h-4 w-4 items-center justify-center">
            <span className="absolute inset-0 animate-pulse-slow rounded-full bg-brand/25" />
            <span className="relative text-[10px]">◈</span>
          </span>
          {t.social.ai.desk}
        </span>
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${style.badge}`}>{t.social.ai.tone[insight.tone]}</span>
        <span className="chip text-[10px]">
          {insight.source === "brain" ? t.social.ai.live : t.social.ai.local}
        </span>
        {health.online && insight.source === "brain" && (
          <span className="mono text-[10px] text-slate-600">
            {format(t.social.ai.updated, {
              time: new Date(insight.ts).toLocaleTimeString("en-US", { hour12: false }),
            })}
          </span>
        )}
        <span className="ml-auto text-[10px] text-slate-600">
          {insight.basis ?? t.social.ai.basisFallback}
        </span>
      </div>
      <p className={`text-[13px] leading-relaxed ${style.text}`}>“{insight.text}”</p>
      <p className="mt-1.5 text-[10px] text-slate-600">
        {insight.source === "brain" ? t.social.ai.disclaimerBrain : t.social.ai.disclaimerLocal}
      </p>
    </section>
  );
}
