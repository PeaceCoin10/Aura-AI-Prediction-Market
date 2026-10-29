/**
 * CentralPredictionSDK — a frontend-safe wrapper around the single-contract, multi-market engine (CentralPredictionEngine)
 *
 * Design goals — the same three invariants as the legacy PredictionSDK, ported to the new ABI:
 *   1. No write method ever hands back **raw calldata**: every path runs a local preflight first, so a bad
 *      parameter or stale on-chain state throws locally instead of burning gas on a guaranteed revert.
 *   2. `minSharesOut` / `minAmountOut` may never travel unprotected: 0 is rejected outright; a value above
 *      the current quote is rejected (the trade cannot fill); and anything looser than "quote x (1 - 5%)"
 *      is rejected too, so a frontend typing a lazy 1 cannot quietly disable the guardrail.
 *   3. Zero dependencies: the caller injects only `ethCall(to, data)`, so viem / ethers / wagmi / a bare
 *      node all work. Every calldata blob is encoded by hand in this file, and the suite diffs it byte for
 *      byte against `cast` — Solidity's own encoder.
 *
 * Usage:
 *   const sdk = new CentralPredictionSDK(
 *     { ethCall: (to, data) => provider.call({ to, data }) },
 *     { engine: "0x...", chainId: 8453, account: "0x..." },
 *   );
 *   const plan = await sdk.buildBuyShares({ marketId, outcome: 1, amountIn: 100_000_000n, slippageBps: 100 });
 *   await wallet.sendTransaction({ to: plan.to, data: plan.data });
 *
 * Contract-side mapping (the full table lives in docs/CENTRAL-SDK-GUIDE.md):
 *   createMarket(bytes32,string,uint256)                        ← buildCreateMarket (no category)
 *   createMarketWithMeta(bytes32,string,string,uint256)          ← buildCreateMarket (with meta.category)
 *   buyShares(bytes32,uint8,uint256,uint256)                     ← buildBuyShares
 *   sellShares(bytes32,uint8,uint256,uint256)                    ← buildSellShares
 *   redeem(bytes32)                                              ← buildRedeem
 *   resolveMarket(bytes32,uint8)                                 ← buildResolveMarket
 *   overrideResolution(bytes32,uint8)                            ← buildOverrideResolution
 */

/* ============================== Types ============================== */

export type Address = string;
export type Hex = string;

/** The minimal read-only view the caller must inject; it never sends a transaction */
export interface Transport {
  /** eth_call; on failure the thrown error may carry revert data (which decodeRevert below unwraps) */
  ethCall(to: Address, data: Hex): Promise<Hex>;
  /**
   * Optional: latest on-chain block time, in seconds. Every time comparison in the contract is against
   * block.timestamp, so a local wall clock mis-judges fast-forwarded test chains and drifting node clocks.
   * Falls back to the system clock when omitted.
   */
  now?: () => Promise<number | bigint>;
}

export interface SDKConfig {
  /** CentralPredictionEngine address */
  engine: Address;
  /** Expected chainId (optional; when supplied it is validated, which catches wrong-network sessions) */
  chainId?: number;
  /** Current user address (optional; enables role and position preflight checks) */
  account?: Address;
}

/** A fully-formed transaction plan computed locally, ready for wallet.sendTransaction */
export interface TxPlan {
  to: Address;
  data: Hex;
  value: "0x0";
  /** Contract method name, for analytics and logs */
  method: string;
  /** Human-readable summary (English), safe to show verbatim in a confirmation dialog */
  summary: string;
  /** Snapshot of the decisive inputs, for the audit trail and replay */
  meta: Record<string, string | number | bigint | boolean>;
  /**
   * Non-blocking risk warning:
   *   impact_near_limit — this order's price impact has already reached 80% (4%) of the 5% hard cap.
   *   One size step further and the contract reverts, so the UI should tell the user to shrink or split.
   */
  warning?: "impact_near_limit";
}

export type Outcome = 0 | 1 | 2;

export const OUTCOME_NO: Outcome = 0;
export const OUTCOME_YES: Outcome = 1;
export const OUTCOME_INVALID: Outcome = 2;

/** Hard slippage bounds: 1..500 bps (500 = 5%, matching the contract's MAX_IMPACT_BPS_CAP) */
export const MIN_SLIPPAGE_BPS = 1n;
export const MAX_SLIPPAGE_BPS = 500n;

/** Slippage presets, passed straight to buildBuyShares/buildSellShares as slippageBps */
export const SLIPPAGE_CONSERVATIVE = 50n; // 0.5% — large size or thin liquidity: prefer a failed trade to a sandwich
export const SLIPPAGE_NORMAL = 100n; // 1%   — the recommended default
export const SLIPPAGE_DEGEN = 300n; // 3%   — racing a hot market, willing to pay more slippage

/** The contract's hard price-impact cap (5% of pool depth) */
export const MAX_IMPACT_BPS = 500n;
/** Warn at 80% of the cap (4%) instead of waiting for the revert */
export const IMPACT_WARN_BPS = 400n;

/* ============================== Error model ============================== */

/**
 * Two-tier error codes:
 *   - `local/*`  : intercepted by the local preflight (no gas spent)
 *   - `chain/*`  : an on-chain revert, carrying its 4-byte selector
 * Every error carries a product-grade English message, so the frontend can render `err.message` directly.
 */
export type SdkErrorCode =
  // —— local preflight ——
  | "local/TRANSPORT_ERROR"
  | "local/NOT_CONNECTED"
  | "local/CHAIN_MISMATCH"
  | "local/BAD_ADDRESS"
  | "local/BAD_BYTES32"
  | "local/BAD_OUTCOME"
  | "local/BAD_AMOUNT"
  | "local/SLIPPAGE_OUT_OF_RANGE"
  | "local/MIN_OUT_REQUIRED"
  | "local/MIN_OUT_ABOVE_QUOTE"
  | "local/SLIPPAGE_TOO_LOOSE"
  | "local/QUESTION_LENGTH"
  | "local/CATEGORY_LENGTH"
  | "local/RESOLUTION_TIME_RANGE"
  | "local/MARKET_NOT_FOUND"
  | "local/MARKET_EXISTS"
  | "local/MARKET_RESOLVED"
  | "local/MARKET_NOT_RESOLVED"
  | "local/TRADING_CLOSED"
  | "local/MARKET_PAUSED"
  | "local/QUOTE_MISMATCH"
  | "local/INSUFFICIENT_SHARES"
  | "local/ACCOUNT_REQUIRED"
  | "local/NOT_CREATOR"
  | "local/NOT_ORACLE"
  | "local/NOT_ADMIN"
  | "local/ALREADY_FINAL"
  | "local/NOT_DISPUTING"
  | "local/SAME_OUTCOME"
  // —— on-chain revert ——
  | "chain/UNKNOWN"
  | "chain/REVERT_STRING"
  | "chain/BELOW_MIN_BET"
  | "chain/ABOVE_MAX_BET"
  | "chain/IMPACT_TOO_HIGH"
  | "chain/DISPUTE_WINDOW_OPEN"
  | "chain/DISPUTE_WINDOW_CLOSED"
  | "chain/NOT_AUTHORIZED_ROLE"
  | "chain/MARKET_NOT_FOUND"
  | "chain/MARKET_EXISTS"
  | "chain/MARKET_RESOLVED"
  | "chain/NOT_RESOLVED"
  | "chain/INVALID_OUTCOME"
  | "chain/INVALID_QUESTION"
  | "chain/INVALID_RESOLUTION_TIME"
  | "chain/TRADING_CLOSED"
  | "chain/ENFORCED_PAUSE"
  | "chain/TOO_EARLY_TO_RESOLVE"
  | "chain/REFUND_WINDOW_NOT_REACHED"
  | "chain/NOTHING_TO_REDEEM"
  | "chain/NOTHING_TO_SWEEP"
  | "chain/BELOW_MIN_SEED"
  | "chain/ZERO_SHARES"
  | "chain/SLIPPAGE_EXCEEDED"
  | "chain/INSUFFICIENT_LIQUIDITY"
  | "chain/SAME_OUTCOME"
  | "chain/ZERO_ADDRESS"
  | "chain/NOT_CONTRACT"
  | "chain/SAFE_ERC20"
  | "chain/PANIC"
  | "chain/REENTRANCY";

export class SdkError extends Error {
  public readonly code: SdkErrorCode;
  /** 4-byte selector of the on-chain revert (undefined when intercepted locally) */
  public readonly selector?: Hex;
  /** Whether this came from the chain, which separates a preflight block from a wallet revert */
  public readonly onchain: boolean;
  /** Raw revert payload, kept for debugging */
  public readonly raw?: string;

  constructor(code: SdkErrorCode, message: string, opts: { selector?: Hex; raw?: string } = {}) {
    super(message);
    this.name = "SdkError";
    this.code = code;
    this.selector = opts.selector;
    this.onchain = code.startsWith("chain/");
    this.raw = opts.raw;
  }
}

