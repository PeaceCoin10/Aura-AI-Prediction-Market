import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../lib/i18n";
import { DEMO_MARKETS } from "../data/markets";
import { useLivePool } from "../lib/demoLive";
import type { DemoMarket, Vertical } from "../lib/demo";
import { play } from "../lib/sound";

const ROTATE_MS = 8000;

const VERTICAL_KEY: Record<Vertical, string> = {
  crypto: "crypto",
  news: "news",
  sports: "sports",
  esports: "esports",
  tech: "tech",
};

/**
 * Global headline banner.
 *
 * Editorial selection is deterministic — the deepest books per vertical — so the same story does not
 * jump in and out of the banner between renders. Probabilities come from the same simulated feed the
 * cards use (`useLivePool`), which is why the number breathes on the 7s tick instead of sitting on a
 * frozen value; the banner is labelled with that cadence and never claims to be an on-chain print.
 */
function headlines(): DemoMarket[] {
  const byVertical = new Map<Vertical, DemoMarket>();
  for (const m of [...DEMO_MARKETS].sort((a, b) => b.volumeUsdc - a.volumeUsdc)) {
    if (!byVertical.has(m.category)) byVertical.set(m.category, m);
  }
  const out = [...byVertical.values()];
  const rest = [...DEMO_MARKETS].sort((a, b) => b.volumeUsdc - a.volumeUsdc).filter((m) => !out.includes(m));
  return [...out, ...rest].slice(0, 5);
}

export function HeroCarousel({ onOpen }: { onOpen: (m: DemoMarket) => void }) {
  const t = useT();
  const items = useMemo(headlines, []);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const current = items[index % items.length];
  const live = useLivePool(current);

  // Probability trail for the sparkline: keeps the last 24 ticks of this slide.
  const trail = useRef<number[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    trail.current.push(live.prob);
    if (trail.current.length > 24) trail.current.shift();
    setTick((v) => v + 1);
  }, [live.prob]);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % items.length);
      trail.current = [];
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [paused, items.length]);

  const go = (step: number) => {
    play("click");
    setIndex((i) => (i + step + items.length) % items.length);
    trail.current = [];
  };

  if (!current) return null;
  const pct = live.prob * 100;
  const previous = trail.current.length > 1 ? trail.current[trail.current.length - 2] : live.prob;
  const delta = (live.prob - previous) * 100;

  const spark = (() => {
    const pts = trail.current.length > 1 ? trail.current : [live.prob - 0.004, live.prob];
    const w = 120;
    const h = 34;
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const span = max - min || 0.01;
    return pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${((i / (pts.length - 1)) * w).toFixed(1)},${(h - ((p - min) / span) * (h - 4) - 2).toFixed(1)}`)
      .join(" ");
  })();

  return (
    <section
      data-testid="hero-carousel"
      className="breathe relative overflow-hidden rounded-2xl border border-white/10 bg-ink-900/60"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <img
        key={current.id}
        src={`${import.meta.env.BASE_URL}art/${current.id}.svg`}
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full animate-fade-in object-cover opacity-70"
        loading="eager"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-[#05060a] via-[#05060a]/85 to-[#05060a]/20" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#05060a] via-transparent to-transparent" />

      <div className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-brand/35 bg-brand/12 px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] text-brand">
              {t.terminal.hero.eyebrow}
            </span>
            <span className="text-[10px] uppercase tracking-[0.16em] text-slate-400">
              {t.shell.nav[VERTICAL_KEY[current.category] as keyof typeof t.shell.nav]}
            </span>
            <span className="live-ring h-1.5 w-1.5 rounded-full bg-brand" />
          </div>

          <h2 className="mt-2 max-w-2xl text-balance text-xl font-semibold leading-snug text-slate-50 sm:text-[22px]">
            {current.question}
          </h2>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-baseline gap-1.5">
              <span className="mono text-[26px] font-semibold leading-none text-brand">{pct.toFixed(1)}%</span>
              <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{t.terminal.hero.probability}</span>
            </div>

            <svg viewBox="0 0 120 34" className="h-8 w-[120px]" aria-hidden data-testid="hero-spark">
              <path d={spark} fill="none" stroke="#34d399" strokeWidth="1.6" strokeLinecap="round" />
            </svg>

            <span
              className={`mono text-[11px] ${delta >= 0 ? "text-brand" : "text-danger"}`}
              key={`d-${tick}`}
            >
              {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(2)}%
            </span>

            <span className="chip text-[10px]">
              {t.terminal.hero.depth.replace("{{amount}}", Math.round(Number(current.yesReserve + current.noReserve) / 1_000_000).toLocaleString())}
            </span>
            <span className="chip text-[10px]">
              {t.terminal.hero.settling.replace(
                "{{hours}}",
                String(Math.max(1, Math.round((current.resolutionAt - Date.now() / 1000) / 3600))),
              )}
            </span>
          </div>

          <div className="mt-3.5 flex items-center gap-2">
            <button
              className="btn-primary px-3.5 py-1.5 text-[12px]"
              onClick={() => {
                play("click");
                onOpen(current);
              }}
              data-testid="hero-open"
            >
              {t.terminal.hero.cta}
            </button>
            <span className="text-[10px] text-slate-600">{t.terminal.hero.body}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 self-end">
          <button
            onClick={() => go(-1)}
            aria-label={t.terminal.hero.previous}
            className="glass-btn h-8 w-8 rounded-full text-[13px]"
          >
            ‹
          </button>
          <button
            onClick={() => setPaused((v) => !v)}
            aria-label={paused ? t.terminal.hero.play : t.terminal.hero.pause}
            className="glass-btn h-8 w-8 rounded-full text-[10px]"
          >
            {paused ? "▶" : "❙❙"}
          </button>
          <button
            onClick={() => go(1)}
            aria-label={t.terminal.hero.next}
            className="glass-btn h-8 w-8 rounded-full text-[13px]"
          >
            ›
          </button>
        </div>
      </div>

      <div className="relative flex items-center gap-2 px-5 pb-3">
        {items.map((m, i) => (
          <button
            key={m.id}
            onClick={() => {
              setIndex(i);
              trail.current = [];
            }}
            aria-label={m.question}
            className={`h-1 rounded-full transition-all ${
              i === index % items.length ? "w-8 bg-brand" : "w-3 bg-white/15 hover:bg-white/30"
            }`}
          />
        ))}
        <span className="mono ml-auto text-[10px] text-slate-600">
          {t.terminal.hero.slide.replace("{{index}}", String((index % items.length) + 1)).replace("{{total}}", String(items.length))}
        </span>
      </div>

      {!paused && (
        <div className="absolute bottom-0 left-0 h-0.5 w-full overflow-hidden">
          <div className="hero-progress h-full bg-gradient-to-r from-brand to-cyan-300" key={index} />
        </div>
      )}
    </section>
  );
}
