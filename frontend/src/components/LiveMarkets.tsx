import { demoPriceYes } from "../lib/demo";
import type { LiveMarket } from "../lib/liveCrypto";
import { photoUrl } from "../lib/art";
import { format, useI18n, useT } from "../lib/i18n";
import { usdc } from "../lib/format";
import { Countdown, ProbabilityBar } from "./ui";

/**
 * Live crypto strip: real spot quotes, derived strikes, fixed UTC close.
 *
 * The card is deliberately explicit about provenance ("CoinGecko spot · updated 12:04") and never
 * presents the venue's own liquidity as real — the paper panel behind `Trade` says so itself.
 */
export function liveTitle(m: LiveMarket, t: ReturnType<typeof useT>, intlTag: string): string {
  const close = new Date(m.resolutionAt * 1000).toLocaleDateString(intlTag, { month: "short", day: "numeric" });
  return format(t.live.question, {
    asset: m.asset,
    price: `$${m.strike.toLocaleString(intlTag, { maximumFractionDigits: 2 })}`,
    date: close,
  });
}

export function LiveMarkets({
  markets,
  updatedAt,
  onOpen,
}: {
  markets: LiveMarket[];
  updatedAt: number;
  onOpen: (m: LiveMarket) => void;
}) {
  const t = useT();
  const { locale } = useI18n();
  if (markets.length === 0) return null;

  const intlTag = locale === "en" ? "en-US" : locale;
  const stamp = new Date(updatedAt).toLocaleTimeString(intlTag, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const close = new Date(markets[0].resolutionAt * 1000).toLocaleDateString(intlTag, {
    month: "short",
    day: "numeric",
  });

  return (
    <section data-testid="live-markets" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand">
          <span className="live-ring h-1.5 w-1.5 rounded-full bg-brand" />
          {t.live.badge}
        </span>
        <span className="text-[12px] font-medium text-slate-200">{t.live.title}</span>
        <span className="text-[10.5px] text-slate-500">{t.live.subtitle}</span>
        <span className="ml-auto mono text-[10px] text-slate-600">{format(t.live.updated, { time: stamp })}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {markets.map((m) => {
          const prob = Number(demoPriceYes(m)) / 1e18;
          const dist = (m.strike / m.spot - 1) * 100;
          const up = m.change24h >= 0;
          return (
            <button
              key={m.id}
              onClick={() => onOpen(m)}
              data-testid="live-card"
              className="flow-border card card-hover group relative flex items-stretch gap-0 overflow-hidden p-0 text-left"
            >
              <div className="relative hidden w-24 shrink-0 sm:block">
                <img
                  src={photoUrl(m.id, "crypto") ?? `${import.meta.env.BASE_URL}art/banner-crypto.svg`}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-transparent to-[#0a0c12]" />
              </div>
              <div className="min-w-0 flex-1 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="mono text-[11px] text-slate-400">{m.asset}/USD</span>
                  <span className={`mono text-[10.5px] ${up ? "text-brand" : "text-danger"}`}>
                    {up ? "+" : ""}
                    {m.change24h.toFixed(2)}%
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[12.5px] font-medium leading-snug text-slate-100">
                  {liveTitle(m, t, intlTag)}
                </p>
                <div className="mt-2 flex items-end justify-between">
                  <div>
                    <div className="text-[9.5px] uppercase tracking-wide text-slate-500">{t.live.spot.replace("{{price}}", "")}</div>
                    <div className="mono text-[13px] text-slate-200">${m.spot.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                  </div>
                  <div className="text-right">
                    <div className="mono text-lg font-semibold text-brand">{(prob * 100).toFixed(1)}%</div>
                    <div className="mono text-[9.5px] text-slate-500">
                      {format(t.live.distance, { pct: dist >= 0 ? `+${dist.toFixed(2)}` : dist.toFixed(2) })}
                    </div>
                  </div>
                </div>
                <ProbabilityBar prob={prob} />
                <div className="mt-1.5 flex items-center justify-between text-[9.5px] text-slate-500">
                  <span>
                    <Countdown target={m.resolutionAt} prefix="" doneText="—" />
                  </span>
                  <span className="mono">{usdc(m.yesReserve + m.noReserve, 0)} USDC</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="text-[9.5px] text-slate-600">{t.live.source}</div>
    </section>
  );
}