const MESSAGES: Record<SdkErrorCode, string> = {
  "local/TRANSPORT_ERROR": "Failed to read on-chain state. Check your RPC connection and retry.",
  "local/NOT_CONNECTED": "The SDK has no engine address configured.",
  "local/CHAIN_MISMATCH": "Your wallet is on a different network than the contract. Switch networks and retry.",
  "local/BAD_ADDRESS": "Malformed address.",
  "local/BAD_BYTES32": "marketId must be 32-byte hex (0x followed by 64 hex characters).",
  "local/BAD_OUTCOME": "Outcome must be 0 (NO), 1 (YES) or 2 (INVALID).",
  "local/BAD_AMOUNT": "Amount must be a positive integer in base units (USDC has 6 decimals).",
  "local/SLIPPAGE_OUT_OF_RANGE": "Slippage tolerance must be between 1 and 500 bps (0.01%-5%).",
  "local/MIN_OUT_REQUIRED": "minSharesOut/minAmountOut cannot be 0 — without a floor a sandwicher fills you at any price.",
  "local/MIN_OUT_ABOVE_QUOTE": "minSharesOut is above the current quote, so this trade cannot fill (has the price already been pushed?)",
  "local/SLIPPAGE_TOO_LOOSE": "Slippage tolerance is looser than 5%, which is the same as having no protection.",
  "local/QUESTION_LENGTH": "Question must be 8-280 bytes of UTF-8.",
  "local/CATEGORY_LENGTH": "Category must be 1-32 bytes.",
  "local/RESOLUTION_TIME_RANGE": "Resolution time must fall between now + 1 hour and now + 365 days.",
  "local/MARKET_NOT_FOUND": "Market not found.",
  "local/MARKET_EXISTS": "A market with this ID already exists; it cannot be created twice.",
  "local/MARKET_RESOLVED": "Market is already resolved and can no longer be traded.",
  "local/MARKET_NOT_RESOLVED": "Market is not resolved yet.",
  "local/TRADING_CLOSED": "Trading closed: the resolution time has passed.",
  "local/MARKET_PAUSED": "Trading is paused protocol-wide. Try again later.",
  "local/QUOTE_MISMATCH": "Local quote disagrees with the on-chain preview (ABI or version mismatch); aborted.",
  "local/INSUFFICIENT_SHARES": "Not enough shares held.",
  "local/ACCOUNT_REQUIRED": "This action needs the current user address (pass `account` when constructing the SDK).",
  "local/NOT_CREATOR": "This address has no market-creation permission.",
  "local/NOT_ORACLE": "This address has no resolution permission.",
  "local/NOT_ADMIN": "Only the admin (Safe multisig) can perform this action.",
  "local/ALREADY_FINAL": "The resolution is past its dispute window and finalized; it can no longer be overridden.",
  "local/NOT_DISPUTING": "Not inside a dispute window, so there is nothing to override.",
  "local/SAME_OUTCOME": "The new outcome is identical to the current one.",
  "chain/UNKNOWN": "The chain rejected the transaction (unknown error).",
  "chain/REVERT_STRING": "The chain rejected the transaction.",
  "chain/BELOW_MIN_BET": "Below the minimum bet (5 USDC).",
  "chain/ABOVE_MAX_BET": "Above the per-trade cap (10,000 USDC).",
  "chain/IMPACT_TOO_HIGH": "This order would move the price too far (over 5% of the pool). Reduce the size or split it.",
  "chain/DISPUTE_WINDOW_OPEN": "This market is inside its 1-hour dispute window; redemption is locked until the window closes.",
  "chain/DISPUTE_WINDOW_CLOSED": "The dispute window has closed; the outcome can no longer change.",
  "chain/NOT_AUTHORIZED_ROLE": "Your address is not authorized to perform this action.",
  "chain/MARKET_NOT_FOUND": "Market not found.",
  "chain/MARKET_EXISTS": "Market already exists.",
  "chain/MARKET_RESOLVED": "Market already resolved.",
  "chain/NOT_RESOLVED": "Market is not resolved yet.",
  "chain/INVALID_OUTCOME": "Invalid outcome value.",
  "chain/INVALID_QUESTION": "Invalid question or category.",
  "chain/INVALID_RESOLUTION_TIME": "Invalid resolution time.",
  "chain/TRADING_CLOSED": "Trading is closed.",
  "chain/ENFORCED_PAUSE": "The protocol is paused.",
  "chain/TOO_EARLY_TO_RESOLVE": "Resolution time has not been reached, so the market cannot be resolved yet.",
  "chain/REFUND_WINDOW_NOT_REACHED": "The 7-day refund window has not been reached yet.",
  "chain/NOTHING_TO_REDEEM": "Nothing to redeem.",
  "chain/NOTHING_TO_SWEEP": "No residual dust to sweep.",
  "chain/BELOW_MIN_SEED": "Liquidity seed is below the floor (10 USDC).",
  "chain/ZERO_SHARES": "Computed share amount is 0 (the size is too small).",
  "chain/SLIPPAGE_EXCEEDED": "Fill price fell outside the slippage floor; reverted.",
  "chain/INSUFFICIENT_LIQUIDITY": "Insufficient liquidity or balance.",
  "chain/SAME_OUTCOME": "The new outcome is identical to the current one.",
  "chain/ZERO_ADDRESS": "Address cannot be the zero address.",
  "chain/NOT_CONTRACT": "Target address is not a contract.",
  "chain/SAFE_ERC20": "USDC transfer failed (insufficient balance or allowance).",
  "chain/PANIC": "Arithmetic or assertion failure inside the contract.",
  "chain/REENTRANCY": "Reentrancy guard triggered.",
};

/** Contract custom-error selector → (error code, error name) */
export const ERROR_SELECTORS: Record<string, { code: SdkErrorCode; name: string }> = {
  "0x5688ffb3": { code: "chain/BELOW_MIN_BET", name: "BelowMinBet" },
  "0xb8ab88d4": { code: "chain/ABOVE_MAX_BET", name: "AboveMaxBet" },
  "0x22410594": { code: "chain/IMPACT_TOO_HIGH", name: "ImpactTooHigh" },
  "0x87920b43": { code: "chain/DISPUTE_WINDOW_OPEN", name: "DisputeWindowOpen" },
  "0x435a3cfe": { code: "chain/DISPUTE_WINDOW_CLOSED", name: "DisputeWindowClosed" },
  "0x47bc7cc8": { code: "chain/NOT_AUTHORIZED_ROLE", name: "OnlyCreator" },
  "0x80fee105": { code: "chain/NOT_AUTHORIZED_ROLE", name: "OnlyOracle" },
  "0x47556579": { code: "chain/NOT_AUTHORIZED_ROLE", name: "OnlyAdmin" },
  "0x7db1be50": { code: "chain/MARKET_NOT_FOUND", name: "MarketNotFound" },
  "0x8fc6f59b": { code: "chain/MARKET_EXISTS", name: "MarketExists" },
  "0x1db9461a": { code: "chain/MARKET_RESOLVED", name: "MarketResolvedAlready" },
  "0x9f4a6489": { code: "chain/NOT_RESOLVED", name: "NotResolved" },
  "0xc74a206d": { code: "chain/INVALID_OUTCOME", name: "InvalidOutcome" },
  "0x81e1c048": { code: "chain/INVALID_QUESTION", name: "InvalidQuestion" },
  "0x10549aa0": { code: "chain/INVALID_RESOLUTION_TIME", name: "InvalidResolutionTime" },
  "0xe2c865df": { code: "chain/TRADING_CLOSED", name: "TradingClosed" },
  "0xd93c0665": { code: "chain/ENFORCED_PAUSE", name: "EnforcedPause" },
  "0x0fce133d": { code: "chain/TOO_EARLY_TO_RESOLVE", name: "TooEarlyToResolve" },
  "0xb5b6d675": { code: "chain/REFUND_WINDOW_NOT_REACHED", name: "RefundWindowNotReached" },
  "0x9890af60": { code: "chain/NOTHING_TO_REDEEM", name: "NothingToRedeem" },
  "0x351261fc": { code: "chain/NOTHING_TO_SWEEP", name: "NothingToSweep" },
  "0x03580407": { code: "chain/BELOW_MIN_SEED", name: "BelowMinSeed" },
  "0x9811e0c7": { code: "chain/ZERO_SHARES", name: "ZeroShares" },
  "0x8199f5f3": { code: "chain/SLIPPAGE_EXCEEDED", name: "SlippageExceeded" },
  "0xbb55fd27": { code: "chain/INSUFFICIENT_LIQUIDITY", name: "InsufficientLiquidity" },
  "0x3f8dadf7": { code: "chain/SAME_OUTCOME", name: "SameOutcome" },
  "0xd92e233d": { code: "chain/ZERO_ADDRESS", name: "ZeroAddress" },
  "0x6f7c43f1": { code: "chain/NOT_CONTRACT", name: "NotContract" },
  "0x5274afe7": { code: "chain/SAFE_ERC20", name: "SafeERC20FailedOperation" },
  "0xcd786059": { code: "chain/SAFE_ERC20", name: "AddressInsufficientBalance" },
  "0x9996b315": { code: "chain/SAFE_ERC20", name: "AddressEmptyCode" },
  "0x1425ea42": { code: "chain/SAFE_ERC20", name: "FailedInnerCall" },
  "0x227bc153": { code: "chain/PANIC", name: "MathOverflowedMulDiv" },
  "0x3ee5aeb5": { code: "chain/REENTRANCY", name: "ReentrancyGuardReentrantCall" },
};

/**
 * Translate revert data thrown back by a wallet/RPC into an SdkError with an English message.
 * Handles custom errors (4-byte selector), Error(string), Panic(uint256) and pure local interception.
 */
export function decodeRevert(err: unknown): SdkError {
  const raw = extractRevertData(err);
  if (!raw || raw === "0x") {
    const msg = err instanceof Error ? err.message : String(err);
    return new SdkError("chain/UNKNOWN", `${MESSAGES["chain/UNKNOWN"]} (${msg})`, { raw: msg });
  }
  const data = raw.toLowerCase();
  const selector = data.slice(0, 10);

  if (selector === "0x08c379a0") {
    // Error(string)
    const text = decodeAbiString(data.slice(10));
    return new SdkError("chain/REVERT_STRING", text || MESSAGES["chain/REVERT_STRING"], { selector, raw: data });
  }
  if (selector === "0x4e487b71") {
    // Panic(uint256)
    const code = word(data.slice(10), 0);
    return new SdkError("chain/PANIC", `${MESSAGES["chain/PANIC"]} (panic code 0x${code.toString(16)})`, {
      selector,
      raw: data,
    });
  }
  const hit = ERROR_SELECTORS[selector];
  if (hit) {
    return new SdkError(hit.code, MESSAGES[hit.code], { selector, raw: `${hit.name} ${data}` });
  }
  return new SdkError("chain/UNKNOWN", `${MESSAGES["chain/UNKNOWN"]} (selector ${selector})`, { selector, raw: data });
}

function extractRevertData(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const o = err as Record<string, unknown>;
  for (const key of ["data", "revertData", "return", "result"]) {
    const v = o[key];
    if (typeof v === "string" && v.startsWith("0x")) return v;
    if (v && typeof v === "object") {
      const nested = extractRevertData(v);
      if (nested) return nested;
    }
  }
  if (typeof o.error === "object" && o.error) return extractRevertData(o.error);
  if (typeof o.info === "object" && o.info) return extractRevertData(o.info);
  if (typeof o.cause === "object" && o.cause) return extractRevertData(o.cause);
  return null;
}

/* ============================== ABI primitives ============================== */

const ZERO32 = "0".repeat(64);
const HEX_RE = /^0x[0-9a-fA-F]*$/;

export function strip0x(hex: string): string {
  return hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
}

export function isAddress(v: unknown): v is Address {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
}

