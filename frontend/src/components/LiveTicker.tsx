import { useMemo } from "react";
import { useT } from "../lib/i18n";
import { money, type ExchangePrint } from "../lib/exchangeTape";

/**
 * Live trade ticker.
 *
 * Rows are real aggregated trades from Binance spot: side, notional, pair, execution price and age.
 * The old deterministic "sample" stream is gone — a tape that invents fills is worse than no tape,
 * and the venue is named on every row so a spot print is never read as a fill on this book.
 */
export function LiveTicker({ prints = [], rows = 40 }: { prints?: ExchangePrint[]; rows?: number }) {
  const t = useT();
  const items = useMemo(() => prints.slice(0, rows), [prints, rows]);

  if (items.length === 0) return null;

  const row = (f: ExchangePrint) => (
    <span key={f.id} className="inline-flex items-center gap-2 border-r border-white/[0.06] px-3 py-1">
      <span className={`mono text-[10px] font-semibold ${f.side === "BUY" ? "text-brand" : "text-danger"}`}>{f.side}</span>
      <span className="mono text-[11px] text-slate-300">{money(f.notional)}</span>
      <span className="mono text-[11px] text-slate-400">{f.symbol}</span>
      <span className="mono text-[10.5px] text-slate-500">
        @ {f.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </span>
      <span className="rounded-full bg-white/5 px-1.5 text-[9px] uppercase tracking-wide text-slate-500">{f.venue}</span>
    </span>
  );

  return (
    <div className="relative overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.02]" data-testid="live-ticker">
      <div className="flex items-center gap-2 border-b border-white/[0.05] px-3 py-1">
        <span className="live-ring h-1.5 w-1.5 rounded-full bg-brand" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{t.marketing.ticker.title}</span>
        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-1.5 text-[9px] uppercase tracking-wide text-slate-500">
          <span className="h-1 w-1 rounded-full bg-brand" />
          {t.marketing.ticker.live}
        </span>
        <span className="ml-auto text-[10px] text-slate-600">{t.marketing.ticker.hint}</span>
      </div>
      <div className="ticker-track flex w-max items-center whitespace-nowrap">
        {items.map(row)}
        {items.map((f) => row({ ...f, id: f.id + "-b" }))}
      </div>
    </div>
  );
}
