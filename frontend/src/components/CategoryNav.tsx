import { NAV, type NavKey } from "../lib/nav";
import { useT } from "../lib/i18n";

/**
 * Vertical navigation: Trending / Crypto / News / Sports / Esports / Tech.
 * Live counts, on-chain and featured markets counted together, sliding highlight.
 */
export function CategoryNav({
  value,
  onChange,
  counts,
}: {
  value: NavKey;
  onChange: (k: NavKey) => void;
  counts: Record<string, number>;
}) {
  const t = useT();
  return (
    <div className="relative" data-testid="category-nav">
      <div className="scrollbar-none flex items-center gap-1.5 overflow-x-auto pb-1">
        {NAV.map((item) => {
          const active = value === item.key;
          const n = counts[item.key] ?? 0;
          const label = t.shell.nav[item.key];
          const hint = t.shell.navHints[item.key];
          return (
            <button
              key={item.key}
              onClick={() => onChange(item.key)}
              title={hint}
              className={`group relative flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[13px] transition-all duration-200 ${
                active
                  ? "border-brand/50 bg-brand/15 text-brand shadow-glow"
                  : "border-white/8 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200"
              }`}
            >
              <span className={`text-[13px] ${active ? "animate-pulse-slow" : "opacity-70"}`}>{item.icon}</span>
              <span className="font-medium">{label}</span>
              <span
                className={`mono rounded-full px-1.5 text-[10px] ${
                  active ? "bg-brand/25 text-brand" : "bg-white/8 text-slate-500"
                }`}
              >
                {n}
              </span>
              {active && (
                <span className="absolute inset-x-2 -bottom-[1px] h-[2px] rounded-full bg-gradient-to-r from-transparent via-brand to-transparent" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