export function isBytes32(v: unknown): v is Hex {
  return typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
}

export function pad32(hexBody: string): string {
  const body = strip0x(hexBody);
  if (body.length > 64) throw new SdkError("local/BAD_BYTES32", MESSAGES["local/BAD_BYTES32"]);
  return body.padStart(64, "0");
}

export function uintWord(v: bigint | number): string {
  const n = typeof v === "bigint" ? v : BigInt(Math.trunc(v));
  if (n < 0n) throw new SdkError("local/BAD_AMOUNT", MESSAGES["local/BAD_AMOUNT"]);
  return n.toString(16).padStart(64, "0");
}

export function addressWord(addr: Address): string {
  if (!isAddress(addr)) throw new SdkError("local/BAD_ADDRESS", MESSAGES["local/BAD_ADDRESS"]);
  return strip0x(addr).toLowerCase().padStart(64, "0");
}

export function bytes32Word(v: Hex): string {
  if (!isBytes32(v)) throw new SdkError("local/BAD_BYTES32", MESSAGES["local/BAD_BYTES32"]);
  return strip0x(v).toLowerCase();
}

/* -------------------- UTF-8 encode/decode (browser and Node, no Buffer) -------------------- */

const HEX_TO_BYTES: Record<string, number> = {};
for (let i = 0; i < 256; i += 1) HEX_TO_BYTES[i.toString(16).padStart(2, "0")] = i;

function utf8Bytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function utf8Length(str: string): number {
  return utf8Bytes(str).length;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Pure hex → UTF-8 string (no Buffer, so it also runs in the browser) */
export function hexToUtf8(hex: string): string {
  const clean = strip0x(hex);
  const bytes = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = HEX_TO_BYTES[clean.slice(i * 2, i * 2 + 2).toLowerCase()] ?? 0;
  }
  return new TextDecoder().decode(bytes);
}

/** ABI-encode a dynamic string (UTF-8, right-padded to 32-byte words) */
export function encodeString(str: string): { body: string; words: number } {
  const bytes = utf8Bytes(str);
  const hex = bytesToHex(bytes);
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64 || 0, "0");
  const words = 1 + (padded.length ? padded.length / 64 : 0);
  return { body: uintWord(BigInt(bytes.length)) + padded, words };
}

/** Decode an ABI-encoded string (the offset points at the length word, then the UTF-8 bytes follow) */
export function decodeString(raw: string): string {
  const body = strip0x(raw);
  if (body.length < 64) return "";
  const off = Number(BigInt("0x" + body.slice(0, 64))) * 2;
  if (body.length < off + 64) return "";
  const len = Number(BigInt("0x" + body.slice(off, off + 64)));
  return hexToUtf8(body.slice(off + 64, off + 64 + len * 2));
}

function word(data: string, index: number): bigint {
  const body = strip0x(data);
  const chunk = body.slice(index * 64, (index + 1) * 64);
  if (chunk.length !== 64) return 0n;
  return BigInt("0x" + chunk);
}

export function decodeAbiString(data: string): string {
  const body = strip0x(data);
  if (body.length < 128) return "";
  const len = Number(BigInt("0x" + body.slice(64, 128)));
  return hexToUtf8(body.slice(128, 128 + len * 2));
}

/* ============================== Selector table ============================== */

/** All entries generated with `cast sig`; the suite re-derives each one against the compiler ABI */
export const SEL = {
  createMarket: "0xfeeece8b",
  createMarketWithMeta: "0x1e9b6b02",
  buyShares: "0xbbd4f854",
  sellShares: "0xdb833e3a",
  redeem: "0xeda1122c",
  resolveMarket: "0x5e382837",
  overrideResolution: "0xc0b9795d",
  previewBuy: "0xf0729712",
  previewSell: "0x29aec689",
  marketCore: "0xfbfab8f9",
  resolutionState: "0x8e092a39",
  yesOf: "0xca652c50",
  noOf: "0x081d260b",
  paused: "0x5c975abb",
  admin: "0xf851a440",
  creators: "0x933166e1",
  oracles: "0xaddd5099",
  minBet: "0x6540742f",
  maxBet: "0x7e95b523",
  minTradingWindow: "0x2f6488dc",
  maxTradingWindow: "0x96b6273d",
  disputeWindow: "0xf585dc57",
  refundDelay: "0x190da595",
  depth: "0x9e77a298",
  priceYes: "0x20c7e5ff",
  marketCount: "0xec979082",
  marketIds: "0x779a9683",
  marketQuestion: "0xe59fab92",
  marketCategory: "0x93eaaf09",
  isFinal: "0xda3686de",
  tradingOpen: "0x7142f5d6",
  tradeFeeBps: "0x9185f598",
  settleFeeBps: "0xb648acb4",
} as const;

/* ============================== Offline pricing (same formula as the contract) ============================== */

export interface PoolSnapshot {
  yesReserve: bigint;
  noReserve: bigint;
  cash?: bigint;
  owed?: bigint;
  totalVolume?: bigint;
  resolutionTime?: bigint;
  createdAt?: bigint;
  creator?: Address;
  outcome?: number;
  resolved?: boolean;
  exists?: boolean;
}

export interface MarketState extends Required<Omit<PoolSnapshot, "creator">> {
  creator: Address;
}

const BPS = 10_000n;
const WAD = 10n ** 18n;

function mulDivDown(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) return 0n;
  return (a * b) / d;
}

function mulDivUp(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) return 0n;
  const p = a * b;
  return p === 0n ? 0n : (p - 1n) / d + 1n;
}

/** Mirrors the contract's TRADE_FEE_BPS = 150 */
export const TRADE_FEE_BPS = 150n;

/** Offline computation isomorphic to the contract's previewBuy, so prices render without a network round-trip */
export function previewBuyOffline(
  pool: { yesReserve: bigint; noReserve: bigint },
  outcome: Outcome,
  amountIn: bigint,
  tradeFeeBps: bigint = TRADE_FEE_BPS,
): bigint {
  if (pool.yesReserve === 0n || pool.noReserve === 0n) return 0n;
  if (outcome > 1) return 0n;
  const fee = mulDivUp(amountIn, tradeFeeBps, BPS);
  const net = amountIn - fee;
  if (net <= 0n) return 0n;
  if (outcome === OUTCOME_YES) {
    return net + (pool.yesReserve - mulDivUp(pool.yesReserve, pool.noReserve, pool.noReserve + net));
  }
  return net + (pool.noReserve - mulDivUp(pool.noReserve, pool.yesReserve, pool.yesReserve + net));
}

/** Isomorphic to the contract's previewSell: midpoint of the before/after price, minus the 1.5% fee */
export function previewSellOffline(
  pool: { yesReserve: bigint; noReserve: bigint },
  outcome: Outcome,
  sharesIn: bigint,
  tradeFeeBps: bigint = TRADE_FEE_BPS,
): bigint {
  const d = pool.yesReserve + pool.noReserve;
  if (d === 0n || outcome > 1) return 0n;
  let pBefore: bigint;
  let pAfter: bigint;
  if (outcome === OUTCOME_YES) {
    if (sharesIn > pool.noReserve) return 0n;
    pBefore = mulDivDown(pool.noReserve, WAD, d);
    pAfter = mulDivDown(pool.noReserve - sharesIn, WAD, d - sharesIn);
  } else {
    if (sharesIn > pool.yesReserve) return 0n;
    pBefore = mulDivDown(pool.yesReserve, WAD, d);
    pAfter = mulDivDown(pool.yesReserve - sharesIn, WAD, d - sharesIn);
  }
  const gross = mulDivDown(sharesIn, pBefore + pAfter, 2n * WAD);
  return gross - mulDivUp(gross, tradeFeeBps, BPS);
}

/** YES price, scaled by 1e18 */
export function priceYesOffline(pool: { yesReserve: bigint; noReserve: bigint }): bigint {
  const d = pool.yesReserve + pool.noReserve;
  if (d === 0n) return 0n;
  return mulDivDown(pool.noReserve, WAD, d);
}

/* ============================== Main class ============================== */

export class CentralPredictionSDK {
  private readonly transport: Transport;
  private readonly engine: Address;
  private readonly chainId?: number;
  private account?: Address;

  constructor(transport: Transport, config: SDKConfig) {
    if (!isAddress(config.engine)) throw new SdkError("local/NOT_CONNECTED", MESSAGES["local/NOT_CONNECTED"]);
    this.transport = transport;
    this.engine = config.engine;
    this.chainId = config.chainId;
    this.account = config.account;
  }

  /* ---------------------------- Internal reads ---------------------------- */

  private async call(data: Hex, to: Address = this.engine): Promise<string> {
    try {
      const out = await this.transport.ethCall(to, data);
      if (typeof out !== "string" || !HEX_RE.test(out)) {
        throw new SdkError("local/TRANSPORT_ERROR", `${MESSAGES["local/TRANSPORT_ERROR"]} (invalid hex returned)`);
      }
      return out;
    } catch (err) {
      if (err instanceof SdkError) throw err;
      // On-chain revert. Note marketCore still returns zeroes for a missing market, but role lookups can revert.
      if (extractRevertData(err)) throw decodeRevert(err);
      const msg = err instanceof Error ? err.message : String(err);
      throw new SdkError("local/TRANSPORT_ERROR", `${MESSAGES["local/TRANSPORT_ERROR"]} (${msg})`);
    }
  }

  private async boolCall(sig: string, argsHex: string): Promise<boolean> {
    const out = await this.call(sig + argsHex);
    return word(out, 0) !== 0n;
  }

  private async uintCall(sig: string, argsHex: string): Promise<bigint> {
    const out = await this.call(sig + argsHex);
    return word(out, 0);
  }

  private requireAccount(): Address {
    if (!this.account) throw new SdkError("local/ACCOUNT_REQUIRED", MESSAGES["local/ACCOUNT_REQUIRED"]);
    return this.account;
  }

  /* ---------------------------- Read-only views ---------------------------- */

  async marketCore(marketId: Hex): Promise<MarketState> {
    const out = await this.call(SEL.marketCore + bytes32Word(marketId));
    return {
      yesReserve: word(out, 0),
      noReserve: word(out, 1),
      cash: word(out, 2),
      owed: word(out, 3),
      totalVolume: word(out, 4),
      resolutionTime: word(out, 5),
      createdAt: word(out, 6),
      creator: "0x" + strip0x(out).slice(7 * 64 + 24, 8 * 64),
      outcome: Number(word(out, 8)),
      resolved: word(out, 9) !== 0n,
      exists: word(out, 10) !== 0n,
    };
  }

