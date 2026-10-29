import type { MarketSnapshot } from "@sdk";
import { pct, shortTime, toProb, usdc } from "../lib/format";
import { marketPhase, PHASE_TEXT } from "../lib/events";
import { Countdown, Empty, ProbabilityBar, Spinner } from "./ui";
import { ShareButton } from "./ShareButton";
import { LogoLoader } from "./BrandLogo";
import { useMode } from "../lib/mode";
import { paperValue } from "../lib/paper";
import { groupOf } from "../lib/nav";
import { format, useT } from "../lib/i18n";

const PHASE_STYLE: Record<string, string> = {
  trading: "border-brand/30 bg-brand/10 text-brand",
  awaiting: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  disputing: "border-amber-400/40 bg-amber-400/15 text-amber-200",
  final: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  closed: "border-white/10 bg-white/5 text-slate-400",
  empty: "border-white/10 bg-white/5 text-slate-400",
};

export function MarketCard({
  market,
  onClick,
  now,
  holding,
}: {
  market: MarketSnapshot;
  onClick: () => void;
  now: number;
  holding?: { yes: bigint; no: bigint };
}) {
  const prob = toProb(market.priceYes);
  const phase = marketPhase(market, now);
  const depthUsdc = market.yesReserve + market.noReserve;
  const t = useT();
  const { mode, paper } = useMode();
  const paperPos = mode === "paper" ? paper.positions[market.marketId] : undefined;
  const pv = paperPos
    ? paperValue(
        {
          id: market.marketId,
          question: market.question ?? "",
          category: market.category ?? "",
          yesReserve: market.yesReserve,
          noReserve: market.noReserve,
          resolutionTime: Number(market.resolutionTime),
        },
        paperPos,
      )
    : undefined;
  const side = holding && holding.yes > holding.no ? "YES" : holding && holding.no > 0n ? "NO" : "NEUTRAL";

  return (
    <div className="flow-border demo-glow card card-hover group flex flex-col gap-3 p-4">
      <button onClick={onClick} className="flex flex-1 flex-col gap-3 text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="chip">{(market.category ?? "general").toUpperCase()}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${PHASE_STYLE[phase]}`}>
              {PHASE_TEXT[phase]}
            </span>
            {mode === "paper" && paperPos && (
              <span className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 text-[10px] text-cyan-300">
                {t.social.card.simPosition}
              </span>
            )}
          </div>
          <span className="mono text-[11px] text-slate-500">
            {phase === "trading" ? (
              <Countdown target={market.resolutionTime} prefix={t.social.card.closesPrefix} />
            ) : phase === "disputing" ? (
              <Countdown target={market.disputeEndsAt} prefix={t.social.card.disputePrefix} />
            ) : market.resolved ? (
              t.social.card.settled
            ) : (
              shortTime(market.resolutionTime)
            )}
          </span>
        </div>

        <h3 className="line-clamp-2 text-[15px] font-medium leading-snug text-slate-100 transition-colors group-hover:text-brand">
          {market.question || t.social.card.untitled}
        </h3>

        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">{t.social.card.yesChance}</div>
            <div className="mono num-glow text-2xl font-semibold text-brand">{pct(market.priceYes)}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">{t.social.card.noChance}</div>
            <div className="mono text-2xl font-semibold text-danger">{pct(market.priceNo)}</div>
          </div>
        </div>

        <ProbabilityBar prob={prob} />

        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span className="mono">
            {format(t.social.card.liquidity, { amount: `${usdc(depthUsdc)} USDC` })}
          </span>
          <span className="mono">
            {format(t.social.card.volume, { amount: `${usdc(market.totalVolume)} USDC` })}
          </span>
        </div>

        {holding && (holding.yes > 0n || holding.no > 0n) && (
          <div className="rounded-lg border border-brand/20 bg-brand/5 px-2.5 py-1.5 text-[11px] text-brand">
            {format(t.social.card.position, { yes: usdc(holding.yes), no: usdc(holding.no) })}
          </div>
        )}

        {pv && (
          <div className="flex items-center justify-between rounded-lg border border-cyan-400/20 bg-cyan-400/[0.06] px-2.5 py-1.5 text-[11px] text-cyan-200">
            <span>{format(t.social.card.paperValue, { amount: `${usdc(pv.value)} FAKE` })}</span>
            <span className={`mono ${pv.pnl >= 0n ? "text-brand" : "text-danger"}`}>
              {pv.pnl >= 0n ? "+" : "-"}
              {usdc(pv.pnl < 0n ? -pv.pnl : pv.pnl)}
            </span>
          </div>
        )}

        {phase === "disputing" && (
          <div className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-200">
            {t.social.card.disputeNotice}
          </div>
        )}
      </button>

      <div className="flex items-center justify-between border-t border-white/5 pt-2">
        <span className="text-[10px] text-slate-600">{t.shell.nav[groupOf(market.category)]}</span>
        <ShareButton
          compact
          input={{
            question: market.question ?? t.social.card.shareFallbackQuestion,
            category: market.category ?? "general",
            side,
            prob,
            potentialReturn: prob > 0 && prob < 1 ? `${(1 / prob).toFixed(2)}x` : undefined,
            mode,
            marketId: market.marketId,
          }}
        />
      </div>
    </div>
  );
}

export function MarketGrid({
  markets,
  loading,
  error,
  onSelect,
  now,
  holdings,
}: {
  markets: MarketSnapshot[];
  loading: boolean;
  error?: string;
  onSelect: (m: MarketSnapshot) => void;
  now: number;
  holdings?: Record<string, { yes: bigint; no: bigint }>;
}) {
  const t = useT();
  if (loading && markets.length === 0) {
    return (
      <div className="space-y-3">
        <div className="card">
          <LogoLoader label={t.social.card.loading} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card flex flex-col gap-3 p-4">
              <div className="skeleton h-4 w-24" />
              <div className="skeleton h-9 w-full" />
              <div className="skeleton h-2 w-full" />
              <div className="skeleton h-4 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (error && markets.length === 0) {
    return <Empty title={t.social.card.errorTitle} hint={error} />;
  }
  if (markets.length === 0) {
    return (
      <Empty title={t.social.card.emptyTitle} hint={t.social.card.emptyHint} />
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {markets.map((m) => (
        <MarketCard
          key={m.marketId}
          market={m}
          onClick={() => onSelect(m)}
          now={now}
          holding={holdings?.[m.marketId]}
        />
      ))}
    </div>
  );
}
