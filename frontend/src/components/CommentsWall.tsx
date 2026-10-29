import { useState } from "react";
import { useComments } from "../hooks/useComments";
import type { Stance } from "../lib/comments";
import { format, useT } from "../lib/i18n";

const STANCES: Array<{ key: Stance; cls: string; on: string }> = [
  { key: "YES", cls: "border-brand/30 text-brand/80 hover:bg-brand/10", on: "border-brand bg-brand text-ink-950" },
  { key: "NO", cls: "border-danger/30 text-danger/80 hover:bg-danger/10", on: "border-danger bg-danger text-ink-950" },
  { key: "NEUTRAL", cls: "border-white/15 text-slate-400 hover:bg-white/10", on: "border-slate-300 bg-slate-200 text-ink-950" },
];

/**
 * Debate wall: post a take and see the YES/NO stance split.
 * Data lives in browser localStorage (labelled honestly in the UI): it survives reloads,
 * does not sync across devices.
 */
export function CommentsWall({
  marketId,
  seedIds = [],
  compact = false,
}: {
  marketId: string;
  seedIds?: string[];
  compact?: boolean;
}) {
  const t = useT();
  const { comments, tally, post, remove } = useComments(marketId, seedIds);
  const [stance, setStance] = useState<Stance>("YES");
  const [author, setAuthor] = useState<string>(() => {
    try {
      return window.localStorage.getItem("predict.nickname") ?? "";
    } catch {
      return "";
    }
  });
  const [text, setText] = useState("");
  const [flash, setFlash] = useState(false);

  const total = tally.yes + tally.no + tally.neutral;
  const yesPct = total === 0 ? 50 : Math.round((tally.yes / total) * 100);

  const ago = (ts: number): string => {
    const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return format(t.social.comments.secondsAgo, { n: s });
    if (s < 3600) return format(t.social.comments.minutesAgo, { n: Math.floor(s / 60) });
    if (s < 86400) return format(t.social.comments.hoursAgo, { n: Math.floor(s / 3600) });
    return format(t.social.comments.daysAgo, { n: Math.floor(s / 86400) });
  };

  const stanceLabel = (key: Stance): string =>
    key === "YES"
      ? t.social.comments.yesWins
      : key === "NO"
        ? t.social.comments.noWins
        : t.social.comments.neutral;

  const submit = () => {
    if (!text.trim()) return;
    try {
      if (author.trim()) window.localStorage.setItem("predict.nickname", author.trim());
    } catch {
      /* ignore */
    }
    post({ author, stance, text });
    setText("");
    setFlash(true);
    window.setTimeout(() => setFlash(false), 900);
  };

  return (
    <section className={`rounded-xl border border-white/5 bg-white/[0.02] ${compact ? "p-3" : "p-4"}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {format(t.social.comments.title, { count: comments.length })}
        </h3>
        <span className="chip text-[10px]">{t.social.comments.localOnly}</span>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">
          <span className="text-brand">YES {tally.yes}</span>
          <span className="text-danger">NO {tally.no}</span>
          <span>{format(t.social.comments.neutralTally, { count: tally.neutral })}</span>
        </div>
      </div>

      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div className="h-full bg-gradient-to-r from-brand to-danger transition-all duration-500" style={{ width: `${yesPct}%` }} />
      </div>

      <div className="mb-3 space-y-2 rounded-xl border border-white/5 bg-ink-950/60 p-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {STANCES.map((s) => (
            <button
              key={s.key}
              onClick={() => setStance(s.key)}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${stance === s.key ? s.on : s.cls}`}
            >
              {stanceLabel(s.key)}
            </button>
          ))}
          <input
            className="input ml-auto w-32 py-1 text-[11px]"
            placeholder={t.social.comments.nickname}
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            maxLength={24}
          />
        </div>
        <textarea
          className="input min-h-[62px] resize-y text-[13px]"
          placeholder={t.social.comments.placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-600">{format(t.social.comments.counter, { count: text.length })}</span>
          <button
            className={`btn-primary px-3 py-1.5 text-[12px] ${flash ? "ring-2 ring-brand/60" : ""}`}
            onClick={submit}
            disabled={!text.trim()}
          >
            {t.social.comments.submit}
          </button>
        </div>
      </div>

      <ul className="space-y-2">
        {comments.length === 0 && (
          <li className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-[11px] text-slate-600">
            {t.social.comments.empty}
          </li>
        )}
        {comments.map((c) => (
          <li key={c.id} className="group rounded-lg border border-white/5 bg-ink-900/60 p-2.5">
            <div className="mb-1 flex items-center gap-2 text-[11px]">
              <span
                className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                  c.stance === "YES" ? "bg-brand/20 text-brand" : c.stance === "NO" ? "bg-danger/20 text-danger" : "bg-white/10 text-slate-300"
                }`}
              >
                {c.author.slice(0, 1).toUpperCase()}
              </span>
              <span className="font-medium text-slate-300">{c.author}</span>
              <span
                className={`rounded px-1.5 text-[10px] ${
                  c.stance === "YES" ? "bg-brand/15 text-brand" : c.stance === "NO" ? "bg-danger/15 text-danger" : "bg-white/10 text-slate-400"
                }`}
              >
                {c.stance === "NEUTRAL" ? t.social.comments.neutral : format(t.social.comments.stanceWins, { side: c.stance })}
              </span>
              {c.seeded && <span className="text-[10px] text-slate-600">{t.social.comments.official}</span>}
              <span className="ml-auto text-[10px] text-slate-600">{ago(c.ts)}</span>
              {!c.seeded && (
                <button
                  className="hidden text-[10px] text-slate-600 hover:text-danger group-hover:inline"
                  onClick={() => remove(c.id)}
                >
                  {t.social.comments.delete}
                </button>
              )}
            </div>
            <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-slate-300">{c.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
