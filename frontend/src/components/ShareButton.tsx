import { useState } from "react";
import type { PosterInput } from "../lib/share";
import { play } from "../lib/sound";
import { Spinner } from "./ui";
import { format, useT } from "../lib/i18n";

/** One-click share card for X (used by market cards and position cards). */
export function ShareButton({
  input,
  label,
  compact = false,
  className = "",
}: {
  input: PosterInput;
  label?: string;
  compact?: boolean;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ dataUrl: string; shareUrl: string; tweet: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setErr(null);
    play("click");
    try {
      // Poster engine (QR encoder included) loads on demand so it never blocks first paint.
      const { renderPoster } = await import("../lib/share");
      const r = await renderPoster(input);
      setResult(r);
      setOpen(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          void generate();
        }}
        className={
          className ||
          `btn-ghost ${compact ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-[12px]"}`
        }
        disabled={busy}
        title={t.social.share.tooltip}
      >
        {busy ? <Spinner /> : <span>↗</span>}
        {!compact && <span>{busy ? t.social.share.generating : (label ?? t.social.share.label)}</span>}
      </button>

      {open && result && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="glass-panel w-full max-w-3xl rounded-3xl p-4 animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-100">{t.social.share.heading}</h3>
              <span className="chip text-[10px]">{t.social.share.geometry}</span>
              <button className="btn-ghost ml-auto px-3 py-1.5 text-xs" onClick={() => setOpen(false)}>
                {t.social.share.close}
              </button>
            </div>
            <img src={result.dataUrl} alt={t.social.share.alt} className="w-full rounded-2xl border border-white/10" />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                className="btn-primary px-3 py-1.5 text-[12px]"
                onClick={async () => {
                  const { downloadDataUrl } = await import("../lib/share");
                  downloadDataUrl(result.dataUrl, `aura-poster-${Date.now()}.png`);
                  play("success");
                }}
              >
                {t.social.share.download}
              </button>
              <button
                className="btn-ghost px-3 py-1.5 text-[12px]"
                onClick={async () => {
                  const { openTweet } = await import("../lib/share");
                  openTweet(result.tweet, result.shareUrl);
                  play("click");
                }}
              >
                {t.social.share.postOnX}
              </button>
              <button
                className="btn-ghost px-3 py-1.5 text-[12px]"
                onClick={() => {
                  void navigator.clipboard?.writeText(`${result.tweet} ${result.shareUrl}`);
                  play("click");
                }}
              >
                {t.social.share.copyText}
              </button>
              <span className="ml-auto text-[10.5px] text-slate-600">{result.shareUrl}</span>
            </div>
          </div>
        </div>
      )}

      {err && <span className="ml-2 text-[10.5px] text-danger">{format(t.social.share.failed, { err })}</span>}
    </>
  );
}
