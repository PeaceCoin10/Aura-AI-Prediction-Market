import { useT } from "../lib/i18n";

/**
 * Aura brand mark — the single source of truth for the logo.
 *
 * Design semantics: oracle eye (outer eye shape) + on-chain matrix (hex shield with grid ticks)
 * + agentic runtime (three-node circuit inside the iris).
 * The same vector is reused in three places:
 *   1) <LogoMark/>           header / loading / footer
 *   2) FAVICON_SVG           browser tab (inlined as a data URI in index.html)
 *   3) logoSvgDataUri()      share card (Canvas drawImage of an offscreen SVG)
 */

export const BRAND = {
  name: "Aura",
  /** Localized display name kept for callers that want the longer form. */
  nameZh: "Aura Oracle",
  tagline: "Agentic DeFi Prediction Market",
  site: "https://aura.hermes.markets",
} as const;

/** Path geometry of the mark (viewBox 0 0 64 64), shared by the component and Canvas. */
export const LOGO_PATHS = {
  shield:
    "M32 3.5 55.5 16.2v21.4c0 9.9-9.4 17.9-23.5 22.9C17.9 55.5 8.5 47.5 8.5 37.6V16.2L32 3.5Z",
  eye: "M14.5 32.4c4.6-7.6 10.9-11.4 17.5-11.4s12.9 3.8 17.5 11.4c-4.6 7.6-10.9 11.4-17.5 11.4S19.1 40 14.5 32.4Z",
  irisInner: "M32 25.6a6.8 6.8 0 1 1 0 13.6 6.8 6.8 0 0 1 0-13.6Z",
} as const;

export function LogoMark({
  size = 36,
  animated = true,
  className = "",
}: {
  size?: number;
  animated?: boolean;
  className?: string;
}) {
  const id = "aura-grad";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="Aura AI prediction market logo"
      className={className}
    >
      <defs>
        <linearGradient id={id} x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6ee7b7" />
          <stop offset="46%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
        <radialGradient id={`${id}-iris`} cx="0.5" cy="0.45" r="0.6">
          <stop offset="0%" stopColor="#a7f3d0" stopOpacity="0.95" />
          <stop offset="60%" stopColor="#34d399" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#0f172a" stopOpacity="0.1" />
        </radialGradient>
        <linearGradient id={`${id}-violet`} x1="18" y1="46" x2="46" y2="18">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.2" />
        </linearGradient>
      </defs>

      {/* Hex shield: on-chain matrix */}
      <path
        d={LOGO_PATHS.shield}
        fill="rgba(52,211,153,0.07)"
        stroke={`url(#${id})`}
        strokeWidth="2.1"
        strokeLinejoin="round"
      />
      {/* Interior tick grid (matrix feel) */}
      <g stroke={`url(#${id}-violet)`} strokeWidth="0.9" opacity="0.5">
        <path d="M20 22.5h24M20 42.5h24" />
        <path d="M26 18v28M38 18v28" strokeDasharray="2 3" />
      </g>

      {/* Eye outline: the oracle eye */}
      <path d={LOGO_PATHS.eye} fill="rgba(6,8,13,0.55)" stroke={`url(#${id})`} strokeWidth="1.9" />

      {/* Iris + agentic nodes */}
      <circle cx="32" cy="32.4" r="7.6" fill={`url(#${id}-iris)`} stroke="#a7f3d0" strokeWidth="0.9" />
      <circle cx="32" cy="32.4" r="2.5" fill="#0b1220" />
      <g stroke="#a7f3d0" strokeWidth="0.85" opacity="0.9">
        <path d="M32 24.8v-3.2M32 40v3.2M24.4 32.4h-3.2M39.6 32.4h3.2" strokeLinecap="round" />
      </g>
      <g fill="#6ee7b7">
        <circle cx="32" cy="20.4" r="1.5" />
        <circle cx="32" cy="44.4" r="1.5" />
        <circle cx="19.8" cy="32.4" r="1.5" />
        <circle cx="44.2" cy="32.4" r="1.5" />
      </g>

      {/* Orbit ring: the running agent */}
      {animated && (
        <circle
          cx="32"
          cy="32"
          r="27"
          stroke={`url(#${id})`}
          strokeWidth="0.9"
          strokeDasharray="3 7"
          opacity="0.55"
          style={{ transformOrigin: "32px 32px", animation: "borderSpin 18s linear infinite" }}
        />
      )}
    </svg>
  );
}

