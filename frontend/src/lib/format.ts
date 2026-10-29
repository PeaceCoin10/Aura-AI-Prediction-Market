import { formatUsdc, type EventName } from "@sdk";
import { en } from "../locales/en";

export { formatUsdc };

/** 6-decimal USDC → human-readable amount with two decimals (display only) */
export function usdc(v: bigint, digits = 2): string {
  const s = formatUsdc(v);
  const [i, f = ""] = s.split(".");
  if (digits === 0) return i;
  if (!f) return `${i}.${"0".repeat(digits)}`;
  return `${i}.${f.slice(0, digits).padEnd(digits, "0")}`;
}

/** Shares carry 6 decimals; two are enough for display */
export function shares(v: bigint): string {
  return usdc(v, 2);
}

/** 1e18 probability → "62.4%" */
export function pct(v: bigint, digits = 1): string {
  const n = Number(v) / 1e18;
  return `${(n * 100).toFixed(digits)}%`;
}

/** 1e18 probability → 0.62 */
export function toProb(v: bigint): number {
  return Math.min(1, Math.max(0, Number(v) / 1e18));
}

/** bps → "1.5%" */
export function bps(v: bigint | number, digits = 2): string {
  return `${(Number(v) / 100).toFixed(digits)}%`;
}

/** Unix seconds → "2d 03:12" / "03:12:44" / "Expired" */
export function countdown(target: bigint | number, now = Math.floor(Date.now() / 1000)): string {
  const t = Number(target);
  const d = t - now;
  if (!t) return "—";
  if (d <= 0) return en.content.format.expired;
  const days = Math.floor(d / 86400);
  const h = Math.floor((d % 86400) / 3600);
  const m = Math.floor((d % 3600) / 60);
  const s = d % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (days > 0) return `${days}${en.content.format.dayUnit} ${pad(h)}:${pad(m)}`;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

/** Timestamp → "10-27 09:30" */
export function shortTime(ts: bigint | number): string {
  const n = Number(ts);
  if (!n) return "—";
  const d = new Date(n * 1000);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function shortAddr(a?: string): string {
  if (!a) return "";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function shortId(id: string): string {
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

/** Event name → human label (used by toasts) */
export function eventLabel(name: EventName): string {
  const map: Record<string, string> = en.content.eventLabels;
  return map[name] ?? name;
}

/** Raw RPC / SDK exception → readable text */
export function errText(err: unknown): string {
  if (!err) return en.content.format.unknownError;
  const anyErr = err as { message?: string; shortMessage?: string; cause?: { message?: string } };
  return anyErr.shortMessage || anyErr.message || anyErr.cause?.message || String(err);
}
