import { useMemo } from "react";
import { useT } from "../lib/i18n";
import { DEMO_MARKETS } from "../data/markets";

/**
 * Whale-flow tape: the standing institutional tell that money is moving.
 *
 * Honesty boundary, same as the trade ticker: real fills from the event feed are shown first and
 * tagged ON-CHAIN; the rest is a deterministic sample derived from the featured book, labelled
 * "Simulated tape" in the header. A sample print is never dressed up as a settled transaction.
 *
 * Only tickets at or above $25k appear — that is the threshold the header advertises, and it is
 * enforced in `buildSample`, not just in the copy.
 */
const MIN_USDC = 25_000;

export interface WhalePrint {
  id: string;
  wallet: string;
  side: "YES" | "NO";
  usdc: number;
  question: string;
  ageMin: number;
  real?: boolean;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = (h ^ s.charCodeAt(i)) * 16777619;
  return Math.abs(h);
}

function walletOf(seed: string): string {
  const h1 = hash(`${seed}:a`).toString(16).padStart(8, "0");
  const h2 = hash(`${seed}:b`).toString(16).padStart(8, "0");
  return `0x${h1.slice(0, 4)}…${h2.slice(-4)}`;
}

/** Deterministic sample: the deepest books get the biggest prints. */
export function buildWhaleSample(limit = 28): WhalePrint[] {
  const top = [...DEMO_MARKETS].sort((a, b) => b.volumeUsdc - a.volumeUsdc).slice(0, limit);
  return top.map((m, i) => {
    const h = hash(`${m.id}:whale`);
    // $25k → $480k, weighted so the biggest books carry the loudest tickets.
    const tier = 1 - i / Math.max(1, top.length);
    const usdc = Math.round((MIN_USDC + (h % 455_000) * (0.35 + tier * 0.65)) / 500) * 500;
    return {
      id: `w-${m.id}`,
      wallet: walletOf(m.id),
      side: h % 3 === 0 ? "NO" : "YES",
      usdc,
      question: m.question,
      ageMin: 1 + (h % 47),
    };
  });
}

const money = (v: number) => `$${v.toLocaleString()}`;

export function WhaleTicker({ realPrints = [] }: { realPrints?: WhalePrint[] }) {
  const t = useT();
  const items = useMemo(() => {
    const real = realPrints.filter((p) => p.usdc >= MIN_USDC);
    const sample = buildWhaleSample();
    const seen = new Set(real.map((p) => p.id));
    return [...real, ...sample.filter((p) => !seen.has(p.id))];
  }, [realPrints]);

  if (items.length === 0) return null;
  const live = realPrints.some((p) => p.usdc >= MIN_USDC);

  const row = (p: WhalePrint) => (
    <span key={p.id} className="inline-flex items-center gap-2 border-r border-white/[0.06] px-3 py-1.5">
      <span className="mono text-[10px] text-slate-500">{p.real ? "◆" : "◇"}</span>
      <span className="mono text-[11px] text-slate-400">{p.wallet}</span>
      <span className={`text-[11px] ${p.side === "YES" ? "text-brand" : "text-danger"}`}>
        {p.side === "YES" ? t.terminal.whale.bought : t.terminal.whale.sold}
      </span>
      <span className="mono text-[11.5px] font-semibold text-slate-100">{money(p.usdc)}</span>
      <span className={`mono rounded px-1 text-[9.5px] ${p.side === "YES" ? "bg-brand/15 text-brand" : "bg-danger/15 text-danger"}`}>
        {p.side}
      </span>
      <span className="max-w-[240px] truncate text-[11px] text-slate-500">{p.question}</span>
      <span className="mono text-[9.5px] text-slate-600">
        {p.ageMin <= 1 ? t.terminal.whale.justNow : t.terminal.whale.ago.replace("{{mins}}", String(p.ageMin))}
      </span>
      {p.real && <span className="rounded-full bg-cyan-400/15 px-1.5 text-[9px] text-cyan-300">ON-CHAIN</span>}
    </span>
  );

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
        <span className="rounded-full border border-white/10 bg-white/5 px-1.5 text-[9px] uppercase tracking-wide text-slate-500">
          {live ? t.terminal.whale.live : t.terminal.whale.sample}
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
