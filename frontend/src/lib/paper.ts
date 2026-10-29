/**
 * Paper trading engine
 *
 * Goal: someone with no USDC and no wallet is placing trades within 3 seconds.
 * Prices and share math **reuse the SDK's on-chain formulas** (previewBuyOffline /
 * previewSellOffline / priceYesOffline), so fills, slippage and impact behave exactly like the
 * live engine — the only difference is that no transaction is broadcast.
 *
 * Storage: localStorage (no cross-device sync), 10,000 FAKE-USDC starting chips, resettable.
 */
import { previewBuyOffline, previewSellOffline, priceYesOffline, type Outcome } from "@sdk";
import { en } from "../locales/en";

export const STARTER_CHIPS = 10_000n * 1_000_000n; // 10,000 FAKE-USDC (6 decimals)
const KEY = "aura.paper.v1";
const listeners = new Set<() => void>();
const P = en.content.paper;

export type Side = 0 | 1; // 0 = YES, 1 = NO (UI semantics)
/** SDK/contract `Outcome` is inverted: 0 = NO, 1 = YES. Getting this backwards buys the wrong side. */
const sdkOutcome = (side: Side): Outcome => (side === 0 ? 1 : 0);

export interface MarketRef {
  id: string;
  question: string;
  category: string;
  yesReserve: bigint;
  noReserve: bigint;
  resolutionTime: number;
  isDemo?: boolean;
}

export interface PaperPosition {
  yes: bigint;
  no: bigint;
  /** Total cost basis (fees included), 6 decimals */
  spent: bigint;
  /** Realized proceeds from sells, 6 decimals */
  realized: bigint;
}

export interface PaperTrade {
  id: string;
  marketId: string;
  question: string;
  side: Side;
  action: "buy" | "sell";
  /** USDC amount or share count, as a 6-decimal string */
  amount: string;
  shares: string;
  /** Fill price (USD per share) */
  avgPrice: number;
  ts: number;
}

export interface PaperState {
  balance: bigint;
  claimed: boolean;
  positions: Record<string, PaperPosition>;
  trades: PaperTrade[];
}

const EMPTY: PaperState = { balance: 0n, claimed: false, positions: {}, trades: [] };

function canStore(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

export function loadPaper(): PaperState {
  if (!canStore()) return { ...EMPTY };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const p = JSON.parse(raw) as {
      balance?: string;
      claimed?: boolean;
      positions?: Record<string, { yes?: string; no?: string; spent?: string; realized?: string }>;
      trades?: PaperTrade[];
    };
    const positions: Record<string, PaperPosition> = {};
    for (const [k, v] of Object.entries(p.positions ?? {})) {
      positions[k] = {
        yes: BigInt(v.yes ?? "0"),
        no: BigInt(v.no ?? "0"),
        spent: BigInt(v.spent ?? "0"),
        realized: BigInt(v.realized ?? "0"),
      };
    }
    return { balance: BigInt(p.balance ?? "0"), claimed: !!p.claimed, positions, trades: p.trades ?? [] };
  } catch {
    return { ...EMPTY };
  }
}

function save(state: PaperState): void {
  if (!canStore()) return;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        balance: state.balance.toString(),
        claimed: state.claimed,
        positions: Object.fromEntries(
          Object.entries(state.positions).map(([k, v]) => [
            k,
            { yes: v.yes.toString(), no: v.no.toString(), spent: v.spent.toString(), realized: v.realized.toString() },
          ]),
        ),
        trades: state.trades.slice(0, 120),
      }),
    );
  } catch {
    /* ignore quota */
  }
  listeners.forEach((fn) => fn());
}