/** Full lockup (mark + wordmark), used in the header. */
export function LogoLockup({ size = 34, compact = false }: { size?: number; compact?: boolean }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="flex items-center justify-center rounded-2xl border border-brand/25 bg-brand/[0.08] p-1 shadow-[0_0_30px_-12px_rgba(52,211,153,0.9)]"
        style={{ width: size + 10, height: size + 10 }}
      >
        <LogoMark size={size} />
      </div>
      {!compact && (
        <div className="leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="bg-gradient-to-r from-brand-glow via-brand to-cyan-300 bg-clip-text text-[15px] font-semibold tracking-tight text-transparent">
              Aura
            </span>
            <span className="rounded border border-white/10 bg-white/5 px-1 py-px text-[9px] uppercase tracking-wider text-slate-400">
              Agentic
            </span>
          </div>
          <div className="text-[10.5px] text-slate-500">{t.ui.wordmark.subtitle}</div>
        </div>
      )}
    </div>
  );
}

/** Browser favicon: inline SVG, no extra network request. */
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
<stop offset="0%" stop-color="#6ee7b7"/><stop offset="46%" stop-color="#34d399"/><stop offset="100%" stop-color="#22d3ee"/>
</linearGradient></defs>
<rect width="64" height="64" rx="14" fill="#07080c"/>
<path d="M32 8 51 18.6v17.1c0 7.9-7.5 14.3-19 18.3-11.5-4-19-10.4-19-18.3V18.6L32 8Z" fill="rgba(52,211,153,0.10)" stroke="url(#g)" stroke-width="2.4" stroke-linejoin="round"/>
<path d="M17.5 32.4c4-6.5 9.4-9.8 14.5-9.8s10.5 3.3 14.5 9.8c-4 6.5-9.4 9.8-14.5 9.8s-10.5-3.3-14.5-9.8Z" fill="#06080d" stroke="url(#g)" stroke-width="2"/>
<circle cx="32" cy="32.4" r="5.2" fill="#34d399" opacity="0.9"/>
<circle cx="32" cy="32.4" r="1.9" fill="#06080d"/>
</svg>`;

/** Share card: returns an SVG data URI that can be drawn with drawImage. */
export function logoSvgDataUri(size = 256): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
<stop offset="0%" stop-color="#6ee7b7"/><stop offset="46%" stop-color="#34d399"/><stop offset="100%" stop-color="#22d3ee"/>
</linearGradient></defs>
<path d="M32 3.5 55.5 16.2v21.4c0 9.9-9.4 17.9-23.5 22.9C17.9 55.5 8.5 47.5 8.5 37.6V16.2L32 3.5Z" fill="rgba(52,211,153,0.08)" stroke="url(#g)" stroke-width="2.1" stroke-linejoin="round"/>
<path d="M14.5 32.4c4.6-7.6 10.9-11.4 17.5-11.4s12.9 3.8 17.5 11.4c-4.6 7.6-10.9 11.4-17.5 11.4S19.1 40 14.5 32.4Z" fill="#06080d" stroke="url(#g)" stroke-width="1.9"/>
<circle cx="32" cy="32.4" r="7.6" fill="url(#g)" opacity="0.85"/>
<circle cx="32" cy="32.4" r="2.6" fill="#06080d"/>
<g fill="#6ee7b7"><circle cx="32" cy="20.4" r="1.6"/><circle cx="32" cy="44.4" r="1.6"/><circle cx="19.8" cy="32.4" r="1.6"/><circle cx="44.2" cy="32.4" r="1.6"/></g>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** First-paint loader: shimmer placeholder in the brand shape. */
export function LogoLoader({ label }: { label?: string }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20">
      <div className="relative">
        <div className="absolute inset-0 animate-ping rounded-full bg-brand/10" />
        <LogoMark size={64} />
      </div>
      <div className="text-xs tracking-wide text-slate-500">{label ?? t.ui.loader.connecting}</div>
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand/70"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
