import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { EXPLORER } from "../lib/config";
import { useT } from "../lib/i18n";

export type ToastKind = "ok" | "err" | "info" | "trade";

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
  hash?: string;
}

interface ToastApi {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">, ttlMs?: number) => void;
  dismiss: (id: number) => void;
}

const Ctx = createContext<ToastApi | null>(null);
let seq = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: Omit<Toast, "id">, ttlMs = 7000) => {
      const id = seq++;
      setToasts((prev) => [{ ...t, id }, ...prev].slice(0, 6));
      window.setTimeout(() => dismiss(id), ttlMs);
    },
    [dismiss],
  );

  const value = useMemo<ToastApi>(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useToasts(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToasts must be used inside <ToastProvider>");
  return ctx;
}

const STYLES: Record<ToastKind, string> = {
  ok: "border-brand/40 bg-brand/10",
  err: "border-danger/40 bg-danger/10",
  info: "border-sky-400/30 bg-sky-400/10",
  trade: "border-amber-400/30 bg-amber-400/10",
};

const ICONS: Record<ToastKind, string> = { ok: "✓", err: "✕", info: "i", trade: "⇄" };

export function ToastStack() {
  const m = useT();
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[380px] max-w-[calc(100vw-2.5rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto animate-[slideIn_.18s_ease-out] rounded-xl border px-4 py-3 shadow-lg backdrop-blur ${STYLES[t.kind]}`}
          onClick={() => dismiss(t.id)}
          role="status"
        >
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px]">
              {ICONS[t.kind]}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-100">{t.title}</div>
              {t.body && <div className="mt-0.5 break-words text-xs text-slate-300">{t.body}</div>}
              {t.hash && (
                <a
                  href={`${EXPLORER}/tx/${t.hash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-xs text-brand hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {m.ui.toast.explorerLink}
                </a>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
