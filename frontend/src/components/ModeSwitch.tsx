import { useEffect, useState } from "react";
import { useMode, type TradeMode } from "../lib/mode";
import { isMuted, play, setMuted } from "../lib/sound";
import { formatFake } from "../lib/paper";
import { useT } from "../lib/i18n";

/** One-click switch between Real (on-chain) and Paper (simulated) trading. */
export function ModeSwitch({ onSwitch }: { onSwitch?: (m: TradeMode) => void }) {
  const { mode, setMode, paper } = useMode();
  const t = useT();

  const change = (m: TradeMode) => {
    if (m === mode) return;
    setMode(m);
    onSwitch?.(m);
  };

  return (
    <div className="relative flex items-center rounded-xl border border-white/10 bg-ink-950/70 p-0.5 backdrop-blur-md">
      <span
        className={`absolute top-0.5 h-[calc(100%-4px)] rounded-[10px] transition-all duration-300 ease-spring ${
          mode === "real"
            ? "left-0.5 w-[calc(50%-2px)] bg-gradient-to-r from-brand to-cyan-300 opacity-90"
            : "left-1/2 w-[calc(50%-2px)] bg-gradient-to-r from-cyan-400 to-violet-400 opacity-90"
        }`}
      />
      <button
        onClick={() => change("real")}
        className={`relative z-10 whitespace-nowrap rounded-[10px] px-2 sm:px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
          mode === "real" ? "text-ink-950" : "text-slate-400 hover:text-slate-200"
        }`}
        title={t.shell.mode.realTitle}
      >
        {t.shell.mode.real}
      </button>
      <button
        onClick={() => change("paper")}
        className={`relative z-10 whitespace-nowrap rounded-[10px] px-2 sm:px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
          mode === "paper" ? "text-ink-950" : "text-slate-400 hover:text-slate-200"
        }`}
        title={t.shell.mode.paperTitle}
      >
        {t.shell.mode.paper}
        {paper.balance > 0n && (
          <span className="mono ml-1 hidden text-[10px] opacity-80 sm:inline">{formatFake(paper.balance, 0)}</span>
        )}
      </button>
    </div>
  );
}

/** Sound toggle (audio starts enabled). */
export function SoundToggle() {
  const [muted, setM] = useState(() => isMuted());
  const t = useT();
  useEffect(() => {
    const onSound = (e: Event) => setM(!!(e as CustomEvent<{ muted: boolean }>).detail?.muted);
    window.addEventListener("aura:sound", onSound);
    return () => window.removeEventListener("aura:sound", onSound);
  }, []);

  return (
    <button
      className="btn-ghost h-8 w-8 rounded-lg p-0 text-[13px]"
      title={muted ? t.shell.sound.off : t.shell.sound.on}
      onClick={() => {
        const next = !muted;
        setMuted(next);
        if (!next) play("toggle");
      }}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
