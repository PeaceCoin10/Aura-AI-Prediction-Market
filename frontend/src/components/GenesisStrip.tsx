import { useCallback, useEffect, useMemo, useState } from "react";
import { format, useT } from "../lib/i18n";
import { burstFrom } from "../lib/fx";
import { play } from "../lib/sound";
import { RULES, SEASON, checkIn, localPoints, standings, tradePoints, type LocalPoints } from "../lib/points";
import { shortAddr } from "../lib/identity";
import type { FeedItem } from "../hooks/useEventFeed";

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/**
 * Genesis Predictor Season 1 — hall strip.
 *
 * Every number on this panel is derived, not invented:
 *   · trading points  ← the engine's SharesBought / SharesSold events (paper fills never appear)
 *   · check-in points ← the local ledger (one per UTC day, signed by the browser)
 *   · take points     ← the local ledger, one per published take id
 * The standings table is those same events aggregated per address, so the ranking is auditable
 * from the activity feed above it. There is no seeded or simulated competitor.
 */
export function GenesisStrip({
  feed,
  account,
  onInvite,
}: {
  feed: FeedItem[];
  account?: string | null;
  onInvite: () => void;
}) {
  const t = useT();
  const g = t.genesis;
  const [local, setLocal] = useState<LocalPoints>(() => localPoints());
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => setLocal(localPoints()), []);

  useEffect(() => {
    window.addEventListener("aura:points", refresh);
    return () => window.removeEventListener("aura:points", refresh);
  }, [refresh]);

  const board = useMemo(() => standings(feed), [feed]);
  const me = account ? board.find((r) => r.address === account.toLowerCase()) : undefined;
  const myTrade = tradePoints(me?.volumeUsdc ?? 0);
  const total = myTrade + local.total;
  const ranked = useMemo(() => {
    if (!account) return board;
    const rest = board.filter((r) => r.address !== account.toLowerCase());
    return [...rest, { address: account.toLowerCase(), volumeUsdc: me?.volumeUsdc ?? 0, fills: me?.fills ?? 0, points: total }]
      .sort((a, b) => b.points - a.points)
      .slice(0, 6);
  }, [board, account, me, total]);
  const rank = account ? ranked.findIndex((r) => r.address === account.toLowerCase()) + 1 : 0;

  const claim = (e: React.MouseEvent<HTMLButtonElement>) => {
    const gained = checkIn();
    if (gained > 0) {
      play("success");
      burstFrom(e.currentTarget, 18);
    }
    refresh();
  };

  return (
    <section data-testid="genesis-strip" className="glass-panel mt-4 overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-start gap-4 p-4">
        {/* Points */}
        <div className="min-w-[190px] flex-1">
          <div className="flex items-center gap-2">
            <span className="chip border-brand/30 text-[9.5px] uppercase tracking-wider text-brand">{g.eyebrow}</span>
            <span className="text-[10px] text-slate-600">{g.window}</span>
          </div>
          <h3 className="mt-1.5 text-[15px] font-semibold text-slate-100">{g.title}</h3>
          <div className="mt-2 flex items-end gap-2">
            <span data-testid="genesis-points" className="mono text-[34px] font-bold leading-none text-brand">
              {total.toLocaleString("en-US")}
            </span>
            <span className="pb-1 text-[11px] text-slate-500">{g.pointsUnit}</span>
          </div>
          <p className="mt-1 text-[10.5px] text-slate-500">
            {account
              ? rank > 0
                ? format(g.rank, { rank, total: Math.max(ranked.length, 1) })
                : g.unranked
              : g.connectHint}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              data-testid="genesis-checkin"
              onClick={claim}
              disabled={!local.canCheckIn}
              className={`rounded-lg border px-2.5 py-1 text-[11px] transition ${
                local.canCheckIn
                  ? "border-brand/40 bg-brand/15 text-brand hover:bg-brand/25"
                  : "cursor-default border-white/8 bg-white/[0.02] text-slate-500"
              }`}
            >
              {local.canCheckIn ? format(g.checkIn, { points: RULES.checkIn }) : g.checkedIn}
            </button>
            {local.streak > 1 && (
              <span className="chip text-[9.5px] text-amber-300">{format(g.streak, { days: local.streak })}</span>
            )}
            <button onClick={() => setOpen((v) => !v)} className="btn-ghost px-2 py-1 text-[10.5px]">
              {g.rulesTitle}
            </button>
          </div>
        </div>

        {/* Where the points come from */}
        <div className="min-w-[210px] flex-1 border-l border-white/5 pl-4">
          <h4 className="text-[11px] uppercase tracking-wider text-slate-500">{g.breakdownTitle}</h4>
          <ul className="mt-1.5 space-y-1 text-[11px]">
            <li className="flex justify-between gap-2">
              <span className="text-slate-400">{g.breakdownTrade}</span>
              <span className="mono text-slate-200">{format(g.breakdownTradeValue, { usdc: usd(me?.volumeUsdc ?? 0), points: myTrade })}</span>
            </li>
            <li className="flex justify-between gap-2">
              <span className="text-slate-400">{g.breakdownCheckin}</span>
              <span className="mono text-slate-200">
                {format(g.breakdownCheckinValue, { count: local.checkins, points: RULES.checkIn })}
              </span>
            </li>
            <li className="flex justify-between gap-2">
              <span className="text-slate-400">{g.breakdownTake}</span>
              <span className="mono text-slate-200">
                {format(g.breakdownTakeValue, { count: local.takes, points: RULES.take })}
              </span>
            </li>
          </ul>
          <div className="mt-2 rounded-lg border border-white/8 bg-white/[0.02] p-2">
            <p className="text-[11px] font-medium text-slate-200">{g.inviteTitle}</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{g.inviteBody}</p>
            <button
              data-testid="genesis-invite"
              onClick={onInvite}
              className="mt-1.5 rounded-lg border border-sky-400/30 bg-sky-400/10 px-2 py-1 text-[10.5px] text-sky-300 hover:bg-sky-400/20"
            >
              {g.inviteCta}
            </button>
          </div>
        </div>

        {/* Live standings */}
        <div className="min-w-[210px] flex-1 border-l border-white/5 pl-4">
          <h4 className="text-[11px] uppercase tracking-wider text-slate-500">{g.boardTitle}</h4>
          {ranked.length === 0 ? (
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-slate-600">{g.boardEmpty}</p>
          ) : (
            <ol className="mt-1.5 space-y-1" data-testid="genesis-board">
              {ranked.map((row, i) => {
                const mine = account && row.address === account.toLowerCase();
                return (
                  <li
                    key={row.address}
                    className={`flex items-center gap-2 rounded px-1 py-0.5 text-[11px] ${mine ? "bg-brand/10 text-brand" : "text-slate-300"}`}
                  >
                    <span className="mono w-4 text-slate-600">{i + 1}</span>
                    <span className="mono flex-1 truncate">{shortAddr(row.address)}</span>
                    {mine && <span className="text-[9px] uppercase tracking-wide">{g.boardYou}</span>}
                    <span className="mono text-slate-400">{usd(row.volumeUsdc)}</span>
                    <span className="mono w-10 text-right">{row.points}</span>
                  </li>
                );
              })}
            </ol>
          )}
          <p className="mt-1.5 text-[9.5px] leading-relaxed text-slate-600">{g.boardNote}</p>
        </div>
      </div>

      {open && (
        <div className="border-t border-white/5 bg-black/20 px-4 py-3" data-testid="genesis-rules">
          <ul className="grid gap-1 text-[10.5px] leading-relaxed text-slate-400 sm:grid-cols-2">
            <li>▸ {g.ruleTrade}</li>
            <li>▸ {g.ruleCheckIn}</li>
            <li>▸ {g.ruleTake}</li>
            <li>▸ {g.ruleInvite}</li>
          </ul>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-600">{g.disclaimer}</p>
        </div>
      )}
    </section>
  );
}