  async resolutionState(marketId: Hex): Promise<{
    resolved: boolean;
    finalized: boolean;
    disputing: boolean;
    outcome: Outcome;
    disputeEndsAt: bigint;
    owed: bigint;
  }> {
    const out = await this.call(SEL.resolutionState + bytes32Word(marketId));
    return {
      resolved: word(out, 0) !== 0n,
      finalized: word(out, 1) !== 0n,
      disputing: word(out, 2) !== 0n,
      outcome: Number(word(out, 3)) as Outcome,
      disputeEndsAt: word(out, 4),
      owed: word(out, 5),
    };
  }

  /* ---------------------------- List-page reads ---------------------------- */

  /** Total market count — the starting point for list pagination */
  async marketCount(): Promise<number> {
    return Number(await this.uintCall(SEL.marketCount, ""));
  }

  /** Market id at index (0-based, paginate alongside marketCount) */
  async marketId(index: number): Promise<Hex> {
    const out = await this.call(SEL.marketIds + uintWord(BigInt(index)));
    return ("0x" + strip0x(out).slice(0, 64)) as Hex;
  }

  /** Market question. Its own view so the list-page struct stays small. */
  async marketQuestion(marketId: Hex): Promise<string> {
    return decodeString(await this.call(SEL.marketQuestion + bytes32Word(marketId)));
  }

  /** Market category */
  async marketCategory(marketId: Hex): Promise<string> {
    return decodeString(await this.call(SEL.marketCategory + bytes32Word(marketId)));
  }

  /** YES price (1e18, i.e. the implied probability) */
  async priceYes(marketId: Hex): Promise<bigint> {
    return this.uintCall(SEL.priceYes, bytes32Word(marketId));
  }

  /** Pool depth = yesReserve + noReserve */
  async depthOf(marketId: Hex): Promise<bigint> {
    return this.uintCall(SEL.depth, bytes32Word(marketId));
  }

  /** Whether the dispute window is over, i.e. redemption is unlocked */
  async isFinal(marketId: Hex): Promise<boolean> {
    return this.boolCall(SEL.isFinal, bytes32Word(marketId));
  }

  /** Whether trading is open right now (exists && !resolved && !paused) */
  async tradingOpen(marketId: Hex): Promise<boolean> {
    return this.boolCall(SEL.tradingOpen, bytes32Word(marketId));
  }

  async sharesOf(marketId: Hex, who?: Address): Promise<{ yes: bigint; no: bigint }> {
    const account = who ?? this.requireAccount();
    const base = bytes32Word(marketId) + addressWord(account);
    return {
      yes: await this.uintCall(SEL.yesOf, base),
      no: await this.uintCall(SEL.noOf, base),
    };
  }

  /* ---------------------------- Batch snapshots (Multicall3) ---------------------------- */

  /**
   * Fetch price / depth / status for many markets in a single RPC round-trip.
   *
   * Goes through Base's **Multicall3** (`0xcA11bde05977b3631167028862bE2a173976CA11`, the same address on
   * Base mainnet and on every major chain), collapsing 4N view calls into one `eth_call`. Extra fields
   * (question, position) belong on demand — never serially await 30 markets just to save effort.
   *
   * Every failure mode degrades: no Multicall deployed, or one sub-call failing, falls back to per-market
   * reads. The batch never fails as a whole.
   *
   * @param ids        Market id list (keep it ≤ 100 per call; response-size limits apply)
   * @param opts.multicall  `false` forces per-market reads; an address overrides the Multicall target
   */
  async marketSnapshots(
    ids: Hex[],
    opts: { multicall?: Address | false; withMeta?: boolean } = {},
  ): Promise<MarketSnapshot[]> {
    if (ids.length === 0) return [];
    const target = opts.multicall === false ? null : (opts.multicall ?? MULTICALL3);
    if (target) {
      try {
        const snaps = await this.snapshotsViaMulticall(ids, target, opts.withMeta === true);
        // A few sub-calls failed (market removed, flaky node): backfill only those
        const missing = snaps.map((s, i) => (s.failed ? i : -1)).filter((i) => i >= 0);
        if (missing.length === 0) return snaps.map(({ failed, ...rest }) => rest as MarketSnapshot);
        await Promise.all(
          missing.map(async (i) => {
            snaps[i] = { ...(await this.snapshotOne(ids[i], opts.withMeta === true)), failed: false };
          }),
        );
        return snaps.map(({ failed, ...rest }) => rest as MarketSnapshot);
      } catch {
        /* No Multicall deployed, or encoding incompatible: degrade silently */
      }
    }
    return Promise.all(ids.map((id) => this.snapshotOne(id, opts.withMeta === true)));
  }

  /** Snapshot of a single market (4 views in parallel) */
  async snapshotOne(marketId: Hex, withMeta = false): Promise<MarketSnapshot> {
    const [core, state, priceYes, depth, question, category] = await Promise.all([
      this.marketCore(marketId),
      this.resolutionState(marketId),
      this.uintCall(SEL.priceYes, bytes32Word(marketId)),
      this.uintCall(SEL.depth, bytes32Word(marketId)),
      withMeta ? this.marketQuestion(marketId) : Promise.resolve(undefined),
      withMeta ? this.marketCategory(marketId) : Promise.resolve(undefined),
    ]);
    return {
      marketId,
      exists: core.exists,
      priceYes,
      priceNo: WAD - priceYes,
      depth,
      yesReserve: core.yesReserve,
      noReserve: core.noReserve,
      resolved: core.resolved,
      finalized: state.finalized,
      disputing: state.disputing,
      outcome: state.outcome,
      disputeEndsAt: state.disputeEndsAt,
      resolutionTime: core.resolutionTime,
      cash: core.cash,
      owed: core.owed,
      totalVolume: core.totalVolume,
      tradingOpen: core.exists && !core.resolved && !(await this.paused()),
      ...(withMeta ? { question, category } : {}),
    };
  }

  private async snapshotsViaMulticall(
    ids: Hex[],
    multicall: Address,
    withMeta: boolean,
  ): Promise<Array<MarketSnapshot & { failed: boolean }>> {
    const stride = withMeta ? 6 : 4;
    const calls: MulticallCall[] = [];
    for (const id of ids) {
      const arg = bytes32Word(id);
      calls.push({ target: this.engine, allowFailure: true, data: (SEL.marketCore + arg) as Hex });
      calls.push({ target: this.engine, allowFailure: true, data: (SEL.resolutionState + arg) as Hex });
      calls.push({ target: this.engine, allowFailure: true, data: (SEL.priceYes + arg) as Hex });
      calls.push({ target: this.engine, allowFailure: true, data: (SEL.depth + arg) as Hex });
      if (withMeta) {
        calls.push({ target: this.engine, allowFailure: true, data: (SEL.marketQuestion + arg) as Hex });
        calls.push({ target: this.engine, allowFailure: true, data: (SEL.marketCategory + arg) as Hex });
      }
    }
    calls.push({ target: this.engine, allowFailure: true, data: SEL.paused as Hex });

    const raw = await this.call(encodeAggregate3(calls), multicall);
    const results = decodeAggregate3Result(raw);
    const pausedIdx = ids.length * stride;
    const pausedNow = results[pausedIdx]?.success ? word(results[pausedIdx].data, 0) !== 0n : false;

    const out: Array<MarketSnapshot & { failed: boolean }> = [];
    for (let i = 0; i < ids.length; i += 1) {
      const base = i * stride;
      const coreRes = results[base];
      const stateRes = results[base + 1];
      const priceRes = results[base + 2];
      const depthRes = results[base + 3];
      const qRes = withMeta ? results[base + 4] : undefined;
      const catRes = withMeta ? results[base + 5] : undefined;
      const ok =
        coreRes?.success &&
        stateRes?.success &&
        priceRes?.success &&
        depthRes?.success &&
        (!withMeta || (qRes?.success && catRes?.success));
      if (!ok) {
        out.push({ ...blankSnapshot(ids[i]), failed: true });
        continue;
      }
      const core = decodeCore(coreRes.data);
      const state = decodeResolution(stateRes.data);
      const priceYes = word(priceRes.data, 0);
      out.push({
        marketId: ids[i],
        exists: core.exists,
        priceYes,
        priceNo: WAD - priceYes,
        depth: word(depthRes.data, 0),
        yesReserve: core.yesReserve,
        noReserve: core.noReserve,
        resolved: core.resolved,
        finalized: state.finalized,
        disputing: state.disputing,
        outcome: state.outcome,
        disputeEndsAt: state.disputeEndsAt,
        resolutionTime: core.resolutionTime,
        cash: core.cash,
        owed: core.owed,
        totalVolume: core.totalVolume,
        tradingOpen: core.exists && !core.resolved && !pausedNow,
        ...(withMeta ? { question: decodeString(qRes!.data), category: decodeString(catRes!.data) } : {}),
        failed: false,
      });
    }
    return out;
  }

  /* ---------------------------- Event logs ---------------------------- */

  /** This engine's address, for the frontend to filter logs by */
  get engineAddress(): Address {
    return this.engine;
  }

  /**
   * Filter a transaction's receipt.logs down to this engine's events and decode them.
   * Frontends can go straight from a hash: `const evs = sdk.decodeReceiptLogs(receipt.logs)`.
   */
  decodeReceiptLogs(logs: RawLog[]): DecodedEvent[] {
    const mine = logs.filter((l) => strip0x(l.address ?? "").toLowerCase() === strip0x(this.engine).toLowerCase());
    return decodeLogs(mine);
  }

  async previewBuy(marketId: Hex, outcome: Outcome, amountIn: bigint): Promise<bigint> {
    const arg = bytes32Word(marketId) + uintWord(BigInt(outcome)) + uintWord(amountIn);
    return this.uintCall(SEL.previewBuy, arg);
  }

  async previewSell(marketId: Hex, outcome: Outcome, sharesIn: bigint): Promise<bigint> {
    const arg = bytes32Word(marketId) + uintWord(BigInt(outcome)) + uintWord(sharesIn);
    return this.uintCall(SEL.previewSell, arg);
  }

  async paused(): Promise<boolean> {
    return this.boolCall(SEL.paused, "");
  }

  async isCreator(addr?: Address): Promise<boolean> {
    const who = addr ?? this.requireAccount();
    return this.boolCall(SEL.creators, addressWord(who));
  }

