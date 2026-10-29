import { useState } from "react";
import type { DecodedEvent } from "@sdk";
import { EXPLORER } from "../lib/config";
import type { FeedItem } from "../hooks/useEventFeed";
import { describeEvent } from "../hooks/useEventFeed";
import { eventLabel } from "../lib/events";
import { shortTime } from "../lib/format";
import { Empty } from "./ui";
import { format, useT } from "../lib/i18n";

function argsToRows(ev: DecodedEvent) {
  return Object.entries(ev.args).map(([k, v]) => ({
    k,
    v: typeof v === "bigint" ? v.toString() : String(v),
  }));
}

export function ActivityView({ items, error }: { items: FeedItem[]; error?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const t = useT();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-medium text-slate-300">{t.portfolio.activity.title}</h2>
        <span className="text-[11px] text-slate-500">{t.portfolio.activity.subtitle}</span>
      </div>

      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger">
          {format(t.portfolio.activity.error, { error })}
        </div>
      )}

      {items.length === 0 ? (
        <Empty title={t.portfolio.activity.emptyTitle} hint={t.portfolio.activity.emptyHint} />
      ) : (
        <div className="space-y-2">
          {items.map((it) => {
            const d = describeEvent(it.event);
            const isOpen = open === it.key;
            return (
              <div key={it.key} className="card overflow-hidden">
                <button
                  className="flex w-full items-start gap-3 p-3 text-left hover:bg-white/[0.02]"
                  onClick={() => setOpen(isOpen ? null : it.key)}
                >
                  <span
                    className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                      d.kind === "trade"
                        ? "bg-amber-400"
                        : d.kind === "ok"
                          ? "bg-brand"
                          : "bg-sky-400"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm text-slate-100">{d.title}</span>
                      <span className="mono shrink-0 text-[11px] text-slate-500">
                        {it.blockNumber ? `#${it.blockNumber}` : shortTime(Math.floor(it.at / 1000))}
                      </span>
                    </div>
                    {d.body && <div className="mt-0.5 text-xs text-slate-400">{d.body}</div>}
                  </div>
                  <span className="chip shrink-0">{eventLabel(it.event.name)}</span>
                </button>

                {isOpen && (
                  <div className="border-t border-white/5 bg-ink-950/40 px-3 py-2">
                    <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">
                      {t.portfolio.activity.decodeTitle}
                    </div>
                    <table className="w-full text-[11px]">
                      <tbody>
                        {argsToRows(it.event).map((r) => (
                          <tr key={r.k} className="align-top">
                            <td className="mono w-40 py-0.5 text-slate-500">{r.k}</td>
                            <td className="mono break-all py-0.5 text-slate-300">{r.v}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {it.event.transactionHash && (
                      <a
                        href={`${EXPLORER}/tx/${it.event.transactionHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block text-[11px] text-brand hover:underline"
                      >
                        {t.portfolio.activity.txLink}
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
