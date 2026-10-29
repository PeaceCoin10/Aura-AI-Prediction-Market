import { useEffect, useMemo, useRef, useState } from "react";
import { usdc } from "../lib/format";
import type { DemoMarket } from "../lib/demo";
import { NAV_LABEL, groupOf } from "../lib/nav";
import { listComments, subscribe, type Comment } from "../lib/comments";
import { CommentsWall } from "./CommentsWall";
import { Countdown, ProbabilityBar } from "./ui";
import { ShareButton } from "./ShareButton";
import { AIInsights } from "./AIInsights";
import { PaperPanel } from "./PaperPanel";
import { useMode } from "../lib/mode";
import { paperValue } from "../lib/paper";
import { useLivePool } from "../lib/demoLive";
import { brainInsight, localInsight, refreshInsights, type Insight, type InsightTone } from "../lib/insights";
import { format, useT } from "../lib/i18n";
import { MarketArt } from "./MarketArt";
import { TelegramShare } from "./TelegramShare";

const CAT_STYLE: Record<string, string> = {
  crypto: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  news: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  sports: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  esports: "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-300",
  tech: "border-violet-400/30 bg-violet-400/10 text-violet-300",
};

const TONE_TEXT: Record<InsightTone, string> = {
  bull: "text-brand",
  bear: "text-danger",
  warn: "text-amber-300",
  geek: "text-cyan-300",
  calm: "text-slate-300",
};

/** Hall-card debate summary: count + latest line (subscribes to localStorage writes so a new comment shows instantly). */
function useTalk(marketId: string): { count: number; latest: Comment | null } {
  const [state, setState] = useState<{ count: number; latest: Comment | null }>({ count: 0, latest: null });
  useEffect(() => {
    const read = () => {
      const list = listComments(marketId);
      setState({ count: list.length, latest: list[0] ?? null });
    };
    read();
    return subscribe(read);
  }, [marketId]);
  return state;
}

