import { useMemo } from "react";
import { useT } from "../lib/i18n";
import { money, type ExchangePrint } from "../lib/exchangeTape";

/**
 * Whale-flow tape.
 *
 * Every row is a real print from Binance spot (aggregated trades), filtered to tickets at or above
 * $25k notional and sorted by size. Nothing here is invented: if the venue is unreachable the tape
 * renders nothing instead of dressing a sample up as flow. The venue is named in the header so a
 * spot print is never mistaken for a fill on this venue's own book.
 */
const MIN_NOTIONAL = 25_000;

export function WhaleTicker({ prints = [] }: { prints?: ExchangePrint[] }) {
  const t = useT();
  const items = useMemo(
    () => prints.filter((p) => p.notional >= MIN_NOTIONAL).sort((a, b) => b.notional - a.notional).slice(0, 24),
    [prints],
  );

  if (items.length === 0) return null;

  const row = (p: ExchangePrint) => {
    const mins = Math.max(0, Math.round((Date.now() - p.ts) / 60_000));
    return (
      <span key={p.id} className="inline-flex items-center gap-2 border-r border-white/[0.06] px-3 py-1.5">
        <span className="mono text-[10px] text-brand/70">◆</span>
        <span className="mono text-[11px] text-slate-300">{p.symbol}</span>
        <span className={`text-[11px] ${p.side === "BUY" ? "text-brand" : "text-danger"}`}>
          {p.side === "BUY" ? t.terminal.whale.bought : t.terminal.whale.sold}
        </span>
        <span className="mono text-[11.5px] font-semibold text-slate-100">{money(p.notional)}</span>
        <span className="mono text-[10px] text-slate-500">
          {p.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </span>
        <span className="mono text-[9.5px] text-slate-600">
          {mins <= 0 ? t.terminal.whale.justNow : t.terminal.whale.ago.replace("{{mins}}", String(mins))}
        </span>
        <span className="rounded-full bg-white/5 px-1.5 text-[9px] uppercase tracking-wide text-slate-500">{p.venue}</span>
      </span>
    );
  };

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-brand/20 bg-gradient-to-r from-brand/[0.07] via-white/[0.02] to-transparent"
      data-testid="whale-ticker"
    >
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-1.5">
        <span className="flex h-4 w-4 items-center justify-center rounded-full border border-brand/40 bg-brand/15 text-[9px] text-brand">
          ◆
        </span>
        <span className="text-[10px] uppercase tracking-[0.2em] text-slate-300">{t.terminal.whale.title}</span>
        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-1.5 text-[9px] uppercase tracking-wide text-slate-400">
          <span className="h-1 w-1 rounded-full bg-brand" />
          {t.terminal.whale.live}
        </span>
        <span className="mono text-[9.5px] text-slate-600">{t.terminal.whale.hint}</span>
        <span className="ml-auto text-[9.5px] text-slate-600">{t.terminal.whale.note}</span>
      </div>
      <div className="ticker-track flex w-max items-center whitespace-nowrap" style={{ animationDuration: "96s" }}>
        {items.map(row)}
        {items.map((p) => row({ ...p, id: `${p.id}-b` }))}
      </div>
    </div>
  );
}
