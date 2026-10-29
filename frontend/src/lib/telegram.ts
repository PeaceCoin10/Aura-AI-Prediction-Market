/**
 * Telegram Mini App runtime.
 *
 * The dApp runs unchanged in a normal browser; inside a Telegram WebView this module pulls the
 * host chrome (theme colours, safe areas, viewport height, haptics) so the app looks and feels
 * native in the chat client. Everything is optional: if the SDK is not present we simply return
 * neutral defaults and every call below stays a no-op.
 */

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { id: number; username?: string } };
  themeParams: Record<string, string>;
  colorScheme: "light" | "dark";
  viewportHeight: number;
  viewportStableHeight: number;
  /** present from Bot API 7.0: physical inset of the host chrome (notch, status bar) */
  safeAreaInset?: { top: number; bottom: number; left: number; right: number };
  /** present from Bot API 7.0: inset that keeps content clear of the header / bottom bar */
  contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number };
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  enableClosingConfirmation?: () => void;
  disableVerticalSwipes?: () => void;
  openTelegramLink?: (url: string) => void;
  BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick?: (cb: () => void) => void };
  HapticFeedback?: { impactOccurred: (style: string) => void; selectionChanged: () => void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/** Background the app paints; also pushed to the Telegram header so the bar never flashes white. */
const APP_BG = "#05060a";

export function tg(): TelegramWebApp | undefined {
  return typeof window === "undefined" ? undefined : window.Telegram?.WebApp;
}

export function isTelegram(): boolean {
  const app = tg();
  return Boolean(app && app.initData !== "");
}

/** Bot handle used for deep links; set VITE_TG_BOT when the bot is registered. */
export const TG_BOT = (import.meta.env.VITE_TG_BOT as string | undefined) ?? "AuraPredictBot";
export const TG_APP = (import.meta.env.VITE_TG_APP as string | undefined) ?? "app";

/** `https://t.me/<bot>/<app>?startapp=market_<id>` — opens the market straight inside Telegram. */
export function marketDeepLink(marketId: string): string {
  return `https://t.me/${TG_BOT}/${TG_APP}?startapp=market_${encodeURIComponent(marketId)}`;
}

/** Referral deep link: `?startapp=ref_<address>` so invites survive the Telegram hop. */
export function referralDeepLink(address: string): string {
  return `https://t.me/${TG_BOT}/${TG_APP}?startapp=ref_${address}`;
}

/** Launch parameter carried by the current container, if any. */
export function startParam(): string | null {
  const app = tg();
  const raw = app?.initDataUnsafe?.start_param ?? new URLSearchParams(window.location.search).get("startapp");
  return raw ?? null;
}

export function marketFromLaunch(): string | null {
  const p = startParam();
  return p && p.startsWith("market_") ? p.slice("market_".length) : null;
}

export function referrerFromLaunch(): string | null {
  const p = startParam();
  return p && p.startsWith("ref_") ? p.slice("ref_".length) : null;
}

/**
 * Apply the host chrome once.
 *
 * Theme handling is deliberate: the product is a dark-first brand surface, so instead of repainting
 * the UI in the host's palette (which would wash out the charts and posters) we do the reverse —
 * push our background into the Telegram header/background and expose the host palette as
 * `--tg-theme-*` custom properties for anything that wants to blend in. The result is a native
 * navigation bar with no white flash, and safe areas that never clip the trade button.
 */
export function initTelegram(): boolean {
  const app = tg();
  if (!app) return false;
  try {
    app.ready();
    app.expand();
    app.disableVerticalSwipes?.();
    app.setHeaderColor?.(APP_BG);
    app.setBackgroundColor?.(APP_BG);
    app.enableClosingConfirmation?.();

    const root = document.documentElement;
    root.classList.add("tg-app");
    if (app.colorScheme === "light") root.classList.add("tg-light");

    // Host palette -> CSS custom properties (Bot API names them snake_case)
    for (const [key, value] of Object.entries(app.themeParams ?? {})) {
      if (typeof value === "string" && value) root.style.setProperty(`--tg-theme-${key.replace(/_/g, "-")}`, value);
    }

    const applyInsets = () => {
      const safe = app.safeAreaInset;
      const content = app.contentSafeAreaInset;
      root.style.setProperty("--tg-safe-top", `${safe?.top ?? 0}px`);
      root.style.setProperty("--tg-safe-bottom", `${safe?.bottom ?? 0}px`);
      root.style.setProperty("--tg-safe-left", `${safe?.left ?? 0}px`);
      root.style.setProperty("--tg-safe-right", `${safe?.right ?? 0}px`);
      root.style.setProperty("--tg-content-top", `${content?.top ?? 0}px`);
      root.style.setProperty("--tg-content-bottom", `${content?.bottom ?? 0}px`);
      root.style.setProperty("--tg-viewport", `${app.viewportStableHeight || app.viewportHeight || window.innerHeight}px`);
    };
    applyInsets();
    window.addEventListener("resize", applyInsets);
  } catch {
    /* theme application is best-effort: a broken host must never break trading */
  }
  return true;
}

/** Short haptic pulse for fills and copy actions; silent outside Telegram. */
export function haptic(kind: "tap" | "success" = "tap"): void {
  const app = tg();
  try {
    if (kind === "success") app?.HapticFeedback?.impactOccurred("medium");
    else app?.HapticFeedback?.selectionChanged();
  } catch {
    /* ignore */
  }
}

/** Native Telegram share sheet, with a browser fallback to t.me/share. */
export function shareToTelegram(url: string, text: string): void {
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  const app = tg();
  if (app?.openTelegramLink) app.openTelegramLink(shareUrl);
  else window.open(shareUrl, "_blank", "noopener,noreferrer");
}

/**
 * Wire the host Back button to a handler (used while a market detail sheet is open) and hide it
 * again when the component unmounts. Returns the cleanup callback.
 */
export function bindBackButton(onBack: () => void): () => void {
  const app = tg();
  const btn = app?.BackButton;
  if (!btn) return () => undefined;
  try {
    btn.onClick(onBack);
    btn.show();
  } catch {
    return () => undefined;
  }
  return () => {
    try {
      btn.offClick?.(onBack);
      btn.hide();
    } catch {
      /* ignore */
    }
  };
}