  async isOracle(addr?: Address): Promise<boolean> {
    const who = addr ?? this.requireAccount();
    return this.boolCall(SEL.oracles, addressWord(who));
  }

  /**
   * Permission check identical to the contract's `onlyCreator`: the admin also holds creation rights.
   * (The contract tests `msg.sender != admin && !creators[msg.sender]`, so a creators-only check is wrong.)
   */
  async canCreate(addr?: Address): Promise<boolean> {
    const who = addr ?? this.requireAccount();
    const [role, adminAddr] = await Promise.all([this.isCreator(who), this.admin()]);
    return role || who.toLowerCase() === adminAddr.toLowerCase();
  }

  /** Matches the contract's `onlyOracle`: the admin also holds resolution rights */
  async canOracle(addr?: Address): Promise<boolean> {
    const who = addr ?? this.requireAccount();
    const [role, adminAddr] = await Promise.all([this.isOracle(who), this.admin()]);
    return role || who.toLowerCase() === adminAddr.toLowerCase();
  }

  async admin(): Promise<Address> {
    const out = await this.call(SEL.admin);
    return "0x" + strip0x(out).slice(24);
  }

  async constants(): Promise<{
    minBet: bigint;
    maxBet: bigint;
    minTradingWindow: bigint;
    maxTradingWindow: bigint;
    disputeWindow: bigint;
    refundDelay: bigint;
    tradeFeeBps: bigint;
    settleFeeBps: bigint;
  }> {
    return {
      minBet: await this.uintCall(SEL.minBet, ""),
      maxBet: await this.uintCall(SEL.maxBet, ""),
      minTradingWindow: await this.uintCall(SEL.minTradingWindow, ""),
      maxTradingWindow: await this.uintCall(SEL.maxTradingWindow, ""),
      disputeWindow: await this.uintCall(SEL.disputeWindow, ""),
      refundDelay: await this.uintCall(SEL.refundDelay, ""),
      tradeFeeBps: await this.uintCall(SEL.tradeFeeBps, ""),
      settleFeeBps: await this.uintCall(SEL.settleFeeBps, ""),
    };
  }

  /* ---------------------------- Shared validation ---------------------------- */

  private assertOutcome(outcome: number): asserts outcome is Outcome {
    if (![0, 1, 2].includes(outcome)) throw new SdkError("local/BAD_OUTCOME", MESSAGES["local/BAD_OUTCOME"]);
  }

  private assertAmount(v: bigint | number, label = "amount"): bigint {
    const n = typeof v === "bigint" ? v : BigInt(Math.trunc(v));
    if (n <= 0n) throw new SdkError("local/BAD_AMOUNT", `${label} must be greater than 0`);
    return n;
  }

  /**
   * Hard validation of minSharesOut / minAmountOut — the core defence of this SDK:
   *   0            → reject (no unprotected order)
   *   > quote      → reject (the trade cannot fill)
   *   < quote*95%  → reject (tolerance beyond 5% is no protection at all)
   */
  private assertMinOut(minOut: bigint | number, quote: bigint, label: string): bigint {
    const n = typeof minOut === "bigint" ? minOut : BigInt(Math.trunc(minOut));
    if (n <= 0n) throw new SdkError("local/MIN_OUT_REQUIRED", `${label}: ${MESSAGES["local/MIN_OUT_REQUIRED"]}`);
    if (quote === 0n) throw new SdkError("local/BAD_AMOUNT", "Quote is 0, so no protection floor can be derived");
    if (n > quote) {
      throw new SdkError(
        "local/MIN_OUT_ABOVE_QUOTE",
        `${label}: ${MESSAGES["local/MIN_OUT_ABOVE_QUOTE"]} (min=${n} / quote=${quote})`,
      );
    }
    const floor = (quote * (BPS - MAX_SLIPPAGE_BPS)) / BPS;
    if (n < floor) {
      throw new SdkError(
        "local/SLIPPAGE_TOO_LOOSE",
        `${label}: ${MESSAGES["local/SLIPPAGE_TOO_LOOSE"]} (min=${n} < quote×95%=${floor})`,
      );
    }
    return n;
  }

  /** Derive the protection floor from quote + slippage, rounding down — always the side that favours the user */
  static minOutFromQuote(quote: bigint, slippageBps: bigint | number): bigint {
    const bps = typeof slippageBps === "bigint" ? slippageBps : BigInt(Math.trunc(slippageBps));
    if (bps < MIN_SLIPPAGE_BPS || bps > MAX_SLIPPAGE_BPS) {
      throw new SdkError("local/SLIPPAGE_OUT_OF_RANGE", MESSAGES["local/SLIPPAGE_OUT_OF_RANGE"]);
    }
    return (quote * (BPS - bps)) / BPS;
  }

  /* ---------------------------- Create market ---------------------------- */

  /**
   * Create a market. With `meta.category` present this routes to createMarketWithMeta (4 args),
   * otherwise to createMarket (3 args). The new engine has no 6-arg createMarket (that was the old
   * factory); see docs/CENTRAL-SDK-GUIDE.md for the signature table.
   */
  async buildCreateMarket(input: {
    marketId: Hex;
    question: string;
    resolutionTime: bigint | number;
    meta?: { category?: string };
  }): Promise<TxPlan> {
    if (!isBytes32(input.marketId)) throw new SdkError("local/BAD_BYTES32", MESSAGES["local/BAD_BYTES32"]);
    const qBytes = utf8Length(input.question);
    if (qBytes < 8 || qBytes > 280) {
      throw new SdkError("local/QUESTION_LENGTH", `${MESSAGES["local/QUESTION_LENGTH"]} (currently ${qBytes} bytes)`);
    }
    const category = input.meta?.category;
    if (category !== undefined) {
      const cBytes = utf8Length(category);
      if (cBytes < 1 || cBytes > 32) {
        throw new SdkError("local/CATEGORY_LENGTH", `${MESSAGES["local/CATEGORY_LENGTH"]} (currently ${cBytes} bytes)`);
      }
    }

    const account = this.requireAccount();
    const [core, canCreate, k] = await Promise.all([
      this.marketCore(input.marketId),
      this.canCreate(account),
      this.constants(),
    ]);
    if (core.exists) throw new SdkError("local/MARKET_EXISTS", MESSAGES["local/MARKET_EXISTS"]);
    if (!canCreate) throw new SdkError("local/NOT_CREATOR", MESSAGES["local/NOT_CREATOR"]);

    const resolutionTime = BigInt(input.resolutionTime);
    const now = await this.chainNow();
    if (resolutionTime <= now + k.minTradingWindow || resolutionTime > now + k.maxTradingWindow) {
      throw new SdkError("local/RESOLUTION_TIME_RANGE", MESSAGES["local/RESOLUTION_TIME_RANGE"]);
    }

    let data: Hex;
    let method: string;
    if (category === undefined) {
      // head: marketId, offset(=0x60), resolutionTime ; tail: len + bytes
      const tail = encodeString(input.question);
      data =
        SEL.createMarket +
        bytes32Word(input.marketId) +
        uintWord(0x60n) +
        uintWord(resolutionTime) +
        tail.body;
      method = "createMarket";
    } else {
      // head: marketId, offQ(=0x80), offCat, resolutionTime ; tail: q, cat
      const q = encodeString(input.question);
      const cat = encodeString(category);
      const offCat = 0x80n + BigInt(q.words * 32);
      data =
        SEL.createMarketWithMeta +
        bytes32Word(input.marketId) +
        uintWord(0x80n) +
        uintWord(offCat) +
        uintWord(resolutionTime) +
        q.body +
        cat.body;
      method = "createMarketWithMeta";
    }

    return {
      to: this.engine,
      data,
      value: "0x0",
      method,
      summary: `Create market "${input.question}", resolution time ${new Date(Number(resolutionTime) * 1000).toISOString()}`,
      meta: {
        marketId: input.marketId,
        question: input.question,
        category: category ?? "general",
        resolutionTime: resolutionTime.toString(),
        questionBytes: qBytes,
      },
    };
  }

  /* ---------------------------- Buy ---------------------------- */

