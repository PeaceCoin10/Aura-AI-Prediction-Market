import { artUrl, VERTICAL_ACCENT } from "../lib/art";

/**
 * Market artwork: a generated vector scene per market, with a bottom scrim so overlaid text and
 * chips stay legible on any palette.
 */
export function MarketArt({
  id,
  question,
  category,
  className = "",
  ratio = "aspect-[16/9]",
  children,
}: {
  id: string;
  question: string;
  category: string;
  className?: string;
  ratio?: string;
  children?: React.ReactNode;
}) {
  const accent = VERTICAL_ACCENT[category] ?? "110,231,183";
  return (
    <div className={`relative overflow-hidden ${ratio} ${className}`}>
      <img
        src={artUrl(id)}
        alt={question}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{ background: `radial-gradient(120% 80% at 15% 0%, rgba(${accent},0.18), transparent 60%)` }}
      />
      {children}
    </div>
  );
}
