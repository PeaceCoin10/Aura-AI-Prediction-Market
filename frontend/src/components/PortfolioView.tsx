import type { MarketSnapshot } from "@sdk";
import type { Position } from "../hooks/usePortfolio";
import { pct, shortTime, usdc } from "../lib/format";
import { Countdown, Empty, Spinner } from "./ui";
import { format, useT } from "../lib/i18n";

export function PortfolioView({
  positions,
  balance,
  loading,
  account,
  onSelect,
  onRedeem,
}: {
  positions: Position[];
  balance: bigint;
  loading: boolean;
  account?: string;
  onSelect: (m: MarketSnapshot) => void;
  onRedeem: (m: MarketSnapshot) => void;
}) {
  const t = useT();
  const heading = <h2 className="px-1 text-sm font-medium text-slate-300">{t.portfolio.positions.title}</h2>;

  if (!account) {
    return (
      <div className="space-y-4">
        {heading}
        <Empty title={t.portfolio.positions.connectTitle} hint={t.portfolio.positions.connectHint} />
      </div>
    );
  }

  const disputing = positions.filter((p) => p.disputing);
  const redeemable = positions.filter((p) => p.redeemable);
  const open = positions.filter((p) => !p.market.resolved);

  const totalIn = positions.reduce((sum, p) => sum + p.yes + p.no, 0n);

  return (
    <div className="space-y-4">
      {heading}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t.portfolio.positions.usdcBalance} value={`${usdc(balance)} `} unit="USDC" accent="text-brand" />
        <Stat label={t.portfolio.positions.unsettled} value={usdc(totalIn, 0)} unit={t.portfolio.positions.sharesUnit} />
        <Stat
          label={t.portfolio.positions.redeemable}
          value={String(redeemable.length)}
          unit={
            disputing.length
              ? format(t.portfolio.positions.disputingUnit, { count: disputing.length })
              : t.portfolio.positions.marketsUnit
          }
        />
      </div>

      {disputing.length > 0 && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs leading-relaxed text-amber-200">
          <b>
            {format(
              disputing.length > 1
                ? t.portfolio.positions.disputeTitlePlural
                : t.portfolio.positions.disputeTitle,
              { count: disputing.length },
            )}
          </b>
          <br />
          {t.portfolio.positions.disputeBody} <span className="mono">finalize()</span>.
        </div>
      )}

      {loading && positions.length === 0 && (
        <div className="card flex items-center gap-3 px-5 py-10 text-sm text-slate-400">
          <Spinner /> {t.portfolio.positions.readingShares}
        </div>
      )}

      {!loading && positions.length === 0 && (
        <Empty title={t.portfolio.positions.emptyTitle} hint={t.portfolio.positions.emptyHint} />
      )}

      {([t.portfolio.positions.groupRedeemable, t.portfolio.positions.groupDisputing, t.portfolio.positions.groupOpen] as const).map(
        (group, i) => {
          const rows = i === 0 ? redeemable : i === 1 ? disputing : open;
          if (!rows.length) return null;
          return (
            <section key={group} className="space-y-2">
              <h3 className="px-1 text-xs font-medium uppercase tracking-wide text-slate-500">{group}</h3>
              {rows.map((p) => (
                <div key={p.market.marketId} className="card flex flex-wrap items-center gap-3 p-3">
                  <button className="min-w-0 flex-1 text-left" onClick={() => onSelect(p.market)}>
                    <div className="line-clamp-1 text-sm text-slate-100 hover:text-brand">
                      {p.market.question || t.portfolio.positions.untitled}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-2 text-[11px] text-slate-500">
                      <span className="mono">YES {usdc(p.yes)}</span>
                      <span className="mono">NO {usdc(p.no)}</span>
                      <span className="mono">
                        {format(t.portfolio.positions.yesPrice, { price: pct(p.market.priceYes) })}
                      </span>
                      <span>{format(t.portfolio.positions.settles, { time: shortTime(p.market.resolutionTime) })}</span>
                    </div>
                  </button>

                  <div className="flex items-center gap-2">
                    {p.disputing && (
                      <span className="chip border-amber-400/30 bg-amber-400/10 text-amber-200">
                        {t.portfolio.positions.disputeLabel} <Countdown target={p.market.disputeEndsAt} />
                      </span>
                    )}
                    {p.redeemable ? (
                      <button className="btn-primary" onClick={() => onRedeem(p.market)}>
                        {t.portfolio.positions.redeem}
                      </button>
                    ) : p.disputing ? (
                      <button className="btn-ghost" disabled title={t.portfolio.positions.lockedTitle}>
                        {t.portfolio.positions.locked}
                      </button>
                    ) : (
                      <button className="btn-ghost" onClick={() => onSelect(p.market)}>
                        {t.portfolio.positions.trade}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </section>
          );
        },
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  accent = "text-slate-100",
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: string;
}) {
  return (
    <div className="card p-4">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mono mt-1 text-2xl font-semibold ${accent}`}>
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-slate-500">{unit}</span>}
      </div>
    </div>
  );
}