  /**
   * Buy shares.
   *  - `slippageBps`: the recommended path; the floor is derived from the live quote (1..500 bps)
   *  - `minSharesOut`: when passed explicitly it must still land inside [quote×95%, quote]
   *  When both are supplied, the stricter (larger) minSharesOut wins.
   */
  async buildBuyShares(input: {
    marketId: Hex;
    outcome: Outcome;
    amountIn: bigint | number;
    minSharesOut?: bigint | number;
    slippageBps?: bigint | number;
  }): Promise<TxPlan> {
    this.assertOutcome(input.outcome);
    const amountIn = this.assertAmount(input.amountIn, "amountIn");
    if (input.minSharesOut === undefined && input.slippageBps === undefined) {
      throw new SdkError(
        "local/MIN_OUT_REQUIRED",
        "Provide minSharesOut or slippageBps — without a floor a sandwicher fills you at any price",
      );
    }

    const account = this.requireAccount();
    const [core, paused, k, onchainQuote] = await Promise.all([
      this.marketCore(input.marketId),
      this.paused(),
      this.constants(),
      this.previewBuy(input.marketId, input.outcome, amountIn),
    ]);
    if (!core.exists) throw new SdkError("local/MARKET_NOT_FOUND", MESSAGES["local/MARKET_NOT_FOUND"]);
    if (core.resolved) throw new SdkError("local/MARKET_RESOLVED", MESSAGES["local/MARKET_RESOLVED"]);
    const now = await this.chainNow();
    if (now >= core.resolutionTime) throw new SdkError("local/TRADING_CLOSED", MESSAGES["local/TRADING_CLOSED"]);
    if (paused) throw new SdkError("local/MARKET_PAUSED", MESSAGES["local/MARKET_PAUSED"]);
    if (amountIn < k.minBet) throw new SdkError("chain/BELOW_MIN_BET", `Below the minimum bet (${k.minBet} base units)`);
    if (amountIn > k.maxBet) throw new SdkError("chain/ABOVE_MAX_BET", `Above the per-trade cap (${k.maxBet} base units)`);

    const depth = core.yesReserve + core.noReserve;
    const impactCap = mulDivDown(depth, MAX_IMPACT_BPS, BPS);
    if (amountIn > impactCap) {
      throw new SdkError(
        "chain/IMPACT_TOO_HIGH",
        `${MESSAGES["chain/IMPACT_TOO_HIGH"]} (this order ${amountIn} > cap ${impactCap})`,
      );
    }
    const impactBps = depth === 0n ? 0n : (amountIn * BPS) / depth;

    // Recompute locally with the same formula to catch ABI/model drift
    const localQuote = previewBuyOffline({ yesReserve: core.yesReserve, noReserve: core.noReserve }, input.outcome, amountIn, k.tradeFeeBps);
    if (localQuote !== onchainQuote) {
      throw new SdkError(
        "local/QUOTE_MISMATCH",
        `${MESSAGES["local/QUOTE_MISMATCH"]} (local ${localQuote} / on-chain ${onchainQuote})`,
      );
    }
    if (onchainQuote === 0n) throw new SdkError("chain/ZERO_SHARES", MESSAGES["chain/ZERO_SHARES"]);

    const candidates: bigint[] = [];
    if (input.slippageBps !== undefined) {
      candidates.push(CentralPredictionSDK.minOutFromQuote(onchainQuote, input.slippageBps));
    }
    if (input.minSharesOut !== undefined) {
      candidates.push(this.assertMinOut(input.minSharesOut, onchainQuote, "minSharesOut"));
    }
    const minSharesOut = candidates.reduce((a, b) => (a > b ? a : b));

    return {
      to: this.engine,
      data:
        SEL.buyShares +
        bytes32Word(input.marketId) +
        uintWord(BigInt(input.outcome)) +
        uintWord(amountIn) +
        uintWord(minSharesOut),
      value: "0x0",
      method: "buyShares",
      summary: `Buy ${input.outcome === OUTCOME_YES ? "YES" : "NO"}: pay ${formatUsdc(amountIn)} USDC, receive at least ${minSharesOut.toString()} shares (quote ${onchainQuote.toString()})`,
      meta: {
        marketId: input.marketId,
        outcome: input.outcome === OUTCOME_YES ? "YES" : "NO",
        amountIn: amountIn.toString(),
        quote: onchainQuote.toString(),
        minSharesOut: minSharesOut.toString(),
        quotedAt: Date.now(),
        priceYes: priceYesOffline(core).toString(),
        impactBps: impactBps.toString(),
        account,
      },
      ...(impactBps >= IMPACT_WARN_BPS ? { warning: "impact_near_limit" as const } : {}),
    };
  }

  /* ---------------------------- Sell ---------------------------- */

  async buildSellShares(input: {
    marketId: Hex;
    outcome: Outcome;
    sharesIn: bigint | number;
    minAmountOut?: bigint | number;
    slippageBps?: bigint | number;
  }): Promise<TxPlan> {
    this.assertOutcome(input.outcome);
    const sharesIn = this.assertAmount(input.sharesIn, "sharesIn");
    if (input.minAmountOut === undefined && input.slippageBps === undefined) {
      throw new SdkError(
        "local/MIN_OUT_REQUIRED",
        "Provide minAmountOut or slippageBps — without a floor a sandwicher fills you at any price",
      );
    }

    const account = this.requireAccount();
    const [core, paused, k, holdings, onchainQuote] = await Promise.all([
      this.marketCore(input.marketId),
      this.paused(),
      this.constants(),
      this.sharesOf(input.marketId, account),
      this.previewSell(input.marketId, input.outcome, sharesIn),
    ]);
    if (!core.exists) throw new SdkError("local/MARKET_NOT_FOUND", MESSAGES["local/MARKET_NOT_FOUND"]);
    if (core.resolved) throw new SdkError("local/MARKET_RESOLVED", MESSAGES["local/MARKET_RESOLVED"]);
    const now = await this.chainNow();
    if (now >= core.resolutionTime) throw new SdkError("local/TRADING_CLOSED", MESSAGES["local/TRADING_CLOSED"]);
    if (paused) throw new SdkError("local/MARKET_PAUSED", MESSAGES["local/MARKET_PAUSED"]);

    const held = input.outcome === OUTCOME_YES ? holdings.yes : holdings.no;
    if (sharesIn > held) {
      throw new SdkError(
        "local/INSUFFICIENT_SHARES",
        `${MESSAGES["local/INSUFFICIENT_SHARES"]} (holding ${held}, trying to sell ${sharesIn})`,
      );
    }
    const depth = core.yesReserve + core.noReserve;
    const impactCap = mulDivDown(depth, MAX_IMPACT_BPS, BPS);
    const impactBps = depth === 0n ? 0n : (sharesIn * BPS) / depth;
    if (sharesIn > impactCap) {
      throw new SdkError(
        "chain/IMPACT_TOO_HIGH",
        `${MESSAGES["chain/IMPACT_TOO_HIGH"]} (this order ${sharesIn} > cap ${impactCap})`,
      );
    }

    const localQuote = previewSellOffline({ yesReserve: core.yesReserve, noReserve: core.noReserve }, input.outcome, sharesIn, k.tradeFeeBps);
    if (localQuote !== onchainQuote) {
      throw new SdkError(
        "local/QUOTE_MISMATCH",
        `${MESSAGES["local/QUOTE_MISMATCH"]} (local ${localQuote} / on-chain ${onchainQuote})`,
      );
    }
    if (onchainQuote === 0n) throw new SdkError("chain/ZERO_SHARES", MESSAGES["chain/ZERO_SHARES"]);

    const candidates: bigint[] = [];
    if (input.slippageBps !== undefined) {
      candidates.push(CentralPredictionSDK.minOutFromQuote(onchainQuote, input.slippageBps));
    }
    if (input.minAmountOut !== undefined) {
      candidates.push(this.assertMinOut(input.minAmountOut, onchainQuote, "minAmountOut"));
    }
    const minAmountOut = candidates.reduce((a, b) => (a > b ? a : b));

    return {
      to: this.engine,
      data:
        SEL.sellShares +
        bytes32Word(input.marketId) +
        uintWord(BigInt(input.outcome)) +
        uintWord(sharesIn) +
        uintWord(minAmountOut),
      value: "0x0",
      method: "sellShares",
      summary: `Sell ${sharesIn.toString()} ${input.outcome === OUTCOME_YES ? "YES" : "NO"} shares for at least ${formatUsdc(minAmountOut)} USDC (quote ${formatUsdc(onchainQuote)})`,
      meta: {
        marketId: input.marketId,
        outcome: input.outcome === OUTCOME_YES ? "YES" : "NO",
        sharesIn: sharesIn.toString(),
        quote: onchainQuote.toString(),
        minAmountOut: minAmountOut.toString(),
        quotedAt: Date.now(),
        held: held.toString(),
        impactBps: impactBps.toString(),
        account,
      },
      ...(impactBps >= IMPACT_WARN_BPS ? { warning: "impact_near_limit" as const } : {}),
    };
  }

  /* ---------------------------- Redeem ---------------------------- */

  async buildRedeem(input: { marketId: Hex }): Promise<TxPlan> {
    const account = this.requireAccount();
    const [core, state, holdings, paused, k] = await Promise.all([
      this.marketCore(input.marketId),
      this.resolutionState(input.marketId),
      this.sharesOf(input.marketId, account),
      this.paused(),
      this.constants(),
    ]);
    if (!core.exists) throw new SdkError("local/MARKET_NOT_FOUND", MESSAGES["local/MARKET_NOT_FOUND"]);
    if (!state.resolved) throw new SdkError("local/MARKET_NOT_RESOLVED", MESSAGES["local/MARKET_NOT_RESOLVED"]);
    if (!state.finalized) {
      const endsAt = new Date(Number(state.disputeEndsAt) * 1000).toISOString();
      throw new SdkError(
        "chain/DISPUTE_WINDOW_OPEN",
        `${MESSAGES["chain/DISPUTE_WINDOW_OPEN"]} (window ends ${endsAt}; the Safe can still override)`,
      );
    }
    if (holdings.yes === 0n && holdings.no === 0n) {
      throw new SdkError("chain/NOTHING_TO_REDEEM", MESSAGES["chain/NOTHING_TO_REDEEM"]);
    }
    if (paused) {
      const now = await this.chainNow();
      // Matches the contract's redeemGuard: past resolution + 7 days, the pause is ignored
      if (now < core.resolutionTime + k.refundDelay) throw new SdkError("local/MARKET_PAUSED", MESSAGES["local/MARKET_PAUSED"]);
    }

    const label = state.outcome === OUTCOME_INVALID ? "INVALID market (pays 0.5 per side)" : state.outcome === OUTCOME_YES ? "YES winner" : "NO winner";
    return {
      to: this.engine,
      data: SEL.redeem + bytes32Word(input.marketId),
      value: "0x0",
      method: "redeem",
      summary: `Redeem ${label}: YES ${holdings.yes.toString()} / NO ${holdings.no.toString()} shares`,
      meta: {
        marketId: input.marketId,
        outcome: state.outcome,
        yesShares: holdings.yes.toString(),
        noShares: holdings.no.toString(),
        account,
      },
    };
  }

  /* ---------------------------- Resolution ---------------------------- */

  async buildResolveMarket(input: { marketId: Hex; outcome: Outcome }): Promise<TxPlan> {
    this.assertOutcome(input.outcome);
    const account = this.requireAccount();
    const [core, state, canOracle, now] = await Promise.all([
      this.marketCore(input.marketId),
      this.resolutionState(input.marketId),
      this.canOracle(account),
      this.chainNow(),
    ]);
    if (!core.exists) throw new SdkError("local/MARKET_NOT_FOUND", MESSAGES["local/MARKET_NOT_FOUND"]);
    if (!canOracle) throw new SdkError("local/NOT_ORACLE", MESSAGES["local/NOT_ORACLE"]);
    if (state.resolved) throw new SdkError("local/MARKET_RESOLVED", MESSAGES["local/MARKET_RESOLVED"]);
    if (now < core.resolutionTime) {
      throw new SdkError(
        "chain/TOO_EARLY_TO_RESOLVE",
        `${MESSAGES["chain/TOO_EARLY_TO_RESOLVE"]} (resolution time ${new Date(Number(core.resolutionTime) * 1000).toISOString()})`,
      );
    }

    const k = await this.constants();
    return {
      to: this.engine,
      data: SEL.resolveMarket + bytes32Word(input.marketId) + uintWord(BigInt(input.outcome)),
      value: "0x0",
      method: "resolveMarket",
      summary: `Resolve as ${outcomeLabel(input.outcome)}; this opens a ${k.disputeWindow / 3600n}-hour dispute window during which redemption is locked`,
      meta: {
        marketId: input.marketId,
        outcome: input.outcome,
        disputeWindow: k.disputeWindow.toString(),
        account,
      },
    };
  }

