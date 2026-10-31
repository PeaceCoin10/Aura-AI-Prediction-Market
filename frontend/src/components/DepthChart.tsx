import { useMemo } from "react";
import { format, useT } from "../lib/i18n";

/**
 * Live market-depth curve.
 *
 * The curve is not decorative: for each USDC notional it re-solves the engine's constant-product
 * invariant (k = yes × no) and plots the YES price that notional would move the book to. That is
 * exactly the "what would $50k do here" question a desk asks, drawn from the same reserves the
 * trade panel quotes against — no parallel model, no synthetic series.
 *
 * Convention (matches `priceYesOffline` in the SDK): YES price = noReserve / (yesReserve + noReserve),
 * and buying YES consumes noReserve while minting yesReserve.
 */
const USDC = 1_000_000;

/** Notional ladder: 500 → 250k USDC on a log scale. */
const LADDER = [500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000];

export function depthCurve(yesReserve: bigint, noReserve: bigint): Array<{ notional: number; price: number }> {
  const yes = Number(yesReserve) / USDC;
  const no = Number(noReserve) / USDC;
  if (!(yes > 0) || !(no > 0)) return [];
  const k = yes * no;
  return LADDER.map((notional) => {
    const nextNo = Math.max(no * 0.0005, no - notional);
    const nextYes = k / nextNo;
    const price = nextNo / (nextYes + nextNo);
    return { notional, price: Math.min(0.995, Math.max(0.005, price)) };
  });
}

export function priceYes(yesReserve: bigint, noReserve: bigint): number {
  const d = Number(yesReserve) + Number(noReserve);
  return d > 0 ? Number(noReserve) / d : 0.5;
}

export function DepthChart({
  yesReserve,
  noReserve,
  width = 420,
  height = 132,
  compact = false,
}: {
  yesReserve: bigint;
  noReserve: bigint;
  width?: number;
  height?: number;
  compact?: boolean;
}) {
  const t = useT();
  const curve = useMemo(() => depthCurve(yesReserve, noReserve), [yesReserve, noReserve]);
  const spot = useMemo(() => priceYes(yesReserve, noReserve), [yesReserve, noReserve]);

  if (curve.length === 0) return null;

  const padL = 6;
  const padR = 6;
  const padT = 10;
  const padB = compact ? 4 : 14;
  const w = width - padL - padR;
  const h = height - padT - padB;

  const x = (i: number) => padL + (i / (curve.length - 1)) * w;
  const y = (p: number) => padT + (1 - p) * h;

  const line = curve.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
  const area = `${line} L${x(curve.length - 1).toFixed(1)},${(padT + h).toFixed(1)} L${x(0).toFixed(1)},${(padT + h).toFixed(1)} Z`;
  const spotY = y(spot);
  const sweep = curve[6]; // 50k USDC reference print

  return (
    <div className="w-full" data-testid="depth-chart">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{t.terminal.depth.title}</span>
        <span className="mono text-[11px] text-brand">{`${(spot * 100).toFixed(1)}%`}</span>
        <span className="ml-auto mono text-[10px] text-slate-500">
          {format(t.terminal.depth.sweep, { amount: "50k" })} → {sweep ? `${(sweep.price * 100).toFixed(1)}%` : "—"}
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={t.terminal.depth.title}>
        <defs>
          <linearGradient id="depthFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="depthStroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={padL} x2={padL + w} y1={y(g)} y2={y(g)} stroke="rgba(255,255,255,0.06)" strokeDasharray="2 4" />
        ))}

        <path d={area} fill="url(#depthFill)" />
        <path d={line} fill="none" stroke="url(#depthStroke)" strokeWidth="1.6" strokeLinejoin="round" className="depth-line" />

        <line x1={padL} x2={padL + w} y1={spotY} y2={spotY} stroke="rgba(52,211,153,0.5)" strokeDasharray="3 3" />
        <circle cx={x(0)} cy={spotY} r="2.6" fill="#6ee7b7" className="live-ring" />

        {!compact &&
          curve.map((p, i) =>
            i % 3 === 0 ? (
              <text key={p.notional} x={x(i)} y={height - 2} textAnchor="middle" fontSize="7.5" fill="#475569">
                {p.notional >= 1000 ? `${p.notional / 1000}k` : p.notional}
              </text>
            ) : null,
          )}
      </svg>
    </div>
  );
}
