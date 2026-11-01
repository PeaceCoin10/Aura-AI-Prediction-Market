import { SOCIAL } from "../lib/social";
import { useT } from "../lib/i18n";

const ITEMS = [
  { key: "x" as const, label: "X", cls: "border-white/12 text-slate-300 hover:border-white/30 hover:text-white" },
  { key: "telegram" as const, label: "Telegram", cls: "border-sky-400/25 text-sky-300 hover:border-sky-400/50 hover:bg-sky-400/10" },
  { key: "github" as const, label: "GitHub", cls: "border-white/12 text-slate-300 hover:border-white/30 hover:text-white" },
];

/**
 * Persistent shortcuts to the official channels: header (compact) and footer (full).
 * External links open in a new tab with noreferrer; the labels are brand names, so they are not
 * translated — only the accessible names are.
 */
export function SocialLinks({ variant = "full" }: { variant?: "compact" | "full" }) {
  const t = useT();
  const compact = variant === "compact";
  return (
    <nav aria-label={t.shell.socials.title} data-testid={`socials-${variant}`} className="flex items-center gap-1.5">
      {ITEMS.map((item) => (
        <a
          key={item.key}
          href={SOCIAL[item.key]}
          target="_blank"
          rel="noreferrer noopener"
          data-testid={`social-${item.key}`}
          aria-label={`${t.shell.socials[item.key]} · ${item.label}`}
          title={`${t.shell.socials[item.key]} · ${item.label}`}
          className={`inline-flex items-center gap-1 rounded-lg border bg-white/[0.02] transition ${item.cls} ${
            compact ? "h-8 px-2 text-[10.5px]" : "h-8 px-2.5 text-[11px]"
          }`}
        >
          <span className="mono">{item.label}</span>
          {!compact && <span aria-hidden className="text-[9px] opacity-50">↗</span>}
        </a>
      ))}
    </nav>
  );
}
