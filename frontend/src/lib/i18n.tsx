import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en, type Messages } from "../locales/en";
import { zh } from "../locales/zh";
import { ja } from "../locales/ja";
import { ko } from "../locales/ko";
import { de } from "../locales/de";

/**
 * Lightweight i18n runtime.
 *
 * Why this shape:
 *   - `en` is a **typed message tree** (namespaces per surface), not flat string keys.
 *     A missing translation is a compile error instead of a runtime `undefined`.
 *   - Locales are registered at module scope, so adding a language is one file + one call:
 *
 *       // src/locales/it/index.ts  (must satisfy `Messages`)
 *       import { it } from "./it";
 *       registerLocale({ code: "it", label: "IT", native: "Italiano", htmlLang: "it", messages: it });
 *
 *   - Components read strings with `const t = useT()` → `t.hall.heroTitle`.
 *     No provider needed for libs: they import `en` directly.
 *   - `{{var}}` interpolation is supported via `format(tpl, { ... })`.
 *   - The active locale is persisted to localStorage under `aura.locale` and mirrored onto
 *     `<html lang>` so screen readers, hyphenation and font fallback follow the switch.
 */
export interface LocaleBundle {
  code: string;
  /** Two-letter chip label, always Latin so the switcher stays legible at 10px. */
  label: string;
  /** Endonym shown in the dropdown ("简体中文", "日本語", …). */
  native: string;
  htmlLang: string;
  messages: Messages;
}

export type LocaleDescriptor = Pick<LocaleBundle, "code" | "label" | "native" | "htmlLang">;

const REGISTRY: Record<string, LocaleBundle> = {
  en: { code: "en", label: "EN", native: "English", htmlLang: "en", messages: en },
  zh: { code: "zh", label: "ZH", native: "简体中文", htmlLang: "zh-CN", messages: zh },
  ja: { code: "ja", label: "JA", native: "日本語", htmlLang: "ja-JP", messages: ja },
  ko: { code: "ko", label: "KO", native: "한국어", htmlLang: "ko-KR", messages: ko },
  de: { code: "de", label: "DE", native: "Deutsch", htmlLang: "de-DE", messages: de },
};

/** Registration order is the dropdown order; English is always first. */
const ORDER = ["en", "zh", "ja", "ko", "de"];

export function registerLocale(bundle: LocaleBundle): void {
  REGISTRY[bundle.code] = bundle;
  if (!ORDER.includes(bundle.code)) ORDER.push(bundle.code);
}

export function listLocales(): LocaleDescriptor[] {
  return ORDER.filter((code) => REGISTRY[code]).map((code) => {
    const { label, native, htmlLang } = REGISTRY[code];
    return { code, label, native, htmlLang };
  });
}

export function isSupported(code: string | null | undefined): boolean {
  return !!code && !!REGISTRY[code];
}

export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(vars[k] ?? ""));
}

const STORAGE_KEY = "aura.locale";

/** `?lang=ja` wins, then the saved preference, then the browser's own languages, then English. */
function resolveInitialLocale(): string {
  try {
    const fromQuery = new URLSearchParams(window.location.search).get("lang");
    if (isSupported(fromQuery)) return fromQuery as string;
  } catch {
    /* no window (SSR/prerender) */
  }
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isSupported(saved)) return saved as string;
  } catch {
    /* storage disabled */
  }
  const candidates = typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : [];
  for (const tag of candidates) {
    const base = (tag || "").toLowerCase().split("-")[0];
    if (isSupported(base)) return base;
  }
  return "en";
}

interface I18nApi {
  locale: string;
  t: Messages;
  setLocale: (code: string) => void;
  locales: LocaleDescriptor[];
}

const Ctx = createContext<I18nApi | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<string>(resolveInitialLocale);

  const setLocale = useCallback((code: string) => {
    if (!REGISTRY[code]) return;
    setLocaleState((prev) => {
      if (prev === code) return prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, code);
      } catch {
        /* storage disabled — the switch still applies for this session */
      }
      // Fire-and-forget: the cloud-sync layer mirrors the preference when a wallet is bound.
      try {
        window.dispatchEvent(new CustomEvent("aura:locale", { detail: { code } }));
      } catch {
        /* ignore */
      }
      return code;
    });
  }, []);

  const bundle = REGISTRY[locale] ?? REGISTRY.en;

  useEffect(() => {
    document.documentElement.lang = bundle.htmlLang;
  }, [bundle.htmlLang]);

  const value = useMemo<I18nApi>(
    () => ({ locale: bundle.code, t: bundle.messages, setLocale, locales: listLocales() }),
    [bundle, setLocale],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}

/** Shorthand for the common case: only the message tree. */
export function useT(): Messages {
  return useI18n().t;
}
