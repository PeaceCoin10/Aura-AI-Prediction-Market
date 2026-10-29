import { useHealth } from "../hooks/useHealth";
import { insightsHealth, refreshInsights } from "../lib/insights";
import { useEffect, useState } from "react";
import { format, useT } from "../lib/i18n";

/** Footer health strip: Base RPC latency, Hermes brain heartbeat, security/docs entry points. */
export function StatusBar({
  onOpenSecurity,
  onOpenDocs,
}: {
  onOpenSecurity: () => void;
  onOpenDocs: () => void;
}) {
  const health = useHealth();
  const t = useT();
  const [brain, setBrain] = useState(() => insightsHealth());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      await refreshInsights();
      if (alive) setBrain(insightsHealth());
    };
    void load();
    const t = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  const freshMs = brain.generatedAt ? Date.now() - brain.generatedAt : Infinity;
  const brainHot = brain.online && freshMs < 15 * 60 * 1000;
  const rpcTone = !health.rpcOk ? "bg-danger" : (health.rpcMs ?? 999) < 300 ? "bg-brand" : "bg-amber-400";

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] text-slate-500 sm:justify-between">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${rpcTone} ${health.rpcOk ? "animate-pulse-slow" : ""}`} />
          {t.shell.status.rpc}{" "}
          {health.rpcOk ? (
            <span className="mono text-slate-400">{health.rpcMs} ms</span>
          ) : (
            <span className="text-danger">{t.shell.status.rpcDown}</span>
          )}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${brainHot ? "bg-brand animate-pulse-slow" : "bg-amber-400"}`} />
          {t.shell.status.brain}{" "}
          {brainHot ? (
            <span className="text-slate-400">{t.shell.status.heartbeat}</span>
          ) : brain.online ? (
            <span className="text-amber-300">{format(t.shell.status.lastCycle, { min: Math.round(freshMs / 60000) })}</span>
          ) : (
            <span className="text-amber-300">{t.shell.status.idle}</span>
          )}
        </span>
        {health.blockNumber !== undefined && (
          <span className="mono hidden text-slate-600 sm:inline">#{health.blockNumber.toLocaleString()}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <button className="rounded-md px-1.5 py-0.5 hover:bg-white/5 hover:text-slate-300" onClick={onOpenSecurity}>
          🛡 {t.shell.status.security}
        </button>
        <span className="text-slate-700">·</span>
        <button className="rounded-md px-1.5 py-0.5 hover:bg-white/5 hover:text-slate-300" onClick={onOpenDocs}>
          📚 {t.shell.status.docs}
        </button>
      </div>
    </div>
  );
}
