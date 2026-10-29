import { useEffect, useState } from "react";
import { countdown } from "../lib/format";
import { useT } from "../lib/i18n";

/** Countdown that re-renders once a second: one timer per instance, local state only. */
export function Countdown({
  target,
  className = "",
  prefix,
  doneText,
}: {
  target: bigint | number;
  className?: string;
  prefix?: string;
  doneText?: string;
}) {
  const t = useT();
  const done = doneText ?? t.ui.countdown.expired;
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const left = Number(target) - now;
  const text = left > 0 ? countdown(target, now) : done;
  return (
    <span className={`mono ${className}`}>
      {prefix}
      {left > 0 ? text : <span className="text-amber-300">{done}</span>}
    </span>
  );
}

/** YES probability bar: green = YES, red = NO, spring easing with a top highlight sweep. */
export function ProbabilityBar({ prob, height = 8 }: { prob: number; height?: number }) {
  const pctW = Math.min(100, Math.max(0, prob * 100));
  return (
    <div
      className="relative w-full overflow-hidden rounded-full bg-danger/25 ring-1 ring-inset ring-white/5"
      style={{ height }}
    >
      {/* NO side carries a diagonal hatch so the bar never looks flat */}
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, rgba(251,113,133,0.35) 0 4px, transparent 4px 8px)",
        }}
      />
      <div
        className="relative h-full rounded-full bg-gradient-to-r from-brand-dim via-brand to-cyan-300 shadow-[0_0_18px_-4px_rgba(52,211,153,0.9)] ease-spring"
        style={{ width: `${pctW}%`, transition: "width 900ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}
      >
        <div className="absolute inset-0 rounded-full bg-gradient-to-b from-white/35 to-transparent opacity-60" />
      </div>
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-brand ${className}`}
    />
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="text-3xl opacity-40">◎</div>
      <div className="text-sm font-medium text-slate-300">{title}</div>
      {hint && <div className="max-w-md text-xs leading-relaxed text-slate-500">{hint}</div>}
    </div>
  );
}
