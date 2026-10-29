import { useMemo } from "react";
import { DEMO_MARKETS } from "../data/markets";
import { useT } from "../lib/i18n";

/** Deterministic pseudo-random from a string so the ticker is stable across renders. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = (h ^ s.charCodeAt(i)) * 16777619;
  return Math.abs(h);
}

const ALIASES = [
  "0xWhale", "RiftAnalyst", "Bond_Trader", "courtside_vet", "defi_researcher", "Satoshi_Cat",
  "quant_owl", "PitchsidePete", "AWP_enjoyer", "macro_maxi", "gpu_hunter", "oddsmaker_eth",
];

export interface TickerFill {
  id: string;
  alias: string;
  side: "YES" | "NO";
  amount: number;
  question: string;
  real?: boolean;
}

function buildSample(): TickerFill[] {
  return DEMO_MARKETS.slice(0, 60).map((m, i) => {
    const h1 = hash(m.id);
    const h2 = hash(m.id + "amt");
    return {
      id: `${m.id}-${i}`,
      alias: ALIASES[h1 % ALIASES.length],
      side: h1 % 2 ? "YES" : "NO",
      amount: 40 + (h2 % 960),
      question: m.question,
    };
  });
}

/**
 * Live trade ticker. Real fills are prepended when the event feed has any; otherwise the stream is
 * the sample book, labelled as such — never presented as organic volume.
 */
export function LiveTicker({ realFills = [] }: { realFills?: TickerFill[] }) {
  const t = useT();
  const items = useMemo(() => [...realFills, ...buildSample()], [realFills]);
  const sampleOnly = realFills.length === 0;
  if (items.length === 0) return null;

  const row = (f: TickerFill) => (
    <span key={f.id} className="inline-flex items-center gap-2 border-r border-white/[0.06] px-3 py-1">
      <span className={`mono text-[10px] font-semibold ${f.side === "YES" ? "text-brand" : "text-danger"}`}>{f.side}</span>
      <span className="mono text-[11px] text-slate-300">{f.amount.toLocaleString()} USDC</span>
      <span className="max-w-[220px] truncate text-[11px] text-slate-500">{f.question}</span>
      <span className={`text-[10px] ${f.real ? "text-cyan-300" : "text-slate-600"}`}>{f.alias}</span>
      {f.real && <span className="rounded-full bg-cyan-400/15 px-1.5 text-[9px] text-cyan-300">ON-CHAIN</span>}
    </span>
  );

  return (
    <div className="relative overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.02]" data-testid="live-ticker">
      <div className="flex items-center gap-2 border-b border-white/[0.05] px-3 py-1">
        <span className="live-ring h-1.5 w-1.5 rounded-full bg-brand" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{t.marketing.ticker.title}</span>
        <span className="rounded-full border border-white/10 bg-white/5 px-1.5 text-[9px] uppercase tracking-wide text-slate-500">
          {sampleOnly ? t.marketing.ticker.sample : t.marketing.ticker.live}
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
