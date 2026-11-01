import { useMemo, useState } from "react";
import { useComments } from "../hooks/useComments";
import type { Stance } from "../lib/comments";
import { format, useT } from "../lib/i18n";

const STANCE_STYLE: Record<Stance, { ring: string; chip: string; bar: string }> = {
  YES: { ring: "border-brand/40 text-brand hover:bg-brand/10", chip: "border-brand/30 bg-brand/10 text-brand", bar: "bg-brand" },
  NO: { ring: "border-danger/40 text-danger hover:bg-danger/10", chip: "border-danger/30 bg-danger/10 text-danger", bar: "bg-danger" },
  NEUTRAL: {
    ring: "border-white/15 text-slate-300 hover:bg-white/10",
    chip: "border-white/15 bg-white/5 text-slate-300",
    bar: "bg-slate-500",
  },
};

/**
 * Debate wall: everyone states a side, the crowd upvotes the arguments it rates, and the
 * YES/NO split is shown as a live tally. Takes are stored locally and ride the encrypted
 * cloud payload (union by id), so the same wall follows the wallet across devices.
 *
 * Integrity rules: one upvote per browser per take, the count is monotone across devices
 * (max wins on merge), and seeded prompts are official topics that cannot be deleted.
 */
export function DebateWall({
  marketId,
  seedIds = [],
  compact = false,
}: {
  marketId: string;
  seedIds?: string[];
  compact?: boolean;
}) {
  const t = useT();
  const { comments, tally, post, remove, like, liked } = useComments(marketId, seedIds);
  const [stance, setStance] = useState<Stance>("YES");
  const [author, setAuthor] = useState<string>(() => {
    try {
      return window.localStorage.getItem("predict.nickname") ?? "";
    } catch {
      return "";
    }
  });
  const [text, setText] = useState("");
  const [sort, setSort] = useState<"new" | "top">("new");
  const [flash, setFlash] = useState<"" | "posted" | "needText">("");

  const total = tally.yes + tally.no + tally.neutral;
  const yesPct = total === 0 ? 50 : Math.round((tally.yes / total) * 100);
  const noPct = 100 - yesPct;

  const ordered = useMemo(() => {
    const base = comments.slice();
    if (sort === "top") base.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0) || b.ts - a.ts);
    return base;
  }, [comments, sort]);

  const ago = (ts: number): string => {
    const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return format(t.social.comments.secondsAgo, { n: s });
    if (s < 3600) return format(t.social.comments.minutesAgo, { n: Math.floor(s / 60) });
    if (s < 86400) return format(t.social.comments.hoursAgo, { n: Math.floor(s / 3600) });
    return format(t.social.comments.daysAgo, { n: Math.floor(s / 86400) });
  };

  const stanceName = (key: Stance): string =>
    key === "YES" ? t.social.debate.stanceYes : key === "NO" ? t.social.debate.stanceNo : t.social.debate.stanceNeutral;

  const submit = () => {
    if (!text.trim()) {
      setFlash("needText");
      window.setTimeout(() => setFlash(""), 1400);
      return;
    }
    try {
      if (author.trim()) window.localStorage.setItem("predict.nickname", author.trim());
    } catch {
      /* private mode: the nickname simply does not persist */
    }
    post({ author, stance, text });
    setText("");
    setFlash("posted");
    window.setTimeout(() => setFlash(""), 1400);
  };

  return (
    <section
      data-testid="debate-wall"
      className={`rounded-xl border border-white/5 bg-white/[0.02] ${compact ? "p-3" : "p-4"}`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {format(t.social.debate.title, { count: comments.length })}
        </h3>
        <span className="chip text-[10px]">{t.social.debate.synced}</span>
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-white/10 p-0.5 text-[10.5px]">
          <button
            onClick={() => setSort("new")}
            aria-pressed={sort === "new"}
            className={`rounded px-1.5 py-0.5 transition ${sort === "new" ? "bg-white/10 text-slate-100" : "text-slate-500 hover:text-slate-300"}`}
          >
            {t.social.debate.sortNew}
          </button>
          <button
            onClick={() => setSort("top")}
            aria-pressed={sort === "top"}
            data-testid="debate-sort-top"
            className={`rounded px-1.5 py-0.5 transition ${sort === "top" ? "bg-white/10 text-slate-100" : "text-slate-500 hover:text-slate-300"}`}
          >
            {t.social.debate.sortTop}
          </button>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-slate-500">{t.social.debate.subtitle}</p>

      {/* stance split */}
      <div className="mt-2 space-y-1">
        <div className="flex h-1.5 overflow-hidden rounded-full bg-white/5">
          <span className={STANCE_STYLE.YES.bar} style={{ width: `${yesPct}%` }} />
          <span className={STANCE_STYLE.NO.bar} style={{ width: `${noPct}%` }} />
        </div>
        <div className="flex items-center justify-between text-[10.5px]">
          <span className="text-brand">{format(t.social.debate.yesShare, { pct: yesPct })}</span>
          <span className="text-slate-500">
            <span className="text-danger">{tally.no}</span> · {format(t.social.comments.neutralTally, { count: tally.neutral })}
          </span>
        </div>
      </div>

      {/* composer */}
      <div data-testid="debate-composer" className="mt-3 rounded-lg border border-white/10 bg-ink-950/40 p-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(Object.keys(STANCE_STYLE) as Stance[]).map((key) => (
            <button
              key={key}
              onClick={() => setStance(key)}
              aria-pressed={stance === key}
              className={`rounded-md border px-2 py-0.5 text-[10.5px] transition ${
                stance === key ? `${STANCE_STYLE[key].chip} font-medium` : `${STANCE_STYLE[key].ring} bg-transparent`
              }`}
            >
              {stanceName(key)}
            </button>
          ))}
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value.slice(0, 24))}
            placeholder={t.social.debate.author}
            aria-label={t.social.debate.author}
            className="ml-auto w-28 rounded-md border border-white/10 bg-transparent px-2 py-0.5 text-[10.5px] text-slate-200 placeholder:text-slate-600 focus:border-brand/40 focus:outline-none"
          />
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 500))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          rows={compact ? 2 : 3}
          placeholder={t.social.debate.placeholder}
          aria-label={t.social.debate.placeholder}
          className="mt-2 w-full resize-none rounded-md border border-white/10 bg-transparent px-2 py-1.5 text-[11.5px] leading-relaxed text-slate-200 placeholder:text-slate-600 focus:border-brand/40 focus:outline-none"
        />
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-[10px] text-slate-600">{text.length}/500</span>
          {flash === "posted" && <span className="text-[10px] text-brand">{t.social.debate.posted}</span>}
          {flash === "needText" && <span className="text-[10px] text-danger">{t.social.debate.needText}</span>}
          <button
            onClick={submit}
            data-testid="debate-post"
            disabled={!text.trim()}
            className="ml-auto rounded-md border border-brand/40 bg-brand/15 px-2.5 py-1 text-[10.5px] font-medium text-brand transition hover:bg-brand/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t.social.debate.post}
          </button>
        </div>
      </div>

      {/* takes */}
      <ul className="mt-2.5 space-y-1.5">
        {ordered.length === 0 && <li className="py-3 text-center text-[11px] text-slate-600">{t.social.debate.empty}</li>}
        {ordered.slice(0, compact ? 3 : 20).map((c) => (
          <li key={c.id} data-testid="debate-item" className="rounded-lg border border-white/5 bg-white/[0.02] px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <span className={`rounded border px-1 py-px text-[9.5px] ${STANCE_STYLE[c.stance].chip}`}>
                {c.stance === "YES" ? "YES" : c.stance === "NO" ? "NO" : "—"}
              </span>
              <span className="truncate text-[11px] font-medium text-slate-200">{c.author}</span>
              {c.seeded && <span className="chip text-[9px]">{t.social.comments.official}</span>}
              <span className="ml-auto shrink-0 text-[9.5px] text-slate-600">{ago(c.ts)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-slate-300">{c.text}</p>
            <div className="mt-1 flex items-center gap-2">
              <button
                onClick={() => like(c.id)}
                data-testid="debate-like"
                aria-pressed={liked.has(c.id)}
                title={t.social.debate.like}
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] transition ${
                  liked.has(c.id)
                    ? "border-brand/40 bg-brand/10 text-brand"
                    : "border-white/10 text-slate-500 hover:text-slate-300"
                }`}
              >
                ▲ {format(t.social.debate.likes, { count: c.likes ?? 0 })}
              </button>
              {!c.seeded && (
                <button
                  onClick={() => remove(c.id)}
                  className="text-[10px] text-slate-600 transition hover:text-danger"
                >
                  {t.social.comments.delete}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {sort === "top" && <p className="mt-1.5 text-[9.5px] text-slate-600">{t.social.debate.topHint}</p>}
    </section>
  );
}
