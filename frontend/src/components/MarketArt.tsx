import { useState } from "react";
import { artUrl, photoUrl, VERTICAL_ACCENT } from "../lib/art";

/**
 * Market artwork: a real photograph for the market's vertical, with a bottom scrim so overlaid text
 * and chips stay legible. If the photo is missing or fails to decode, the deterministic per-market
 * SVG is used instead (never an empty box).
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
  const [src, setSrc] = useState(() => photoUrl(id, category) ?? artUrl(id));
  return (
    <div className={`relative overflow-hidden bg-white/[0.03] ${ratio} ${className}`}>
      <img
        src={src}
        alt={question}
        loading="lazy"
        decoding="async"
        data-photo={src.includes("/photos/") ? "1" : undefined}
        onError={() => setSrc((cur) => (cur === artUrl(id) ? cur : artUrl(id)))}
        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
      <div
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{ background: `radial-gradient(120% 80% at 15% 0%, rgba(${accent},0.18), transparent 60%)` }}
      />
      {children}
    </div>
  );
}
