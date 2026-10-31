import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../lib/i18n";
import { useWallet } from "../lib/wallet";
import {
  bindAutoPush,
  readStatus,
  readTestHook,
  subscribeSync,
  syncNow,
  forgetSession,
  type SyncStatus,
} from "../lib/cloudSync";
import { play } from "../lib/sound";

const TONE: Record<SyncStatus["phase"], string> = {
  local: "border-white/10 bg-white/[0.04] text-slate-400",
  ready: "border-white/10 bg-white/[0.04] text-slate-300",
  syncing: "border-cyan-400/30 bg-cyan-400/10 text-cyan-300",
  synced: "border-brand/30 bg-brand/10 text-brand",
  error: "border-danger/30 bg-danger/10 text-danger",
};

const DOT: Record<SyncStatus["phase"], string> = {
  local: "bg-slate-500",
  ready: "bg-slate-400",
  syncing: "bg-cyan-300 live-ring",
  synced: "bg-brand",
  error: "bg-danger",
};

/**
 * Cloud-sync status chip + control panel.
 *
 * The chip never claims more than the transport can do: `local` while no wallet is bound or no
 * provider is reachable, `synced` only after a real round-trip (pull → merge → push) succeeded.
 * Clicking it opens the transport, the device id, the last sync time and the two manual actions.
 */
export function SyncBadge() {
  const t = useT();
  const { account, signMessage } = useWallet();
  const [status, setStatus] = useState<SyncStatus>(readStatus);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const hook = useMemo(readTestHook, []);

  useEffect(() => subscribeSync(setStatus), []);

  /**
   * A wallet session always wins. Without one, the E2E harness may inject a fixed signer
   * (`window.__AURA_SYNC_TEST__`) so the real transport can be exercised without an extension.
   */
  const signer = useMemo(() => {
    if (account) return { address: account, sign: signMessage };
    if (hook) return { address: hook.address, sign: async () => hook.signature };
    return null;
  }, [account, signMessage, hook]);

  const active = Boolean(signer);
  const phase: SyncStatus["phase"] = active ? status.phase : "local";

  // Bind the auto-push loop for the lifetime of the connection.
  useEffect(() => {
    if (!signer) {
      forgetSession();
      return;
    }
    return bindAutoPush(signer);
  }, [signer]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label =
    phase === "syncing"
      ? t.terminal.sync.syncing
      : phase === "synced"
        ? t.terminal.sync.synced
        : phase === "error"
          ? t.terminal.sync.error
          : active
            ? t.terminal.sync.ready
            : t.terminal.sync.local;

  const manual = useCallback(
    async (direction: "push" | "pull") => {
      if (!signer) return;
      play("click");
      await syncNow(signer, direction);
    },
    [signer],
  );

  return (
    <div className="relative" ref={box} data-testid="sync-badge">
      <button
        type="button"
        onClick={() => {
          play("open");
          setOpen((v) => !v);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${t.terminal.sync.title} · ${status.provider}`}
        data-phase={phase}
        className={`hidden h-8 items-center gap-1.5 rounded-xl border px-2 text-[11px] transition-colors hover:border-white/25 sm:flex ${TONE[phase]}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${DOT[phase]}`} />
        <span className="mono uppercase tracking-[0.1em]">{label}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t.terminal.sync.title}
          className="absolute right-0 z-50 mt-2 w-72 animate-fade-in rounded-2xl border border-white/12 bg-[#0a0c12]/88 p-3 text-left shadow-[0_24px_60px_-16px_rgba(0,0,0,0.85)] backdrop-blur-2xl"
        >
          <div className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${DOT[phase]}`} />
            <span className="text-[12px] font-semibold text-slate-100">{t.terminal.sync.title}</span>
            <span className="ml-auto rounded-full border border-white/10 bg-white/[0.04] px-1.5 text-[9px] uppercase tracking-wide text-slate-400">
              {status.provider}
            </span>
          </div>

          <p className="mt-2 text-[10.5px] leading-relaxed text-slate-500">{t.terminal.sync.body}</p>

          <dl className="mt-2.5 space-y-1 text-[10.5px]">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">{t.terminal.sync.cipher}</dt>
              <dd className="mono text-slate-300">AES-256-GCM</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">{t.terminal.sync.device}</dt>
              <dd className="mono text-slate-300">{status.device}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">{t.terminal.sync.lastSync.replace("{{time}}", "").trim()}</dt>
              <dd className="mono text-slate-300" data-testid="sync-last">
                {status.lastSync ? new Date(status.lastSync).toLocaleTimeString() : "—"}
              </dd>
            </div>
          </dl>

          {!active ? (
            <div className="mt-2.5 rounded-lg border border-amber-400/25 bg-amber-400/10 px-2 py-1.5 text-[10.5px] text-amber-200">
              {t.terminal.sync.connectWallet}
            </div>
          ) : status.error ? (
            <div className="mt-2.5 break-words rounded-lg border border-danger/25 bg-danger/10 px-2 py-1.5 text-[10.5px] text-danger">
              {status.error}
            </div>
          ) : null}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              className="btn-ghost h-7 text-[11px]"
              disabled={!active || phase === "syncing"}
              onClick={() => void manual("push")}
            >
              {t.terminal.sync.push}
            </button>
            <button
              className="btn-ghost h-7 text-[11px]"
              disabled={!active || phase === "syncing"}
              onClick={() => void manual("pull")}
            >
              {t.terminal.sync.pull}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
