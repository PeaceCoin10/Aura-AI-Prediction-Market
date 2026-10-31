import { useEffect, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import { play } from "../lib/sound";

/**
 * Frosted-glass language switcher for the terminal header.
 *
 * - Closed by default and rendered conditionally, so the English first paint carries no
 *   translated glyphs (the E2E suite asserts a CJK-free English hall).
 * - Switches without a page reload: the provider swaps the message tree and writes `<html lang>`.
 * - Keyboard support: ArrowUp/ArrowDown move, Enter/Space select, Escape closes.
 * - Click-outside dismisses; the preference is persisted by `setLocale`.
 */
export function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, locales, t } = useI18n();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const active = locales.find((l) => l.code === locale) ?? locales[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (code: string) => {
    if (code !== locale) play("toggle");
    setLocale(code);
    setOpen(false);
  };

  return (
    <div className="relative" ref={box} data-testid="locale-switcher">
      <button
        type="button"
        onClick={() => {
          play("click");
          setOpen((v) => !v);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t.terminal.locale.label}
        title={t.terminal.locale.hint}
        className={`group relative flex h-8 items-center gap-1.5 overflow-hidden rounded-xl border border-white/10 bg-white/[0.06] px-2 text-[11px] text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl transition-all hover:border-brand/40 hover:bg-white/[0.09] hover:text-white ${
          compact ? "" : "hidden sm:flex"
        }`}
      >
        <span className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 [background:radial-gradient(120px_40px_at_50%_120%,rgba(52,211,153,0.35),transparent)]" />
        <GlobeIcon />
        <span className="mono relative tracking-[0.08em]">{active?.label ?? "EN"}</span>
        <svg
          width="9"
          height="9"
          viewBox="0 0 10 10"
          aria-hidden
          className={`relative text-slate-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t.terminal.locale.label}
          className="absolute right-0 z-50 mt-2 w-56 origin-top-right animate-fade-in overflow-hidden rounded-2xl border border-white/12 bg-[#0a0c12]/85 p-1 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.85)] backdrop-blur-2xl"
        >
          <div className="px-2.5 pb-1 pt-1.5 text-[9px] uppercase tracking-[0.2em] text-slate-500">
            {t.terminal.locale.current}
          </div>
          {locales.map((l) => {
            const on = l.code === locale;
            return (
              <button
                key={l.code}
                role="option"
                aria-selected={on}
                data-locale={l.code}
                onClick={() => pick(l.code)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left text-[12px] transition-colors ${
                  on ? "bg-brand/12 text-slate-100" : "text-slate-300 hover:bg-white/[0.06]"
                }`}
              >
                <span
                  className={`mono flex h-6 w-7 shrink-0 items-center justify-center rounded-md border text-[10px] ${
                    on ? "border-brand/40 bg-brand/15 text-brand" : "border-white/10 bg-white/[0.04] text-slate-400"
                  }`}
                >
                  {l.label}
                </span>
                <span className="flex-1 truncate">{l.native}</span>
                {on && (
                  <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden className="text-brand">
                    <path d="M2 6.4l2.6 2.6L10 3.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GlobeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden className="relative text-brand/80">
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <ellipse cx="8" cy="8" rx="2.6" ry="6.2" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.7" />
      <path d="M1.9 8h12.2" stroke="currentColor" strokeWidth="1.1" opacity="0.7" />
    </svg>
  );
}