export function subscribePaper(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Claim 10,000 FAKE-USDC in one click (once only; available again after a reset) */
export function claimChips(): PaperState {
  const s = loadPaper();
  const next: PaperState = { ...s, balance: s.balance + STARTER_CHIPS, claimed: true };
  save(next);
  return next;
}

export function resetPaper(): PaperState {
  save({ ...EMPTY, balance: STARTER_CHIPS, claimed: true });
  return loadPaper();
}

export function paperPriceYes(m: MarketRef): bigint {
  return priceYesOffline({ yesReserve: m.yesReserve, noReserve: m.noReserve });
}

export function paperQuoteBuy(m: MarketRef, side: Side, amountIn: bigint): bigint {
  return previewBuyOffline({ yesReserve: m.yesReserve, noReserve: m.noReserve }, sdkOutcome(side), amountIn);
}

export function paperQuoteSell(m: MarketRef, side: Side, sharesIn: bigint): bigint {
  return previewSellOffline({ yesReserve: m.yesReserve, noReserve: m.noReserve }, sdkOutcome(side), sharesIn);
}

/** Price impact (bps): same convention as the contract — notional / depth, 5% hard cap */
export function paperImpactBps(m: MarketRef, side: Side, amountIn: bigint): number {
  const depth = m.yesReserve + m.noReserve;
  if (depth === 0n) return 0;
  return Number((amountIn * 10_000n) / depth);
}

export function paperBuy(m: MarketRef, side: Side, amountIn: bigint): { ok: boolean; shares: bigint; reason?: string } {
  const s = loadPaper();
  if (amountIn <= 0n) return { ok: false, shares: 0n, reason: P.amountPositive };
  if (amountIn > s.balance) return { ok: false, shares: 0n, reason: P.insufficientBalance };
  const shares = paperQuoteBuy(m, side, amountIn);
  if (shares === 0n) return { ok: false, shares: 0n, reason: P.noShares };

  const pos = s.positions[m.id] ?? { yes: 0n, no: 0n, spent: 0n, realized: 0n };
  const next: PaperState = {
    ...s,
    balance: s.balance - amountIn,
    positions: {
      ...s.positions,
      [m.id]: {
        ...pos,
        yes: side === 0 ? pos.yes + shares : pos.yes,
        no: side === 1 ? pos.no + shares : pos.no,
        spent: pos.spent + amountIn,
      },
    },
    trades: [
      {
        id: `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        marketId: m.id,
        question: m.question,
        side,
        action: "buy",
        amount: amountIn.toString(),
        shares: shares.toString(),
        avgPrice: Number(amountIn) / Number(shares),
        ts: Date.now(),
      },
      ...s.trades,
    ],
  };
  save(next);
  return { ok: true, shares };
}

export function paperSell(m: MarketRef, side: Side, sharesIn: bigint): { ok: boolean; proceeds: bigint; reason?: string } {
  const s = loadPaper();
  const pos = s.positions[m.id];
  if (!pos) return { ok: false, proceeds: 0n, reason: P.noPosition };
  const held = side === 0 ? pos.yes : pos.no;
  if (sharesIn <= 0n || sharesIn > held) return { ok: false, proceeds: 0n, reason: P.exceedsPosition };
  const proceeds = paperQuoteSell(m, side, sharesIn);
  if (proceeds === 0n) return { ok: false, proceeds: 0n, reason: P.depthTooThin };

  const next: PaperState = {
    ...s,
    balance: s.balance + proceeds,
    positions: {
      ...s.positions,
      [m.id]: {
        ...pos,
        yes: side === 0 ? pos.yes - sharesIn : pos.yes,
        no: side === 1 ? pos.no - sharesIn : pos.no,
        realized: pos.realized + proceeds,
      },
    },
    trades: [
      {
        id: `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        marketId: m.id,
        question: m.question,
        side,
        action: "sell",
        amount: proceeds.toString(),
        shares: sharesIn.toString(),
        avgPrice: Number(proceeds) / Number(sharesIn),
        ts: Date.now(),
      },
      ...s.trades,
    ],
  };
  save(next);
  return { ok: true, proceeds };
}

/** Position mark: immediate sell proceeds against the current CPMM, plus unrealized PnL */
export function paperValue(m: MarketRef, pos?: PaperPosition): { value: bigint; pnl: bigint } {
  if (!pos) return { value: 0n, pnl: 0n };
  const vYes = pos.yes > 0n ? paperQuoteSell(m, 0, pos.yes) : 0n;
  const vNo = pos.no > 0n ? paperQuoteSell(m, 1, pos.no) : 0n;
  const value = vYes + vNo + pos.realized;
  return { value, pnl: value - pos.spent };
}

export function formatFake(v: bigint, digits = 2): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").slice(0, digits);
  return `${neg ? "-" : ""}${whole.toLocaleString()}${digits > 0 ? `.${frac}` : ""}`;
}