  async buildOverrideResolution(input: { marketId: Hex; newOutcome: Outcome }): Promise<TxPlan> {
    this.assertOutcome(input.newOutcome);
    const account = this.requireAccount();
    const [core, state, admin] = await Promise.all([
      this.marketCore(input.marketId),
      this.resolutionState(input.marketId),
      this.admin(),
    ]);
    if (!core.exists) throw new SdkError("local/MARKET_NOT_FOUND", MESSAGES["local/MARKET_NOT_FOUND"]);
    if (account.toLowerCase() !== admin.toLowerCase()) {
      throw new SdkError("local/NOT_ADMIN", `${MESSAGES["local/NOT_ADMIN"]} (admin=${admin})`);
    }
    if (!state.resolved) throw new SdkError("local/MARKET_NOT_RESOLVED", MESSAGES["local/MARKET_NOT_RESOLVED"]);
    if (state.finalized) throw new SdkError("local/ALREADY_FINAL", MESSAGES["local/ALREADY_FINAL"]);
    if (!state.disputing) throw new SdkError("local/NOT_DISPUTING", MESSAGES["local/NOT_DISPUTING"]);
    if (state.outcome === input.newOutcome) throw new SdkError("local/SAME_OUTCOME", MESSAGES["local/SAME_OUTCOME"]);

    return {
      to: this.engine,
      data: SEL.overrideResolution + bytes32Word(input.marketId) + uintWord(BigInt(input.newOutcome)),
      value: "0x0",
      method: "overrideResolution",
      summary: `Override inside the dispute window: ${outcomeLabel(state.outcome)} → ${outcomeLabel(input.newOutcome)} (the window is not extended)`,
      meta: {
        marketId: input.marketId,
        fromOutcome: state.outcome,
        toOutcome: input.newOutcome,
        disputeEndsAt: state.disputeEndsAt.toString(),
        account,
      },
    };
  }

  /* ---------------------------- Quote freshness ---------------------------- */

  /**
   * Second gate: re-fetch the quote immediately before signing/sending and abort if the price has
   * already fallen outside the protection floor (nothing is sent). This is the anti-sandwich backstop;
   * the first line of defence remains minSharesOut itself.
   */
  async confirmQuoteStillValid(plan: TxPlan, maxAgeMs = 2_000): Promise<void> {
    if (plan.method !== "buyShares" && plan.method !== "sellShares") return;
    const marketId = String(plan.meta.marketId) as Hex;
    const outcome = plan.meta.outcome === "YES" ? OUTCOME_YES : OUTCOME_NO;
    const stamped = Number(plan.meta.quotedAt ?? 0);
    if (stamped && Date.now() - stamped > maxAgeMs) {
      throw new SdkError(
        "local/SLIPPAGE_TOO_LOOSE",
        `Quote expired (${Date.now() - stamped}ms > ${maxAgeMs}ms). Refresh the quote before signing.`,
      );
    }
    if (plan.method === "buyShares") {
      const amountIn = BigInt(String(plan.meta.amountIn));
      const minSharesOut = BigInt(String(plan.meta.minSharesOut));
      const fresh = await this.previewBuy(marketId, outcome, amountIn);
      if (fresh < minSharesOut) {
        throw new SdkError(
          "chain/SLIPPAGE_EXCEEDED",
          `Price moved: only ${fresh} shares available now, below the protection floor ${minSharesOut}. Aborted.`,
        );
      }
    } else {
      const sharesIn = BigInt(String(plan.meta.sharesIn));
      const minAmountOut = BigInt(String(plan.meta.minAmountOut));
      const fresh = await this.previewSell(marketId, outcome, sharesIn);
      if (fresh < minAmountOut) {
        throw new SdkError(
          "chain/SLIPPAGE_EXCEEDED",
          `Price moved: the sell would now return only ${fresh} base units, below the protection floor ${minAmountOut}. Aborted.`,
        );
      }
    }
  }

  /* ---------------------------- Time ---------------------------- */

  /**
   * On-chain time. Every time comparison in the contract uses block.timestamp while the local wall
   * clock can disagree (fast-forwarded test chains, drifting node clocks), so ask the chain first.
   */
  private async chainNow(): Promise<bigint> {
    if (this.transport.now) {
      try {
        const v = await this.transport.now();
        return BigInt(v);
      } catch {
        /* fall back to the wall clock */
      }
    }
    return BigInt(Math.floor(Date.now() / 1000));
  }
}

/* ============================== Utilities ============================== */

export function outcomeLabel(o: number): string {
  return o === OUTCOME_YES ? "YES" : o === OUTCOME_NO ? "NO" : "INVALID";
}

