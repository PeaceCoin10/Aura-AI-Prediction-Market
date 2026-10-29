import { useMemo } from "react";
import { DEMO_MARKETS } from "../data/markets";
import { format, useT } from "../lib/i18n";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = (h ^ s.charCodeAt(i)) * 16777619;
  return Math.abs(h);
}

const ALIASES = [
  "0xWhale", "RiftAnalyst", "macro_maxi", "courtside_vet", "oddsmaker_eth", "quant_owl",
  "Satoshi_Cat", "PitchsidePete", "AWP_enjoyer", "gpu_hunter",
];

interface Row {
  alias: string;
  trades: number;
  accuracy: number;
  pnl: number;
  streak: number;
}

/**
 * Deterministic "cohort" of predictors used to give the hall a social shape before real users exist.
 *
 * This board is a **simulation**: every row is derived from the sample book, none of it is a real
 * account, and the panel says so in the header and the footnote. Real fills are counted separately and
 * shown as "on-chain fills", never mixed into the ranking.
 */
function cohort(): Row[] {
  return ALIASES.map((alias, i) => {
    const h = hash(alias);
    const trades = 18 + (h % 240);
    const accuracy = 0.48 + ((h >> 5) % 22) / 100;
    const pnl = 900 + ((h >> 9) % 46000);
    return { alias, trades, accuracy, pnl, streak: 1 + ((h >> 13) % 7) };
  })
    .sort((a, b) => b.pnl - a.pnl)
    .slice(0, 8);
}

export function PredictorBoard({ realFillCount = 0 }: { realFillCount?: number }) {
  const t = useT();
  const rows = useMemo(cohort, []);
  const bookDepth = useMemo(
    () => DEMO_MARKETS.reduce((acc, m) => acc + m.volumeUsdc, 0),
    [],
  );

  return (
    <section className="card relative overflow-hidden p-3" data-testid="predictor-board">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-[13px] font-semibold text-slate-100">{t.marketing.board.title}</h2>
        <span className="rounded-full border border-amber-400/35 bg-amber-400/10 px-2 py-0.5 text-[9px] uppercase tracking-wide text-amber-300">
          {t.marketing.board.badge}
        </span>
        <span className="ml-auto mono text-[10px] text-slate-600">
          {format(t.marketing.board.season, { volume: Math.round(bookDepth / 1000) })}
        </span>
      </div>

      <div className="mb-1 grid grid-cols-[22px_1fr_54px_54px_72px] gap-1 text-[9px] uppercase tracking-wide text-slate-600">
        <span>#</span>
        <span>{t.marketing.board.colPredictor}</span>
        <span className="text-right">{t.marketing.board.colTrades}</span>
        <span className="text-right">{t.marketing.board.colHit}</span>
        <span className="text-right">{t.marketing.board.colPnl}</span>
      </div>

      <ol className="space-y-0.5">
        {rows.map((r, i) => (
          <li
            key={r.alias}
            className="grid grid-cols-[22px_1fr_54px_54px_72px] items-center gap-1 rounded-md px-0.5 py-1 text-[11px] odd:bg-white/[0.02]"
          >
            <span className={`mono ${i === 0 ? "text-brand" : i < 3 ? "text-cyan-300" : "text-slate-600"}`}>{i + 1}</span>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand/40 to-cyan-400/30 text-[8px] text-slate-900">
                {r.alias.slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate text-slate-300">{r.alias}</span>
              {r.streak >= 5 && <span className="text-[9px] text-amber-300">🔥{r.streak}</span>}
            </span>
            <span className="mono text-right text-slate-500">{r.trades}</span>
            <span className="mono text-right text-slate-400">{(r.accuracy * 100).toFixed(0)}%</span>
            <span className="mono text-right text-brand">+{(r.pnl / 1000).toFixed(1)}k</span>
          </li>
        ))}
      </ol>

      <p className="mt-2 text-[9.5px] leading-relaxed text-slate-600">
        {format(t.marketing.board.footnote, { fills: realFillCount })}
      </p>
    </section>
  );
}
