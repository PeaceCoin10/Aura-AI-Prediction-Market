import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en, type Messages } from "../locales/en";

/**
 * Lightweight i18n runtime.
 *
 * Why this shape:
 *   - `en` is a **typed message tree** (namespaces per surface), not flat string keys.
 *     A missing translation is a compile error instead of a runtime `undefined`.
 *   - Locales are registered at module scope, so adding a language is one file + one call:
 *
 *       // src/locales/ja/index.ts  (must satisfy `Messages`)
 *       import { ja } from "./ja";
 *       registerLocale({ code: "ja", label: "JP", htmlLang: "ja", messages: ja });
 *
 *   - Components read strings with `const t = useT()` → `t.hall.heroTitle`.
 *     No provider needed for libs: they import `en` directly.
 *   - `{{var}}` interpolation is supported via `format(tpl, { ... })`.
 */
export interface LocaleBundle {
  code: string;
  label: string;
  htmlLang: string;
  messages: Messages;
}

const REGISTRY: Record<string, LocaleBundle> = {
  en: { code: "en", label: "EN", htmlLang: "en", messages: en },
};

export function registerLocale(bundle: LocaleBundle): void {
  REGISTRY[bundle.code] = bundle;
}

export function listLocales(): Array<Pick<LocaleBundle, "code" | "label" | "htmlLang">> {
  return Object.values(REGISTRY).map(({ code, label, htmlLang }) => ({ code, label, htmlLang }));
}

export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(vars[k] ?? ""));
}

const STORAGE_KEY = "aura.locale";

interface I18nApi {
  locale: string;
  t: Messages;
  setLocale: (code: string) => void;
  locales: Array<Pick<LocaleBundle, "code" | "label" | "htmlLang">>;
}

const Ctx = createContext<I18nApi | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<string>(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      return saved && REGISTRY[saved] ? saved : "en";
    } catch {
      return "en";
    }
  });

  const setLocale = useCallback((code: string) => {
    if (!REGISTRY[code]) return;
    setLocaleState(code);
    try {
      window.localStorage.setItem(STORAGE_KEY, code);
    } catch {
      /* storage disabled — locale still applies for this session */
    }
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
