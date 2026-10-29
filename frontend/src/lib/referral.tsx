import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { referrerFromLaunch } from "./telegram";

/**
 * Referral capture.
 *
 * The first `?ref=0x...` (or Telegram `startapp=ref_0x...`) wins and is kept in
 * local storage, so a visitor who lands from an invite link is attributed even
 * after they reload days later. Nothing here trusts the stored address as
 * proof of payment — the SDK forwards it as trade metadata and the indexer is
 * what would settle a rebate.
 */

const KEY = "aura.referral.v1";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export interface ReferralState {
  /** referrer captured for this browser, if any */
  referrer: string | null;
  /** volume this browser traded while attributed (local, for the affiliate panel) */
  volumeUsdc: number;
  /** unique referral codes this browser has opened a link for */
  invites: number;
}

const EMPTY: ReferralState = { referrer: null, volumeUsdc: 0, invites: 0 };

function load(): ReferralState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<ReferralState>;
    return {
      referrer: typeof parsed.referrer === "string" && ADDRESS.test(parsed.referrer) ? parsed.referrer : null,
      volumeUsdc: typeof parsed.volumeUsdc === "number" && Number.isFinite(parsed.volumeUsdc) ? parsed.volumeUsdc : 0,
      invites: typeof parsed.invites === "number" && Number.isFinite(parsed.invites) ? parsed.invites : 0,
    };
  } catch {
    return EMPTY;
  }
}

function save(state: ReferralState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode: attribution simply does not persist */
  }
}

export interface ReferralApi extends ReferralState {
  /** the code present in the current URL, even if a different one is stored */
  incoming: string | null;
  /** 20% of the 1.5% protocol fee on attributed volume — an estimate, not a claim */
  rebateUsdc: number;
  /** record realised volume so the affiliate panel has something honest to show */
  addVolume: (usdc: number) => void;
}

const Ctx = createContext<ReferralApi | null>(null);

export function ReferralProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ReferralState>(() => (typeof window === "undefined" ? EMPTY : load()));
  const [incoming, setIncoming] = useState<string | null>(null);

  useEffect(() => {
    const fromQuery = new URLSearchParams(window.location.search).get("ref");
    const fromTg = referrerFromLaunch();
    const code = [fromQuery, fromTg].find((c) => c && ADDRESS.test(c)) ?? null;
    if (!code) return;
    setIncoming(code);
    setState((prev) => {
      const next: ReferralState = prev.referrer === code ? prev : { ...prev, referrer: code, invites: prev.invites + 1 };
      save(next);
      return next;
    });
  }, []);

  const addVolume = useCallback((usdc: number) => {
    if (!Number.isFinite(usdc) || usdc <= 0) return;
    setState((prev) => {
      const next = { ...prev, volumeUsdc: Math.round((prev.volumeUsdc + usdc) * 100) / 100 };
      save(next);
      return next;
    });
  }, []);

  const value = useMemo<ReferralApi>(
    () => ({
      ...state,
      incoming,
      rebateUsdc: Math.round(state.volumeUsdc * 0.015 * 0.2 * 100) / 100,
      addVolume,
    }),
    [state, incoming, addVolume],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useReferral(): ReferralApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useReferral must be used inside <ReferralProvider>");
  return ctx;
}

/** Referral link for an address, keeping the current origin so Pages works unchanged. */
export function referralLink(address: string): string {
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`;
  return `${base}?ref=${address}`;
}

/* ------------------------------------------------------------------ *
 * Order attribution
 *
 * A trade's referrer travels in the last 28 bytes of the order calldata:
 *   magic ("auraref1", 8 bytes) || referrer address (20 bytes)
 * Solidity's ABI decoder stops after the declared parameters, so the engine fills the order
 * exactly as if the tag were absent (proved by ReferralLedgerTest.testReferralTagDoesNotDisturbTheOrder),
 * while the indexer can recover the referrer straight from the transaction input.
 * ------------------------------------------------------------------ */

export const REF_MAGIC = "6175726172656631"; // ascii "auraref1"

export function tagOrderData(data: string, referrer: string | null | undefined): `0x${string}` {
  const clean = (data.startsWith("0x") ? data.slice(2) : data).toLowerCase();
  if (!referrer || !ADDRESS.test(referrer)) return `0x${clean}`;
  return `0x${clean}${REF_MAGIC}${referrer.slice(2).toLowerCase()}`;
}

/** Recover the referrer from a tagged transaction input (used by tooling and tests). */
export function readOrderTag(data: string): string | null {
  const clean = data.startsWith("0x") ? data.slice(2) : data;
  if (clean.length < 56) return null;
  const tail = clean.slice(-56).toLowerCase();
  if (!tail.startsWith(REF_MAGIC)) return null;
  const addr = `0x${tail.slice(8)}`;
  return ADDRESS.test(addr) ? addr : null;
}

/* ------------------------------------------------------------------ *
 * On-chain ledger (ReferralLedger)
 * ------------------------------------------------------------------ */

export const REFERRAL_LEDGER_ABI = [
  { type: "function", name: "claimable", stateMutability: "view", inputs: [{ name: "referrer", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "accrued", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "claimed", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "poolBalance", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "rebateBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "claimTo", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

