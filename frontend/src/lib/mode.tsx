import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { claimChips, loadPaper, resetPaper, subscribePaper, type PaperState } from "./paper";
import { play } from "./sound";
import { en } from "../locales/en";

/**
 * Global trade mode: live (Real — wallet + on-chain contracts) vs paper (local chips).
 *
 * Cold-start policy (deliberate):
 *   - Every first visit lands in paper mode; no wallet and no USDC required. A legacy v1 key
 *     holding "real" is not honoured either — the user has to pick Real explicitly, which keeps
 *     the first screen from being an empty hall of 0-USDC balances.
 *   - The choice is persisted only after the user switches; it survives a refresh.
 */
export type TradeMode = "real" | "paper";

interface ModeApi {
  mode: TradeMode;
  setMode: (m: TradeMode) => void;
  paper: PaperState;
  claim: () => void;
  reset: () => void;
  /** True for this session when no mode has ever been recorded in localStorage */
  firstVisit: boolean;
}

const MODE_KEY = "aura.mode.v2";
const LEGACY_KEY = "aura.mode";
const Ctx = createContext<ModeApi | null>(null);

function readMode(): { mode: TradeMode; firstVisit: boolean } {
  try {
    const fresh = window.localStorage.getItem(MODE_KEY);
    if (fresh === "real" || fresh === "paper") return { mode: fresh, firstVisit: false };
    // The legacy key only answers "is this a first visit" — it never restores real mode
    return { mode: "paper", firstVisit: !window.localStorage.getItem(LEGACY_KEY) };
  } catch {
    return { mode: "paper", firstVisit: true };
  }
}

export function ModeProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(() => readMode(), []);
  const [mode, setModeState] = useState<TradeMode>(initial.mode);
  const [paper, setPaper] = useState<PaperState>(() => loadPaper());

  useEffect(() => subscribePaper(() => setPaper(loadPaper())), []);

  const setMode = useCallback((m: TradeMode) => {
    setModeState(m);
    try {
      window.localStorage.setItem(MODE_KEY, m);
      window.localStorage.setItem(LEGACY_KEY, m);
    } catch {
      /* ignore */
    }
    play("toggle");
  }, []);

  const claim = useCallback(() => {
    setPaper(claimChips());
    play("claim");
  }, []);

  const reset = useCallback(() => {
    setPaper(resetPaper());
    play("claim");
  }, []);

  // The starter chips land without a button press: any browser that has never claimed gets
  // 10,000 FAKE-USDC on mount. `resetPaper` marks the state claimed, so a deliberate reset
  // (which refills the balance itself) never double-credits.
  useEffect(() => {
    if (loadPaper().claimed) return;
    setPaper(claimChips());
  }, []);

  const value = useMemo<ModeApi>(
    () => ({ mode, setMode, paper, claim, reset, firstVisit: initial.firstVisit }),
    [mode, setMode, paper, claim, reset, initial.firstVisit],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMode(): ModeApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error(en.content.mode.hookOutsideProvider);
  return ctx;
}
