import { useEffect, useRef, useState } from "react";
import { LogoMark } from "./BrandLogo";
import { useMode } from "../lib/mode";
import { play } from "../lib/sound";
import { STARTER_CHIPS, formatFake } from "../lib/paper";
import { format, useT } from "../lib/i18n";

const WELCOME_KEY = "aura.welcome.v2";

/**
 * First-run welcome bonus: 10,000 FAKE-USDC paper chips, credited automatically.
 *
 * Order: compliance risk modal (z-70) confirms first, then this modal (z-68) credits the
 * chips — the user never presses a button to receive them.
 * Motion: number roll-up + rising coins + card pop-in (pure CSS, no animation library).
 * Shown once per browser, gated on localStorage; the paper balance can be reset from the header.
 */
export function WelcomeAirdrop() {
  const t = useT();
  const { mode, paper, claim } = useMode();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [burst, setBurst] = useState(0);
  /** 0 = chips bonus, 1 = novice pool (second beat of the same onboarding) */
  const [stage, setStage] = useState<0 | 1>(0);
  const claimedRef = useRef(false);

  useEffect(() => {
    const maybeOpen = () => {
      try {
        if (window.localStorage.getItem(WELCOME_KEY)) return;
        // No risk-ack gate: the compliance modal sits above this one (z-70 vs z-68), so the
        // bonus is already behind it and is revealed the moment the user acknowledges.
        setOpen(true);
        setBurst((b) => b + 1);
      } catch {
        /* ignore */
      }
    };
    maybeOpen();
    window.addEventListener("aura:risk-ack", maybeOpen);
    return () => window.removeEventListener("aura:risk-ack", maybeOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    // Auto-credit: no button press, the chips land on first visit
    if (!claimedRef.current && !paper.claimed) {
      claimedRef.current = true;
      claim();
    }
    const total = Number(STARTER_CHIPS / 1_000_000n);
    const started = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - started) / 1100);
      const eased = 1 - Math.pow(1 - k, 3);
      setCount(Math.round(total * eased));
      if (k < 1) raf = requestAnimationFrame(step);
      else play("claim");
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [open, paper.claimed, claim]);

  const close = () => {
    try {
      window.localStorage.setItem(WELCOME_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    play("click");
    setOpen(false);
  };

  if (!open) return null;
  const balance = paper.balance > 0n ? paper.balance : STARTER_CHIPS;
  /** Season-1 novice pool share: fixed per browser (derived from the bonus key), never random per render. */
  const poolShare = 1_250 + (Number(balance / 1_000_000n) % 25) * 25;

  return (
    <div className="fixed inset-0 z-[68] flex items-center justify-center overflow-hidden bg-black/85 p-4 backdrop-blur-sm">
      {/* Rising coin particles: pure CSS */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {Array.from({ length: 22 }).map((_, i) => (
          <span
            key={`${burst}-${i}`}
            className="absolute flex items-center justify-center rounded-full border border-brand/50 bg-brand/20 text-[9px] text-brand"
            style={{
              left: `${(i * 41) % 98}%`,
              bottom: `-16px`,
              width: `${7 + (i % 4) * 3}px`,
              height: `${7 + (i % 4) * 3}px`,
              animation: `coinRise ${3.2 + (i % 5) * 0.55}s linear ${(i % 7) * 0.28}s infinite`,
              opacity: 0.18 + (i % 4) * 0.16,
            }}
          />
        ))}
      </div>

      <div className="flow-border glass-panel animate-airdrop-pop relative max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-3xl p-6 text-center">
        <div className="pointer-events-none absolute inset-x-0 -top-24 h-48 bg-[radial-gradient(closest-side,rgba(52,211,153,0.4),transparent)]" />

        <div className="relative mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10 shadow-glow">
          <span className="absolute inset-0 animate-pulse-slow rounded-2xl bg-brand/10" />
          <LogoMark size={46} />
        </div>

        <div className="mb-2 text-[10.5px] uppercase tracking-[0.32em] text-brand/80">{t.airdrop.eyebrow}</div>
        <h2 className="bg-gradient-to-r from-brand-glow via-brand to-cyan-300 bg-clip-text text-2xl font-bold tracking-tight text-transparent">{t.airdrop.headline}</h2>
        <p className="mx-auto mt-2 max-w-[19rem] text-[12.5px] leading-relaxed text-slate-400">{t.airdrop.body}</p>

        <div className="my-4 rounded-2xl border border-brand/25 bg-brand/[0.07] px-4 py-5 shadow-[inset_0_1px_0_rgba(110,231,183,0.15)]">
          <div className="mono num-glow text-5xl font-bold leading-none text-brand">{count.toLocaleString()}</div>
          <div className="mt-1 text-[11px] tracking-wide text-slate-400">{t.airdrop.chipsUnit}</div>
          <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10px] text-brand">
            <span className="live-ring h-1.5 w-1.5 rounded-full bg-brand" />
            {t.airdrop.credited}
          </div>
        </div>

        {stage === 0 ? (
          <>
            <div className="mt-4 grid grid-cols-3 gap-2 text-[10.5px] text-slate-400">
              <div className="rounded-lg border border-white/8 bg-white/[0.03] px-1 py-2">
                <div className="mono text-brand">{t.airdrop.badges.marketsValue}</div>{" "}
                {t.airdrop.badges.markets}
              </div>
              <div className="rounded-lg border border-white/8 bg-white/[0.03] px-1 py-2">
                <div className="mono text-brand">{t.airdrop.badges.quotesValue}</div>{" "}
                {t.airdrop.badges.quotes}
              </div>
              <div className="rounded-lg border border-white/8 bg-white/[0.03] px-1 py-2">
                <div className="mono text-brand">{t.airdrop.badges.aiValue}</div>{" "}
                {t.airdrop.badges.ai}
              </div>
            </div>
            <button data-testid="airdrop-cta" className="btn-primary mt-6 w-full py-3 text-sm" onClick={() => setStage(1)}>
              {format(t.airdrop.ctaBalance, { balance: formatFake(balance, 0) })}
            </button>
            <p className="mt-2 text-[10px] text-slate-600">
              {mode === "paper" ? t.airdrop.finePrintPaper : t.airdrop.finePrintReal}
            </p>
          </>
        ) : (
          <div data-testid="novice-pool" className="animate-airdrop-pop">
            <div className="mt-4 rounded-2xl border border-cyan-400/25 bg-cyan-400/[0.06] px-4 py-4 text-left">
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-cyan-300">
                  {t.marketing.pool.eyebrow}
                </span>
                <span className="live-ring ml-auto h-1.5 w-1.5 rounded-full bg-cyan-300" />
              </div>
              <div className="mt-2 text-[14px] font-semibold text-slate-100">{t.marketing.pool.title}</div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{t.marketing.pool.body}</p>

              <div className="mt-3 flex items-end justify-between">
                <div>
                  <div className="text-[9.5px] uppercase tracking-wide text-slate-500">{t.marketing.pool.share}</div>
                  <div className="mono text-2xl font-bold text-cyan-300">{poolShare.toLocaleString()}</div>
                </div>
                <div className="text-right text-[10px] text-slate-500">
                  {format(t.marketing.pool.joined, { count: (poolShare / 25).toLocaleString() })}
                </div>
              </div>

              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand to-cyan-400 transition-all duration-700"
                  style={{ width: `${Math.min(96, 18 + (poolShare % 60))}%` }}
                />
              </div>
            </div>

            <button data-testid="pool-cta" className="btn-primary mt-4 w-full py-3 text-sm" onClick={close}>
              {t.marketing.pool.cta}
            </button>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-600">{t.marketing.pool.footnote}</p>
          </div>
        )}
      </div>
    </div>
  );
}
