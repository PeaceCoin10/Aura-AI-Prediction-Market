import { useState } from "react";
import { haptic, isTelegram, marketDeepLink, shareToTelegram } from "../lib/telegram";

/**
 * Native Telegram share for one market: the deep link reopens the dApp inside
 * Telegram with `startapp=market_<id>`, so a recipient lands on the same book.
 */
export function TelegramShare({ marketId, question }: { marketId: string; question: string }) {
  const [copied, setCopied] = useState(false);
  const link = marketDeepLink(marketId);

  const onShare = () => {
    haptic("success");
    shareToTelegram(link, `${question}\n\nTrade it on Aura → #PredictionMarkets #Base #AI`);
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      haptic("tap");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5" data-testid="tg-share">
      <button
        onClick={onShare}
        className="rounded-lg border border-sky-400/30 bg-sky-400/10 px-2 py-1 text-[10.5px] font-medium text-sky-300 transition hover:bg-sky-400/20"
        title={isTelegram() ? "Share inside Telegram" : "Open the Telegram share sheet"}
      >
        Telegram
      </button>
      <button
        onClick={onCopy}
        className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[10.5px] text-slate-400 transition hover:text-slate-200"
        title={link}
      >
        {copied ? "Copied" : "Deep link"}
      </button>
    </div>
  );
}
