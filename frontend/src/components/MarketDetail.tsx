import type { MarketSnapshot } from "@sdk";
import { EXPLORER } from "../lib/config";
import { shortId, shortTime, usdc, pct, toProb } from "../lib/format";
import { DEMO_MARKETS } from "../lib/demo";
import { TradePanel } from "./TradePanel";
import { CommentsWall } from "./CommentsWall";
import { Countdown } from "./ui";
import { AIInsights } from "./AIInsights";
import { PaperPanel } from "./PaperPanel";
import { ShareButton } from "./ShareButton";
import { TelegramShare } from "./TelegramShare";
import { useMode } from "../lib/mode";
import { useT } from "../lib/i18n";

export function MarketDetail({
  market,
  holding,
  onClose,
  onDone,
}: {
  market: MarketSnapshot;
  holding?: { yes: bigint; no: bigint };
  onClose: () => void;
  onDone: () => void;
}) {
  const { mode } = useMode();
  const t = useT();
  const prob = toProb(market.priceYes);
  const side = holding && holding.yes > holding.no ? "YES" : holding && holding.no > 0n ? "NO" : "NEUTRAL";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-3 sm:p-6">
      <div className="glass-panel w-full max-w-4xl rounded-3xl p-4 sm:p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span className="chip">{(market.category ?? "general").toUpperCase()}</span>
              <span className="chip text-[10px]">{t.trade.market.onChainChip}</span>
              <span className="mono">
                <a
                  href={`${EXPLORER}/address/${market.marketId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-brand"
                >
                  {shortId(market.marketId)}
                </a>
              </span>
              <span>
                {t.trade.market.settlesPrefix}
                {shortTime(market.resolutionTime)}
              </span>
              {!market.resolved && (
                <span className="mono text-slate-400">
                  <Countdown target={market.resolutionTime} prefix={t.trade.market.inPrefix} />
                </span>
              )}
            </div>
            <h2 className="text-lg font-semibold leading-snug text-slate-100">
              {market.question || t.trade.market.untitled}
            </h2>
          </div>
          <TelegramShare marketId={market.marketId} question={market.question ?? market.marketId} />
          <ShareButton
            input={{
              question: market.question ?? t.trade.market.shareFallbackQuestion,
              category: market.category ?? "general",
              side,
              prob,
              potentialReturn: prob > 0 && prob < 1 ? `${(1 / prob).toFixed(2)}x` : undefined,
              mode,
              marketId: market.marketId,
            }}
          />
          <button className="btn-ghost px-3 py-1.5" onClick={onClose}>
            {t.trade.common.close}
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <div className="space-y-3">
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                {t.trade.market.dataTitle}
              </h3>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <Item k={t.trade.market.yesProb} v={pct(market.priceYes)} />
                <Item k={t.trade.market.noProb} v={pct(market.priceNo)} />
                <Item k={t.trade.market.yesReserve} v={`${usdc(market.yesReserve)} USDC`} />
                <Item k={t.trade.market.noReserve} v={`${usdc(market.noReserve)} USDC`} />
                <Item k={t.trade.market.cash} v={`${usdc(market.cash)} USDC`} />
                <Item k={t.trade.market.owed} v={`${usdc(market.owed)} USDC`} />
                <Item k={t.trade.market.volume} v={`${usdc(market.totalVolume)} USDC`} />
                <Item k={t.trade.market.tradable} v={market.tradingOpen ? t.trade.market.yes : t.trade.market.no} />
                <Item
                  k={t.trade.market.status}
                  v={
                    market.resolved
                      ? market.finalized
                        ? t.trade.market.statusFinalized
                        : t.trade.market.statusDispute
                      : t.trade.market.statusUnresolved
                  }
                />
                <Item
                  k={t.trade.market.outcome}
                  v={
                    market.resolved
                      ? market.outcome === 1
                        ? "YES"
                        : market.outcome === 0
                          ? "NO"
                          : "INVALID"
                      : "—"
                  }
                />
              </dl>
            </div>

            <AIInsights
              marketId={market.marketId}
              question={market.question ?? ""}
              category={market.category}
              priceYes={market.priceYes}
              depth={market.yesReserve + market.noReserve}
              volume={market.totalVolume}
              resolutionTime={Number(market.resolutionTime)}
            />

            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-[11px] leading-relaxed text-slate-400">
              <b className="text-slate-300">{t.trade.market.rulesTitle}</b>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                <li>{t.trade.market.rulePricing}</li>
                <li>{t.trade.market.ruleFees}</li>
                <li>{t.trade.market.ruleDispute}</li>
                <li>{t.trade.market.ruleEmergency}</li>
              </ul>
            </div>
          </div>

          {mode === "paper" ? (
            <PaperPanel
              market={{
                id: market.marketId,
                question: market.question ?? "",
                category: market.category ?? "",
                yesReserve: market.yesReserve,
                noReserve: market.noReserve,
                resolutionTime: Number(market.resolutionTime),
              }}
            />
          ) : (
            <TradePanel market={market} holding={holding} onDone={onDone} />
          )}
        </div>

        <div className="mt-4">
          <CommentsWall marketId={market.marketId} seedIds={DEMO_MARKETS.map((d) => d.id)} />
        </div>
      </div>
    </div>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2.5 py-1.5">
      <dt className="text-slate-500">{k}</dt>
      <dd className="mono text-slate-200">{v}</dd>
    </div>
  );
}