/** 6-decimal USDC base units → human-readable amount */
export function formatUsdc(v: bigint, decimals = 6): string {
  const s = v.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

/** Human-readable USDC → base units (rejects more than 6 decimals) */
export function parseUsdc(v: string | number, decimals = 6): bigint {
  const str = typeof v === "number" ? v.toFixed(decimals) : v.trim();
  if (!/^\d+(\.\d+)?$/.test(str)) throw new SdkError("local/BAD_AMOUNT", `Unparseable USDC amount: ${str}`);
  const [int, frac = ""] = str.split(".");
  if (frac.length > decimals) throw new SdkError("local/BAD_AMOUNT", `USDC supports at most ${decimals} decimals`);
  return BigInt(int + frac.padEnd(decimals, "0"));
}


/* ============================== Multicall3 ============================== */

/** Multicall3, deployed at the same address on Base and every major chain */
export const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";
/** aggregate3((address,bool,bytes)[]) */
export const SEL_AGGREGATE3: Hex = "0x82ad56cb";

export interface MulticallCall {
  target: Address;
  allowFailure: boolean;
  data: Hex;
}

export interface MulticallResult {
  success: boolean;
  data: Hex;
}

/** Every field a list page needs for one market, fetched in a single RPC */
export interface MarketSnapshot {
  marketId: Hex;
  exists: boolean;
  /** 1e18 fixed point: multiply by 100 to get a percentage */
  priceYes: bigint;
  priceNo: bigint;
  /** yesReserve + noReserve, in 6-decimal USDC base units */
  depth: bigint;
  /** Both pool reserves; the frontend needs them for offline pricing */
  yesReserve: bigint;
  noReserve: bigint;
  resolved: boolean;
  finalized: boolean;
  disputing: boolean;
  outcome: Outcome;
  disputeEndsAt: bigint;
  resolutionTime: bigint;
  cash: bigint;
  owed: bigint;
  totalVolume: bigint;
  tradingOpen: boolean;
  /** Only present when withMeta: true */
  question?: string;
  category?: string;
}

/** Encode `aggregate3([(address,bool,bytes)...])` — the array holds dynamic tuples, so mind both offset levels */
export function encodeAggregate3(calls: MulticallCall[]): Hex {
  const head: string[] = [];
  const bodies: string[] = [];
  for (const c of calls) {
    const bytesHex = strip0x(c.data);
    const len = bytesHex.length / 2;
    const padded = bytesHex.padEnd(Math.ceil(bytesHex.length / 64) * 64, "0");
    // Inside the tuple: address, bool, offset-to-bytes (=0x60)
    bodies.push(addressWord(c.target) + uintWord(c.allowFailure ? 1n : 0n) + uintWord(96n) + uintWord(BigInt(len)) + padded);
  }
  // Element offsets are relative to the start of the array body (after the length word)
  let cursor = 32 * calls.length;
  for (const b of bodies) {
    head.push(uintWord(BigInt(cursor)));
    cursor += b.length / 2;
  }
  return (SEL_AGGREGATE3 + uintWord(32n) + uintWord(BigInt(calls.length)) + head.join("") + bodies.join("")) as Hex;
}

/** Decode the `(bool,bytes)[]` return value of aggregate3 */
export function decodeAggregate3Result(raw: string): MulticallResult[] {
  const body = strip0x(raw);
  if (body.length < 64) return [];
  const arrOff = Number(BigInt("0x" + body.slice(0, 64))) * 2;
  const n = Number(BigInt("0x" + body.slice(arrOff, arrOff + 64)));
  const offsetsBase = arrOff + 64; // element offsets are relative to here
  const out: MulticallResult[] = [];
  for (let i = 0; i < n; i += 1) {
    const rel = Number(BigInt("0x" + body.slice(offsetsBase + i * 64, offsetsBase + (i + 1) * 64))) * 2;
    const elem = offsetsBase + rel;
    const success = BigInt("0x" + body.slice(elem, elem + 64)) !== 0n;
    const bytesRel = Number(BigInt("0x" + body.slice(elem + 64, elem + 128))) * 2;
    if (!success) {
      out.push({ success: false, data: "0x" });
      continue;
    }
    const lenPos = elem + bytesRel;
    const len = Number(BigInt("0x" + body.slice(lenPos, lenPos + 64)));
    out.push({ success: true, data: ("0x" + body.slice(lenPos + 64, lenPos + 64 + len * 2)) as Hex });
  }
  return out;
}

function blankSnapshot(marketId: Hex): MarketSnapshot {
  return {
    marketId,
    exists: false,
    priceYes: 0n,
    priceNo: 0n,
    depth: 0n,
    yesReserve: 0n,
    noReserve: 0n,
    resolved: false,
    finalized: false,
    disputing: false,
    outcome: 0 as Outcome,
    disputeEndsAt: 0n,
    resolutionTime: 0n,
    cash: 0n,
    owed: 0n,
    totalVolume: 0n,
    tradingOpen: false,
  };
}

function decodeCore(raw: string): MarketState {
  return {
    yesReserve: word(raw, 0),
    noReserve: word(raw, 1),
    cash: word(raw, 2),
    owed: word(raw, 3),
    totalVolume: word(raw, 4),
    resolutionTime: word(raw, 5),
    createdAt: word(raw, 6),
    creator: "0x" + strip0x(raw).slice(7 * 64 + 24, 8 * 64),
    outcome: Number(word(raw, 8)),
    resolved: word(raw, 9) !== 0n,
    exists: word(raw, 10) !== 0n,
  };
}

function decodeResolution(raw: string): {
  resolved: boolean;
  finalized: boolean;
  disputing: boolean;
  outcome: Outcome;
  disputeEndsAt: bigint;
  owed: bigint;
} {
  return {
    resolved: word(raw, 0) !== 0n,
    finalized: word(raw, 1) !== 0n,
    disputing: word(raw, 2) !== 0n,
    outcome: Number(word(raw, 3)) as Outcome,
    disputeEndsAt: word(raw, 4),
    owed: word(raw, 5),
  };
}

/* ============================== Event decoding ============================== */

/**
 * topic0 of all 19 engine events — each computed with `cast keccak "<signature>"` and re-derived
 * per event in the suite (nothing here is hand-copied).
 */
export const EVENT_TOPICS = {
  MarketCreated: "0x3d0c3bb1f9482c4ad3a5509d3d6d54de6d32d5a1b985684b26c87f30397a1444",
  MarketCategoryUpdated: "0x4b7bc008a5a283c9e7ae3cb79b48e3bff45e0342c20bcd256bddc0d86235ff58",
  LiquiditySeeded: "0x7f2255e9a045f5c484fedb7a134714970baf201bf2fc91137b57c9cea9107abf",
  SharesBought: "0xf21c4ac9a2ac6238a9a299dec03abcc164b74fa85e7d949380f9d657a08f5fa9",
  SharesSold: "0xbd3359e97cfa42d22e4990274c9d107f729226723ce88917de14e1b1d6eab510",
  MarketResolved: "0xdc6b74a8565b9b4f27a28d1db787d3642a813a7c95076b6852565d1f20f97dd4",
  DisputeWindowOpened: "0xcaa830a2de04c83ebc48cb202b8975002881745aaf7d4ff0f8bf598fbb178582",
  ResolutionOverridden: "0xb6da6c9439220c2f1d5c953a57d5ae11c04911a2fd99466c0acb24ef4791275d",
  ResolutionFinalized: "0xc1b5f003dd9f01f287f7e67954b5104c2edb995fb6944923625f17aede11d557",
  Redeemed: "0xce1753e289e102c9616153276d541a05a0cb177b21ebeb8f60b5a877ac9a332f",
  ResidualSwept: "0x00b30742a93ffbccc887d87b2b5b201e2361bc0fab8cf019da636127d31bc41b",
  FeeVaultUpdated: "0x47ffc4777a9849fd88ac272225845f7bbcfa9920f222b459c2e6b28156ce7249",
  TreasuryUpdated: "0x4ab5be82436d353e61ca18726e984e561f5c1cc7c6d38b29d2553c790434705a",
  CreatorUpdated: "0x410c2ab87e0e64123dd9801d714205b45a1c84823591e05076b37449379427fc",
  OracleUpdated: "0x94c9cbe1d9aa7af08484f82ab0179d6db973a391236668c34192d954ff32c06c",
  Paused: "0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258",
  Unpaused: "0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa",
  AdminTransferStarted: "0xe5cd1c804f1c9cc6d7009e4c0fb532f0e2d8863524c3323a6b3790c3f80bf25c",
  AdminTransferred: "0xf8ccb027dfcd135e000e9d45e6cc2d662578a8825d4c45b5e32e0adf67e79ec6",
} as const;

export type EventName = keyof typeof EVENT_TOPICS;
type FieldType = "bytes32" | "address" | "uint256" | "uint8" | "bool" | "string";

interface FieldSpec {
  name: string;
  type: FieldType;
  indexed: boolean;
}

const EVENT_FIELDS: Record<EventName, FieldSpec[]> = {
  MarketCreated: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "creator", type: "address", indexed: true },
    { name: "question", type: "string", indexed: false },
    { name: "category", type: "string", indexed: false },
    { name: "resolutionTime", type: "uint256", indexed: false },
  ],
  MarketCategoryUpdated: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "category", type: "string", indexed: false },
  ],
  LiquiditySeeded: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "provider", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ],
  SharesBought: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "buyer", type: "address", indexed: true },
    { name: "outcome", type: "uint8", indexed: false },
    { name: "amountIn", type: "uint256", indexed: false },
    { name: "fee", type: "uint256", indexed: false },
    { name: "sharesOut", type: "uint256", indexed: false },
    { name: "priceYes", type: "uint256", indexed: false },
  ],
  SharesSold: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "seller", type: "address", indexed: true },
    { name: "outcome", type: "uint8", indexed: false },
    { name: "sharesIn", type: "uint256", indexed: false },
    { name: "fee", type: "uint256", indexed: false },
    { name: "amountOut", type: "uint256", indexed: false },
    { name: "priceYes", type: "uint256", indexed: false },
  ],
  MarketResolved: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "outcome", type: "uint8", indexed: false },
    { name: "resolvedAt", type: "uint256", indexed: false },
    { name: "emergency", type: "bool", indexed: false },
    { name: "owed", type: "uint256", indexed: false },
  ],
  DisputeWindowOpened: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "outcome", type: "uint8", indexed: false },
    { name: "disputeEndsAt", type: "uint256", indexed: false },
    { name: "owed", type: "uint256", indexed: false },
  ],
  ResolutionOverridden: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "oldOutcome", type: "uint8", indexed: false },
    { name: "newOutcome", type: "uint8", indexed: false },
    { name: "newOwed", type: "uint256", indexed: false },
    { name: "disputes", type: "uint8", indexed: false },
  ],
  ResolutionFinalized: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "outcome", type: "uint8", indexed: false },
    { name: "finalizedAt", type: "uint256", indexed: false },
  ],
  Redeemed: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "account", type: "address", indexed: true },
    { name: "yesBurned", type: "uint256", indexed: false },
    { name: "noBurned", type: "uint256", indexed: false },
    { name: "payout", type: "uint256", indexed: false },
    { name: "fee", type: "uint256", indexed: false },
  ],
  ResidualSwept: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ],
  FeeVaultUpdated: [
    { name: "oldVault", type: "address", indexed: true },
    { name: "newVault", type: "address", indexed: true },
  ],
  TreasuryUpdated: [
    { name: "oldTreasury", type: "address", indexed: true },
    { name: "newTreasury", type: "address", indexed: true },
  ],
  CreatorUpdated: [
    { name: "creator", type: "address", indexed: true },
    { name: "allowed", type: "bool", indexed: false },
  ],
  OracleUpdated: [
    { name: "oracle", type: "address", indexed: true },
    { name: "allowed", type: "bool", indexed: false },
  ],
  Paused: [{ name: "account", type: "address", indexed: false }],
  Unpaused: [{ name: "account", type: "address", indexed: false }],
  AdminTransferStarted: [
    { name: "oldAdmin", type: "address", indexed: true },
    { name: "newAdmin", type: "address", indexed: true },
  ],
  AdminTransferred: [
    { name: "oldAdmin", type: "address", indexed: true },
    { name: "newAdmin", type: "address", indexed: true },
  ],
};

export type EventArg = string | bigint | boolean | number;

export interface DecodedEvent {
  name: EventName;
  topic: Hex;
  args: Record<string, EventArg>;
  /** logIndex from the raw log, for ordering and de-duplication */
  logIndex?: number;
  blockNumber?: number;
  transactionHash?: string;
}

/** Known event name → topic0 */
export function eventTopic(name: EventName): Hex {
  return EVENT_TOPICS[name];
}

/** Reverse lookup: topic0 → event name (case-insensitive) */
export function eventNameOf(topic: string): EventName | null {
  const t = topic.toLowerCase();
  for (const [name, tp] of Object.entries(EVENT_TOPICS)) {
    if (tp.toLowerCase() === t) return name as EventName;
  }
  return null;
}

export interface RawLog {
  address?: string;
  topics: string[];
  data: string;
  logIndex?: string | number;
  blockNumber?: string | number;
  transactionHash?: string;
}

/**
 * Decode one log. Anything that is not this engine's event (or an unknown topic) returns null rather
 * than throwing, because a frontend receipt legitimately carries other contracts' logs (USDC Transfer
 * and friends).
 */
export function decodeLog(log: RawLog): DecodedEvent | null {
  const name = log.topics[0] ? eventNameOf(log.topics[0]) : null;
  if (!name) return null;
  const specs = EVENT_FIELDS[name];
  const body = strip0x(log.data ?? "0x");
  const headWords: bigint[] = [];
  const headCount = specs.filter((f) => !f.indexed).length;
  for (let i = 0; i < headCount; i += 1) {
    headWords.push(BigInt("0x" + (body.slice(i * 64, (i + 1) * 64) || "0")));
  }

  const args: Record<string, EventArg> = {};
  let topicIdx = 1;
  let headIdx = 0;
  for (const f of specs) {
    if (f.indexed) {
      const t = log.topics[topicIdx] ?? "0x";
      topicIdx += 1;
      args[f.name] = decodeSingleWord(t, f.type);
      continue;
    }
    if (f.type === "string") {
      const off = Number(headWords[headIdx]) * 2;
      headIdx += 1;
      const len = Number(BigInt("0x" + body.slice(off, off + 64)));
      const hex = body.slice(off + 64, off + 64 + len * 2);
      args[f.name] = hexToUtf8(hex);
      continue;
    }
    args[f.name] = decodeSingleWord("0x" + headWords[headIdx].toString(16).padStart(64, "0"), f.type);
    headIdx += 1;
  }
  return {
    name,
    topic: log.topics[0] as Hex,
    args,
    ...(log.logIndex !== undefined ? { logIndex: Number(log.logIndex) } : {}),
    ...(log.blockNumber !== undefined ? { blockNumber: Number(log.blockNumber) } : {}),
    ...(log.transactionHash !== undefined ? { transactionHash: log.transactionHash } : {}),
  };
}

/** Decode logs in bulk, silently dropping anything unrecognised (USDC Transfer, other contracts) */
export function decodeLogs(logs: RawLog[]): DecodedEvent[] {
  const out: DecodedEvent[] = [];
  for (const log of logs) {
    const ev = decodeLog(log);
    if (ev) out.push(ev);
  }
  return out;
}

function decodeSingleWord(wordHex: string, type: FieldType): EventArg {
  const body = strip0x(wordHex).padStart(64, "0");
  switch (type) {
    case "address":
      return "0x" + body.slice(24, 64);
    case "bool":
      return BigInt("0x" + body) !== 0n;
    case "uint8":
      return Number(BigInt("0x" + body));
    case "uint256":
      return BigInt("0x" + body);
    case "bytes32":
      return "0x" + body;
    default:
      return "0x" + body;
  }
}