/** One-line AI take on the hall card (brain output first, local inference as fallback). */
function useCardInsight(market: DemoMarket, priceYes: bigint, depth: bigint): Insight {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void refreshInsights().then(() => alive && setTick((t) => t + 1));
    const timer = window.setInterval(() => {
      void refreshInsights().then(() => alive && setTick((t) => t + 1));
    }, 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  return useMemo(() => {
    return (
      brainInsight(market.id) ??
      localInsight({
        marketId: market.id,
        question: market.question,
        category: market.category,
        priceYes,
        depth,
        volume: BigInt(Math.round(market.volumeUsdc)) * 1_000_000n,
        resolutionTime: market.resolutionAt,
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, priceYes, depth, tick]);
}

export function DemoMarketCard({ market, onOpen }: { market: DemoMarket; onOpen: () => void }) {
  const live = useLivePool(market);
  const prob = live.prob;
  /** 1e18 fixed-point probability, the unit expected by localInsight / AIInsights */
  const priceYes = BigInt(Math.round(prob * 1e18));
  const depth = market.yesReserve + market.noReserve;
  const g = groupOf(market.category);
  const talk = useTalk(market.id);
  const insight = useCardInsight(market, priceYes, depth);
  const { paper } = useMode();
  const t = useT();
  const pos = paper.positions[market.id];
  const pv = useMemo(
    () =>
      pos
        ? paperValue(
            {
              id: market.id,
              question: market.question,
              category: market.category,
              yesReserve: live.yesReserve,
              noReserve: live.noReserve,
              resolutionTime: market.resolutionAt,
              isDemo: true,
            },
            pos,
          )
        : undefined,
    [market, pos, live.yesReserve, live.noReserve],
  );

  // Probability ticks every 7s: a directional flash so the hall reads as live.
  const prev = useRef(prob);
  const [flash, setFlash] = useState<"" | "tick-up" | "tick-down">("");
  useEffect(() => {
    if (prob === prev.current) return;
    setFlash(prob > prev.current ? "tick-up" : "tick-down");
    prev.current = prob;
    const timer = window.setTimeout(() => setFlash(""), 1100);
    return () => window.clearTimeout(timer);
  }, [prob]);

  return (
    <div className="flow-border demo-glow card card-hover group relative flex flex-col gap-3 p-4">
      <button onClick={onOpen} className="flex flex-1 flex-col gap-3 text-left">
        <MarketArt
          id={market.id}
          question={market.question}
          category={market.category}
          ratio="aspect-[16/9]"
          className="-mx-4 -mt-4 mb-1 rounded-t-2xl"
        />
        <div className="flex items-start justify-between gap-2 pr-14">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${CAT_STYLE[market.category] ?? "border-white/10 bg-white/5 text-slate-300"}`}>
              {NAV_LABEL[g] ?? market.category}
            </span>
            <span className="chip text-[10px]">{market.source}</span>
            {pos && (pos.yes > 0n || pos.no > 0n) && (
              <span className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 text-[10px] text-cyan-300">
                {t.paper.card.held}
              </span>
            )}
          </div>
        </div>

        <h3 className="line-clamp-2 text-[15px] font-medium leading-snug text-slate-100 transition-colors group-hover:text-brand">
          {market.question}
        </h3>

        <div className="flex items-end justify-between">
          <div>
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
              {t.paper.card.yesProbability}
              <span className="live-ring h-1 w-1 rounded-full bg-brand" title={t.paper.card.tickTitle} />
            </div>
            <div className={`mono num-glow text-2xl font-semibold text-brand ${flash}`}>{(prob * 100).toFixed(1)}%</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">{t.paper.card.noProbability}</div>
            <div className={`mono text-2xl font-semibold text-danger ${flash}`}>{((1 - prob) * 100).toFixed(1)}%</div>
          </div>
        </div>

        <ProbabilityBar prob={prob} />

        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span className="mono">{format(t.paper.card.depth, { amount: usdc(depth, 0) })}</span>
          <span className="mono">
            <Countdown
              target={market.resolutionAt}
              prefix={t.paper.card.settlePrefix}
              doneText={t.paper.card.expired}
            />
          </span>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-600">
          <span className="mono">{format(t.paper.card.volume, { amount: market.volumeUsdc.toLocaleString() })}</span>
          <span>{format(t.paper.card.debate, { count: talk.count || "—" })}</span>
        </div>

        {/* One-line AI take: available on the hall, no need to open the detail */}
        <div className="flex items-start gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.02] px-2 py-1.5">
          <span className="mt-0.5 shrink-0 text-[10px] text-brand/80">{t.paper.card.aiTag}</span>
          <p className={`line-clamp-2 text-[11px] leading-snug ${TONE_TEXT[insight.tone] ?? "text-slate-300"}`}>
            {insight.text}
          </p>
        </div>

        {/* Latest debate line: the comment wall is alive on the hall too */}
        {talk.latest && (
          <div className="line-clamp-1 text-[10.5px] text-slate-500">
            <span className="text-slate-600">“{talk.latest.text}”</span>
            <span className="ml-1 text-slate-600">{format(t.paper.card.byAuthor, { author: talk.latest.author })}</span>
          </div>
        )}

        {pv && (
          <div className="flex items-center justify-between rounded-lg border border-cyan-400/20 bg-cyan-400/[0.06] px-2.5 py-1.5 text-[11px] text-cyan-200">
            <span>{format(t.paper.card.paperValue, { amount: usdc(pv.value) })}</span>
            <span className={`mono ${pv.pnl >= 0n ? "text-brand" : "text-danger"}`}>
              {pv.pnl >= 0n ? "+" : "-"}
              {usdc(pv.pnl < 0n ? -pv.pnl : pv.pnl)}
            </span>
          </div>
        )}
      </button>

      <span className="pointer-events-none absolute right-3 top-3 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand">
        {t.paper.card.sample}
      </span>

      <div className="flex items-center justify-between border-t border-white/5 pt-2">
        <span className="text-[10px] text-slate-600">{t.paper.card.tickNote}</span>
        <div className="absolute bottom-3 left-3">
          <TelegramShare marketId={market.id} question={market.question} />
        </div>
        <ShareButton
          compact
          input={{
            question: market.question,
            category: market.category,
            side: pos && pos.yes > pos.no ? "YES" : pos && pos.no > 0n ? "NO" : "NEUTRAL",
            prob,
            potentialReturn: prob > 0 && prob < 1 ? `${(1 / prob).toFixed(2)}x` : undefined,
            mode: "paper",
            marketId: market.id,
          }}
        />
      </div>
    </div>
  );
}

/** Sample market detail: paper trading (real CPMM formula) + AI takes + debate wall. Off-chain by design. */
export function DemoDetail({ market, onClose }: { market: DemoMarket; onClose: () => void }) {
  const g = groupOf(market.category);
  const live = useLivePool(market);
  const prob = live.prob;
  const t = useT();
  // Quotes and probability share the hall's simulated book, otherwise users see two prices.
  const marketRef = {
    id: market.id,
    question: market.question,
    category: market.category,
    yesReserve: live.yesReserve,
    noReserve: live.noReserve,
    resolutionTime: market.resolutionAt,
    isDemo: true as const,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-3 sm:p-6">
      <div className="glass-panel w-full max-w-4xl overflow-hidden rounded-3xl p-4 sm:p-5">
        <MarketArt
          id={market.id}
          question={market.question}
          category={market.category}
          ratio="aspect-[21/6]"
          className="-mx-4 -mt-4 mb-3 rounded-t-3xl sm:-mx-5 sm:-mt-5"
        />
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-brand">
                {t.paper.detail.offchainBadge}
              </span>
              <span className={`rounded-full border px-2 py-0.5 ${CAT_STYLE[market.category] ?? "border-white/10 text-slate-300"}`}>
                {NAV_LABEL[g] ?? market.category}
              </span>
              <span className="mono">
                {format(t.paper.detail.settledAt, {
                  time: new Date(market.resolutionAt * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }),
                })}
              </span>
              <span className="mono text-slate-400">
                <Countdown target={market.resolutionAt} prefix={t.paper.detail.remainingPrefix} />
              </span>
            </div>
            <h2 className="text-lg font-semibold leading-snug text-slate-100">{market.question}</h2>
          </div>
          <ShareButton
            input={{
              question: market.question,
              category: market.category,
              side: "NEUTRAL",
              prob,
              potentialReturn: prob > 0 && prob < 1 ? `${(1 / prob).toFixed(2)}x` : undefined,
              mode: "paper",
              marketId: market.id,
            }}
          />
          <button className="btn-ghost px-3 py-1.5" onClick={onClose}>
            {t.paper.detail.close}
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="space-y-3">
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{t.paper.detail.bookTitle}</h3>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <Item k={t.paper.detail.yesProbability} v={`${(prob * 100).toFixed(1)}%`} />
                <Item k={t.paper.detail.noProbability} v={`${((1 - prob) * 100).toFixed(1)}%`} />
                <Item k={t.paper.detail.yesReserve} v={`${usdc(market.yesReserve, 0)} USDC`} />
                <Item k={t.paper.detail.noReserve} v={`${usdc(market.noReserve, 0)} USDC`} />
                <Item k={t.paper.detail.volume} v={`${market.volumeUsdc.toLocaleString()} USDC`} />
                <Item k={t.paper.detail.source} v={market.source} />
              </dl>
              <p className="mt-2 text-[10px] text-slate-600">{t.paper.detail.mathNote}</p>
            </div>

            <div className="rounded-xl border border-brand/15 bg-brand/[0.04] p-3">
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-brand/80">{t.paper.detail.criteriaTitle}</h3>
              <p className="text-[12.5px] leading-relaxed text-slate-300">{market.criteria}</p>
            </div>

            <AIInsights
              marketId={market.id}
              question={market.question}
              category={market.category}
              priceYes={BigInt(Math.round(prob * 1e18))}
              depth={market.yesReserve + market.noReserve}
              volume={BigInt(Math.round(market.volumeUsdc)) * 1_000_000n}
              resolutionTime={market.resolutionAt}
            />
          </div>

          <div className="space-y-3">
            <PaperPanel market={marketRef} />
          </div>
        </div>

        <div className="mt-4">
          <CommentsWall marketId={market.id} compact />
        </div>
      </div>
    </div>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{k}</dt>
      <dd className="mono text-slate-200">{v}</dd>
    </div>
  );
}
