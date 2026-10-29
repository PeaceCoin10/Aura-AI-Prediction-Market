/**
 * PredictionSDK — safe front-end interaction helper library
 *
 * ⚠️ Contract binding status (after the 2026-10-25 architecture switch):
 *    The calldata encoders in this file are bound to the **legacy architecture** (PredictionFactory +
 *    one PredictionVault per market). Both contracts are archived under `../legacy/contracts/` and are
 *    no longer what gets deployed to mainnet.
 *    The new mainnet architecture is `CentralPredictionEngine` (a single contract hosting many markets);
 *    its full signature table lives in `../docs/CENTRAL-ENGINE.md`. When wiring the new engine,
 *    the front end **must not** reuse the vault selectors defined here.
 *    What can be reused verbatim is the contract-agnostic layer: the MEV route table, `submitProtected`,
 *    `assertPlanIntegrity`, `confirmQuoteStillValid`, and `waitForReceipt`.
 *    An SDK targeting the new engine already exists: `./CentralPredictionSDK.ts` (44 unit tests plus
 *    `script/e2e-sdk-central.sh` for live-chain integration). New projects should use that one directly;
 *    this file remains only as a historical regression and MEV-submission reference.
 *
 * The problem this solves: if the front end passes `minSharesOut` as 0 (or casually writes 1), the user's
 * fill price is completely unprotected, and anyone can sandwich the order to any price within the same block.
 *
 * Deliberate design constraints of this library:
 *   1. **No API accepts `minSharesOut` directly.** The only entry point is
 *      `buildBuy({ amountIn, slippageBps })`, and minSharesOut is computed on the fly by previewBuy.
 *   2. `slippageBps` must lie in [1, 500]. Passing 0 throws immediately — going unprotected is banned at
 *      the code level.
 *   3. A complete preflight (minimum bet / impact cap / already resolved / paused / depth) runs before any
 *      transaction is built, so problems throw locally instead of burning the user's gas.
 *   4. Zero dependencies: the caller only supplies an `ethCall(to, data)`, so viem / ethers / wagmi all fit.
 *
 * Usage:
 *   const sdk = new PredictionSDK(transport, { vault: "0x..." });
 *   const tx  = await sdk.buildBuy({ outcome: 1, amountIn: 100_000_000n, slippageBps: 100 });
 *   await wallet.sendTransaction(tx);
 */

/* ---------------------------------- Types --------------------------------- */

export interface EthCallTransport {
  /** Performs an eth_call and returns the 0x-prefixed hexadecimal return value */
  ethCall(to: string, data: string): Promise<string>;
  /**
   * Optional: send a signed transaction to a specific route (eth_sendRawTransaction).
   * Private relays and MEV-protection endpoints are reached through this hook; the SDK's quoting and
   * encoding features work without it.
   */
  sendRawTransaction?(route: SubmissionRoute, rawTx: string): Promise<string>;
  /** Optional: fetch a transaction receipt, used to settle whether a "private route timeout" landed on-chain */
  getTransactionReceipt?(hash: string): Promise<TransactionReceipt | null>;
}

export interface TransactionReceipt {
  status?: string;
  blockNumber?: string;
  transactionHash?: string;
}

/** Privacy tier of a route: decides whether it is safe to fall back to the next endpoint after a timeout */
export type RoutePrivacy =
  /** Private relay (Flashbots Protect and friends): invisible to the public mempool */
  | "private-relay"
  /** The chain has no public mempool — transactions go straight to the sequencer (Base / OP Stack family) */
  | "sequencer-private"
  /** Plain public RPC: anything visible can be front-run */
  | "public";

export interface SubmissionRoute {
  id: string;
  chainId: number;
  url: string;
  privacy: RoutePrivacy;
  /** Whether the endpoint needs an account / API key (the SDK ships no keys of its own) */
  requiresAccount?: boolean;
  note: string;
}

export interface SubmissionOptions {
  /** Override the default route table (tried top to bottom by priority) */
  routes?: SubmissionRoute[];
  /** Timeout for a single submission attempt, 4000ms by default */
  submitTimeoutMs?: number;
  /** Maximum quote age, 2000ms by default (Base produces a block roughly every 2s) */
  maxQuoteAgeMs?: number;
  /** Allowed quote drift before submission, defaults to buildBuy's slippageBps */
  maxDriftBps?: number;
}

/** Signs {to,data,value} into a rawTx; the caller wires it to a viem/ethers wallet */
export type TxSigner = (tx: { to: string; data: string; value: "0x0" }) => Promise<string>;

export interface SdkOptions {
  /** PredictionVault clone address */
  vault: string;
  /** PredictionFactory address (only needed to call buildCreateMarket) */
  factory?: string;
  /** Safety margin subtracted from the per-trade impact cap, 0 by default (follow the contract exactly) */
  impactSafetyMarginBps?: number;
  /** Chain id: selects the default route table (1 = ETH mainnet, 8453 = Base mainnet, 84532 = Base Sepolia) */
  chainId?: number;
  /** Extra / overriding submission routes (e.g. a paid MEV-protected private RPC) */
  routes?: SubmissionRoute[];
  /** Default per-submission timeout, 4000ms by default */
  submitTimeoutMs?: number;
  /** Default maximum quote age, 2000ms by default */
  maxQuoteAgeMs?: number;
}

export type Outcome = 0 | 1; // 0 = NO, 1 = YES

export interface MarketState {
  resolved: boolean;
  outcome: number;
  tradingOpen: boolean;
  paused: boolean;
  resolutionTime: number;
  minBet: bigint;
  maxBet: bigint;
  maxImpactBps: bigint;
  yesReserve: bigint;
  noReserve: bigint;
  depth: bigint;
  priceYes: bigint;
  priceNo: bigint;
  totalLpShares: bigint;
  /** On-chain trade fee (bps), never hardcoded, so a contract upgrade cannot silently skew SDK math */
  tradeFeeBps: bigint;
}

export interface BuyRequest {
  outcome: Outcome;
  /** Amount paid (USDC base units, 6 decimals) */
  amountIn: bigint;
  /** Acceptable slippage in bps. 1..500 allowed (0 = unprotected, refused) */
  slippageBps: number;
}

export interface TradePlan {
  to: string;
  data: string;
  value: "0x0";
  /** Carried for UI display */
  quote: {
    amountIn: bigint;
    expectedSharesOut: bigint;
    minSharesOut: bigint;
    slippageBps: number;
    priceImpactBps: number;
    effectivePrice: number;
    /** Quote creation time (ms), used for the freshness check before submission */
    quotedAt: number;
  };
}

export class SdkError extends Error {
  constructor(
    public readonly code: SdkErrorCode,
    message: string,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SdkError";
  }
}

export type SdkErrorCode =
  | "SLIPPAGE_NOT_SET"
  | "SLIPPAGE_TOO_HIGH"
  | "BELOW_MIN_BET"
  | "ABOVE_MAX_BET"
  | "IMPACT_TOO_HIGH"
  | "MARKET_RESOLVED"
  | "TRADING_PAUSED"
  | "ZERO_SHARES"
  | "INSUFFICIENT_DEPTH"
  | "BAD_OUTCOME"
  | "BAD_RESPONSE"
  | "MARKET_NOT_RESOLVED"
  | "NOTHING_TO_REDEEM"
  | "NOT_ADMIN"
  | "NOT_PENDING_ADMIN"
  | "BAD_CONFIG"
  // ---- MEV / submission routes / quote freshness ----
  | "NO_ROUTE"
  | "ROUTE_UNAVAILABLE"
  | "SUBMIT_AMBIGUOUS"
  | "NETWORK_TIMEOUT"
  | "QUOTE_STALE"
  | "BAD_PLAN"
  | "RECEIPT_TIMEOUT";

/* -------------------------------- ABI constants -------------------------------- */

/** cast sig "previewBuy(uint8,uint256)" */
const SEL_PREVIEW_BUY = "0x5e573804";
/** cast sig "buy(uint8,uint256,uint256)" */
const SEL_BUY = "0xf6d956df";
/** cast sig "sell(uint8,uint256,uint256)" */
const SEL_SELL = "0x46280a80";

/** cast sig "transferAdmin(address)" */
const SEL_TRANSFER_ADMIN = "0x75829def";
/** cast sig "acceptAdmin()" */
const SEL_ACCEPT_ADMIN = "0x0e18b681";
/** cast sig "createMarket(bytes32,address,uint256,uint256,uint256,uint256)" */
const SEL_CREATE_MARKET = "0x0ca07ff7";

const SEL = {
  resolved: "0x3f6fa655",
  outcome: "0x27793f87",
  tradingOpen: "0xffb54a99",
  paused: "0x5c975abb",
  resolutionTime: "0xf3e41e90",
  minBet: "0x9619367d",
  maxBet: "0x2e5b2168",
  maxImpactBps: "0x3bcb3259",
  yesReserve: "0xb2670d74",
  noReserve: "0x72a9fa6e",
  depth: "0x631c56ef",
  priceYes: "0x089ef5e8",
  priceNo: "0xbe0bfb9c",
  tradeFeeBps: "0x9185f598",
  buy: SEL_BUY,
  sell: SEL_SELL,
  totalLpShares: "0x0fd4f78d",
  admin: "0xf851a440",
  pendingAdmin: "0x26782247",
} as const;

/**
 * Contract custom error -> front-end error code.
 * Custom errors are only 4 bytes wide, so collisions are theoretically possible; this table therefore only
 * exists to "translate an on-chain revert into human language". Real enforcement stays in local preflight.
 */
const REVERT_MAP: Record<string, SdkErrorCode> = {
  "0xb8ab88d4": "ABOVE_MAX_BET", // AboveMaxBet()
  "0x5688ffb3": "BELOW_MIN_BET", // BelowMinBet()
  "0x22410594": "IMPACT_TOO_HIGH", // ImpactTooHigh()
  "0x8199f5f3": "ZERO_SHARES", // SlippageExceeded() (insufficient fill)
  "0xd93c0665": "TRADING_PAUSED", // EnforcedPause()
  "0x1db9461a": "MARKET_RESOLVED", // MarketResolvedAlready()
  "0xe2c865df": "TRADING_PAUSED", // TradingClosed()
  "0x9f4a6489": "MARKET_NOT_RESOLVED", // NotResolved()
  "0x9890af60": "NOTHING_TO_REDEEM", // NothingToRedeem()
  "0x9811e0c7": "ZERO_SHARES", // ZeroShares()
  "0xbb55fd27": "INSUFFICIENT_DEPTH", // InsufficientLiquidity()
  "0x47556579": "NOT_ADMIN", // OnlyAdmin()
  "0x058d9a1b": "NOT_PENDING_ADMIN", // NotPendingAdmin()
  "0xf98175ba": "BAD_CONFIG", // InvalidMinBet()
  "0x03235eab": "BAD_CONFIG", // InvalidMaxBet()
  "0xc865b21a": "BAD_CONFIG", // InvalidMaxImpact()
  "0x10549aa0": "BAD_CONFIG", // InvalidResolutionTime()
};

/** User-facing copy the front end can toast directly */
export const ERROR_MESSAGES: Record<SdkErrorCode, string> = {
  SLIPPAGE_NOT_SET: "Set slippage protection first (it cannot be 0); otherwise your fill price can be front-run",
  SLIPPAGE_TOO_HIGH: "Slippage tolerance cannot exceed 5%",
  BELOW_MIN_BET: "Minimum bet size is 5 USDC",
  ABOVE_MAX_BET: "Maximum bet size is 10,000 USDC",
  IMPACT_TOO_HIGH: "This order is too large relative to the pool; reduce the amount",
  MARKET_RESOLVED: "This market has already resolved and can no longer be traded",
  TRADING_PAUSED: "Trading is paused on this market; please try again later",
  ZERO_SHARES: "Order size is too small: it fills zero shares; increase the amount",
  INSUFFICIENT_DEPTH: "Pool liquidity is too thin to absorb this trade",
  BAD_OUTCOME: "Only YES (1) or NO (0) is supported",
  BAD_RESPONSE: "The chain returned unexpected data; refresh and try again",
  MARKET_NOT_RESOLVED: "This market has not resolved yet",
  NOTHING_TO_REDEEM: "You have no shares to redeem",
  NOT_ADMIN: "Only the admin can perform this action",
  NOT_PENDING_ADMIN: "Only the nominated pending admin can complete the handover (acceptAdmin)",
  NO_ROUTE: "No submission route is available on this chain; configure a private RPC or switch to the wallet's default network",
  ROUTE_UNAVAILABLE: "The private submission route is unavailable (missing key / endpoint failure); the transaction was not sent",
  SUBMIT_AMBIGUOUS: "The private route timed out and acceptance is unknown: look the receipt up by transaction hash first, and never resend blindly",
  NETWORK_TIMEOUT: "The node timed out and the quote is now stale; please retry",
  QUOTE_STALE: "The price moved outside your slippage tolerance while you were confirming; blocked before sending",
  BAD_PLAN: "Transaction data was modified or does not match the quote; blocked",
  RECEIPT_TIMEOUT: "Timed out waiting for a receipt; the transaction may still be included, check the explorer shortly",
  BAD_CONFIG: "Invalid market parameters (check minimum bet / per-trade cap / impact cap)",
};

const BPS = 10_000n;
const MAX_SLIPPAGE_BPS = 500; // 5%
const MIN_SLIPPAGE_BPS = 1;
const DEFAULT_SUBMIT_TIMEOUT_MS = 4_000;
const DEFAULT_QUOTE_MAX_AGE_MS = 2_000;

/* ------------------------------ Submission route table ------------------------------ */

/**
 * Known-good submission routes (measured / confirmed against official docs as of this version):
 *  - Flashbots Protect officially supports Ethereum mainnet (1) and Sepolia (11155111) only, **not Base**;
 *    sending a Base transaction to rpc.flashbots.net is rejected outright, so we do not pretend otherwise.
 *  - Base is a single-sequencer OP Stack chain with **no public pending mempool**: transactions land directly
 *    in the sequencer queue, so classic "watch the mempool and front-run" does not apply. The residual risks
 *    are RPC-layer visibility, observing Flashblocks preconfirmations, and intermediaries that resell the
 *    transaction to searchers. For harder privacy, plug your own private endpoint into mevProtectedRoute().
 */
export const KNOWN_ROUTES: readonly SubmissionRoute[] = [
  {
    id: "flashbots-protect",
    chainId: 1,
    url: "https://rpc.flashbots.net/fast",
    privacy: "private-relay",
    requiresAccount: false,
    note: "Flashbots Protect (Ethereum mainnet): hidden from the public mempool, failed transactions never land and cost nothing",
  },
  {
    id: "flashbots-protect-sepolia",
    chainId: 11155111,
    url: "https://rpc-sepolia.flashbots.net",
    privacy: "private-relay",
    requiresAccount: false,
    note: "Flashbots Protect (Sepolia testnet)",
  },
  {
    id: "base-mainnet-sequencer",
    chainId: 8453,
    url: "https://mainnet.base.org",
    privacy: "sequencer-private",
    note: "Official Base mainnet RPC: no private mempool, transactions go straight to the sequencer queue (not a privacy relay)",
  },
  {
    id: "base-sepolia-sequencer",
    chainId: 84532,
    url: "https://sepolia.base.org",
    privacy: "sequencer-private",
    note: "Official Base Sepolia RPC: same as above, used only for staged verification",
  },
];

/**
 * Builds an external MEV-protection / private route (e.g. a metered provider private RPC).
 * The SDK embeds no URLs and no API keys — the endpoint must come from the caller, so nobody ends up
 * "looking protected while nothing is actually configured".
 */
export function mevProtectedRoute(params: {
  id?: string;
  chainId: number;
  url: string;
  requiresAccount?: boolean;
  note?: string;
}): SubmissionRoute {
  if (!/^https?:\/\//.test(params.url)) {
    throw new SdkError("BAD_CONFIG", `invalid route url: ${params.url}`);
  }
  return {
    id: params.id ?? `private-${params.chainId}`,
    chainId: params.chainId,
    url: params.url,
    privacy: "private-relay",
    requiresAccount: params.requiresAccount ?? true,
    note: params.note ?? "Custom private route (MEV protection / private mempool); credentials are managed by the caller",
  };
}

const PRIVACY_RANK: Record<RoutePrivacy, number> = {
  "private-relay": 0,
  "sequencer-private": 1,
  public: 2,
};

/**
 * Filters routes by chain and orders them by priority (private relay > sequencer-private > public);
 * caller-supplied routes always come first. An unknown chain returns an empty array — we would rather throw
 * NO_ROUTE than silently degrade to a public RPC.
 */
export function routesForChain(chainId: number, extra: SubmissionRoute[] = []): SubmissionRoute[] {
  const promoted = extra.filter((r) => r.chainId === chainId);
  const known = KNOWN_ROUTES.filter((r) => r.chainId === chainId);
  const seen = new Set<string>();
  const merged: SubmissionRoute[] = [];
  for (const r of [...promoted, ...known]) {
    const key = r.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
  }
  return merged.sort((a, b) => PRIVACY_RANK[a.privacy] - PRIVACY_RANK[b.privacy]);
}

/** Timeout wrapper: network jitter must never hang the front end; always surfaces a coded SdkError */
function withTimeout<T>(p: Promise<T>, ms: number, code: SdkErrorCode, what = "rpc"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SdkError(code, `${what} timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/* ------------------------------ ABI encoding / decoding ------------------------------ */

function padAddress(a: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new SdkError("BAD_CONFIG", `invalid address: ${a}`);
  return a.slice(2).toLowerCase().padStart(64, "0");
}

function padBytes32(h: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(h)) throw new SdkError("BAD_CONFIG", `invalid bytes32: ${h}`);
  return h.slice(2).toLowerCase();
}

function padWord(v: bigint): string {
  if (v < 0n) throw new Error("negative uint");
  return v.toString(16).padStart(64, "0");
}

function word(data: string, index = 0): bigint {
  const clean = data.startsWith("0x") ? data.slice(2) : data;
  const chunk = clean.slice(index * 64, index * 64 + 64);
  if (chunk.length !== 64) {
    throw new SdkError("BAD_RESPONSE", `malformed return data (len=${clean.length})`);
  }
  return BigInt("0x" + chunk);
}

function ceilDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("div by zero");
  return (a + b - 1n) / b;
}

function bool(data: string): boolean {
  return word(data) !== 0n;
}

/** Turns a 32-byte ABI word back into a lowercase 0x address (low 20 bytes) */
function addr(data: string): string {
  return "0x" + word(data).toString(16).padStart(40, "0").slice(-40);
}

/* --------------------------------- Main class --------------------------------- */

export class PredictionSDK {
  private readonly vault: string;
  private readonly factory?: string;
  private readonly impactMarginBps: number;
  private readonly chainId?: number;
  private readonly routes: SubmissionRoute[];
  private readonly submitTimeoutMs: number;
  private readonly maxQuoteAgeMs: number;

  constructor(
    private readonly transport: EthCallTransport,
    opts: SdkOptions,
  ) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(opts.vault)) {
      throw new Error(`invalid vault address: ${opts.vault}`);
    }
    this.vault = opts.vault;
    this.factory = opts.factory;
    if (opts.factory && !/^0x[0-9a-fA-F]{40}$/.test(opts.factory)) {
      throw new Error(`invalid factory address: ${opts.factory}`);
    }
    this.impactMarginBps = opts.impactSafetyMarginBps ?? 0;
    this.chainId = opts.chainId;
    this.routes = opts.routes ?? (opts.chainId === undefined ? [] : routesForChain(opts.chainId));
    this.submitTimeoutMs = opts.submitTimeoutMs ?? DEFAULT_SUBMIT_TIMEOUT_MS;
    this.maxQuoteAgeMs = opts.maxQuoteAgeMs ?? DEFAULT_QUOTE_MAX_AGE_MS;
  }

  /* ----------------------------- Market data reads ----------------------------- */

  async getMarketState(): Promise<MarketState> {
    const [resolved, outcome, tradingOpen, paused, resolutionTime, minBet, maxBet, maxImpactBps, yesReserve, noReserve, depth, priceYes, priceNo, totalLpShares, tradeFeeBps] =
      await Promise.all([
        this.call(SEL.resolved).then(bool),
        this.call(SEL.outcome).then((d) => Number(word(d))),
        this.call(SEL.tradingOpen).then(bool),
        this.call(SEL.paused).then(bool),
        this.call(SEL.resolutionTime).then((d) => Number(word(d))),
        this.call(SEL.minBet).then(word),
        this.call(SEL.maxBet).then(word),
        this.call(SEL.maxImpactBps).then(word),
        this.call(SEL.yesReserve).then(word),
        this.call(SEL.noReserve).then(word),
        this.call(SEL.depth).then(word),
        this.call(SEL.priceYes).then(word),
        this.call(SEL.priceNo).then(word),
        this.call(SEL.totalLpShares).then(word),
        this.call(SEL.tradeFeeBps).then(word),
      ]);

    return { resolved, outcome, tradingOpen, paused, resolutionTime, minBet, maxBet, maxImpactBps, yesReserve, noReserve, depth, priceYes, priceNo, totalLpShares, tradeFeeBps };
  }

  /* --------------------------- Core: slippage math --------------------------- */

  /**
   * Calls previewBuy() for the theoretical share count, then discounts it by the slippage tolerance to get
   * minSharesOut. This is the only place in the library that produces a minSharesOut.
   */
  async calculateMinSharesOut(
    outcome: Outcome,
    amountIn: bigint,
    slippageToleranceBps: number,
  ): Promise<bigint> {
    this.assertSlippage(slippageToleranceBps);
    this.assertOutcome(outcome);
    if (amountIn <= 0n) {
      throw new SdkError("BELOW_MIN_BET", "amountIn must be > 0", { amountIn: amountIn.toString() });
    }

    const expected = await this.previewBuy(outcome, amountIn);
    if (expected === 0n) {
      throw new SdkError("ZERO_SHARES", "previewBuy returned 0 shares — trade would revert", {
        amountIn: amountIn.toString(),
      });
    }

    // minSharesOut = expected * (10000 - slippage) / 10000, rounded down
    const minOut = (expected * (BPS - BigInt(slippageToleranceBps))) / BPS;
    if (minOut === 0n) {
      throw new SdkError("ZERO_SHARES", "computed minSharesOut == 0", {
        expected: expected.toString(),
        slippageBps: slippageToleranceBps,
      });
    }
    return minOut;
  }

  /** Pass-through to the contract's previewBuy; read-only */
  async previewBuy(outcome: Outcome, amountIn: bigint): Promise<bigint> {
    const data = SEL_PREVIEW_BUY + padWord(BigInt(outcome)) + padWord(amountIn);
    return word(await this.transport.ethCall(this.vault, data));
  }

  /* --------------------------- Build signable transactions --------------------------- */

  /**
   * Builds a buy transaction. The caller cannot specify minSharesOut — only a slippage tolerance.
   */
  async buildBuy(req: BuyRequest): Promise<TradePlan> {
    this.assertSlippage(req.slippageBps);
    this.assertOutcome(req.outcome);

    const state = await this.getMarketState();
    this.assertTradable(state, req.amountIn);

    const expectedSharesOut = await this.previewBuy(req.outcome, req.amountIn);
    if (expectedSharesOut === 0n) {
      throw new SdkError("ZERO_SHARES", "previewBuy returned 0");
    }
    const minSharesOut = await this.calculateMinSharesOut(req.outcome, req.amountIn, req.slippageBps);

    const data =
      SEL_BUY +
      padWord(BigInt(req.outcome)) +
      padWord(req.amountIn) +
      padWord(minSharesOut);

    return {
      to: this.vault,
      data,
      value: "0x0",
      quote: {
        amountIn: req.amountIn,
        expectedSharesOut,
        minSharesOut,
        slippageBps: req.slippageBps,
        priceImpactBps: this.priceImpactBps(state, req.outcome, req.amountIn, expectedSharesOut),
        effectivePrice: this.effectivePrice(req.amountIn, expectedSharesOut),
        quotedAt: Date.now(),
      },
    };
  }

  /**
   * Builds a sell transaction. Likewise there is no caller-supplied minAmountOut; it is the current share
   * count discounted by (1 - slippage).
   */
  async buildSell(params: {
    outcome: Outcome;
    sharesIn: bigint;
    slippageBps: number;
  }): Promise<TradePlan> {
    this.assertSlippage(params.slippageBps);
    this.assertOutcome(params.outcome);
    if (params.sharesIn <= 0n) throw new SdkError("ZERO_SHARES", "sharesIn must be > 0");

    const state = await this.getMarketState();
    if (state.resolved) throw new SdkError("MARKET_RESOLVED", "market already resolved");

    // Reserve derivation that mirrors the contract's sell() exactly
    const y = state.yesReserve;
    const n = state.noReserve;
    let grossOut: bigint;
    if (params.outcome === 1) {
      const newYes = y + params.sharesIn;
      grossOut = n - ceilDiv(n * y, newYes);
    } else {
      const newNo = n + params.sharesIn;
      grossOut = y - ceilDiv(y * n, newNo);
    }
    if (grossOut === 0n) {
      throw new SdkError("ZERO_SHARES", "selling this size returns 0 — pool liquidity too thin", {
        sharesIn: params.sharesIn.toString(),
      });
    }
    const fee = ceilDiv(grossOut * state.tradeFeeBps, BPS);
    const netOut = grossOut - fee;

    const minAmountOut = (netOut * (BPS - BigInt(params.slippageBps))) / BPS;
    if (minAmountOut === 0n) {
      throw new SdkError("ZERO_SHARES", "computed minAmountOut == 0", {
        netOut: netOut.toString(),
        slippageBps: params.slippageBps,
      });
    }

    const data =
      SEL_SELL + padWord(BigInt(params.outcome)) + padWord(params.sharesIn) + padWord(minAmountOut);

    const price = params.outcome === 1 ? state.priceYes : state.priceNo;

    return {
      to: this.vault,
      data,
      value: "0x0",
      quote: {
        amountIn: params.sharesIn,
        expectedSharesOut: netOut,
        minSharesOut: minAmountOut,
        slippageBps: params.slippageBps,
        priceImpactBps: Number((((price * params.sharesIn) / 10n ** 18n - netOut) * BPS) / (price * params.sharesIn / 10n ** 18n || 1n)),
        effectivePrice: Number(price) / 1e18,
        quotedAt: Date.now(),
      },
    };
  }

  /* --------------------------- Market creation (6 params) --------------------------- */

  /**
   * Builds a createMarket transaction. **None of the 6 arguments may be omitted**:
   * passing too few or too many throws BAD_CONFIG during encoding, long before it can blow up on-chain.
   */
  async buildCreateMarket(params: {
    conditionId: string;
    admin: string;
    resolutionTime: number | bigint;
    minBet: bigint;
    maxBet: bigint;
    maxImpactBps: number;
  }): Promise<{ to: string; data: string; value: "0x0" }> {
    if (!this.factory) {
      throw new SdkError("BAD_CONFIG", "factory address not configured in SdkOptions");
    }

    const now = Math.floor(Date.now() / 1000);
    const rt = BigInt(params.resolutionTime);
    if (rt <= BigInt(now + 60)) {
      throw new SdkError("BAD_CONFIG", "resolutionTime must be at least 60s in the future", {
        resolutionTime: rt.toString(),
        now,
      });
    }
    if (params.minBet < 5_000_000n) {
      throw new SdkError("BAD_CONFIG", "minBet must be >= 5 USDC", {
        minBet: params.minBet.toString(),
      });
    }
    if (params.maxBet < params.minBet || params.maxBet > 10_000_000_000n) {
      throw new SdkError("BAD_CONFIG", "maxBet must be in [minBet, 10,000 USDC]", {
        maxBet: params.maxBet.toString(),
        minBet: params.minBet.toString(),
      });
    }
    if (!Number.isInteger(params.maxImpactBps) || params.maxImpactBps < 1 || params.maxImpactBps > 500) {
      throw new SdkError("BAD_CONFIG", "maxImpactBps must be an integer in [1, 500]", {
        maxImpactBps: params.maxImpactBps,
      });
    }

    const data =
      SEL_CREATE_MARKET +
      padBytes32(params.conditionId) +
      padAddress(params.admin) +
      padWord(rt) +
      padWord(params.minBet) +
      padWord(params.maxBet) +
      padWord(BigInt(params.maxImpactBps));

    return { to: this.factory, data, value: "0x0" };
  }

  /* ----------------------------- Circuit breakers ----------------------------- */

  /** Builds pause() (admin only; the SDK only encodes and does not check permissions) */
  buildPause(): { to: string; data: string; value: "0x0" } {
    return { to: this.vault, data: "0x8456cb59", value: "0x0" };
  }

  /** Builds unpause() */
  buildUnpause(): { to: string; data: string; value: "0x0" } {
    return { to: this.vault, data: "0x3f4ba83a", value: "0x0" };
  }

  /* --------------------------- Two-step admin handover --------------------------- */

  /**
   * Builds transferAdmin(address): **this only registers a pendingAdmin; admin does not change yet**.
   * The front end must confirm this step and the next one separately, and must never collapse both into a
   * single "take over" button.
   */
  buildTransferAdmin(newAdmin: string): { to: string; data: string; value: "0x0" } {
    return { to: this.vault, data: SEL_TRANSFER_ADMIN + padAddress(newAdmin), value: "0x0" };
  }

  /** Builds acceptAdmin(): must be signed and sent by pendingAdmin itself, otherwise the chain reverts */
  buildAcceptAdmin(): { to: string; data: string; value: "0x0" } {
    return { to: this.vault, data: SEL_ACCEPT_ADMIN, value: "0x0" };
  }

  /** Builds the factory-side transferAdmin(address) (factory and markets share the same two-step ABI) */
  buildFactoryTransferAdmin(newAdmin: string): { to: string; data: string; value: "0x0" } {
    if (!this.factory) throw new SdkError("BAD_CONFIG", "factory address not configured in SdkOptions");
    return { to: this.factory, data: SEL_TRANSFER_ADMIN + padAddress(newAdmin), value: "0x0" };
  }

  /** Builds the factory-side acceptAdmin() */
  buildFactoryAcceptAdmin(): { to: string; data: string; value: "0x0" } {
    if (!this.factory) throw new SdkError("BAD_CONFIG", "factory address not configured in SdkOptions");
    return { to: this.factory, data: SEL_ACCEPT_ADMIN, value: "0x0" };
  }

  /** Reads the current admin */
  async getAdmin(): Promise<string> {
    return addr(await this.call(SEL.admin));
  }

  /** Reads pendingAdmin; 0x000...000 means no handover is in flight */
  async getPendingAdmin(): Promise<string> {
    return addr(await this.call(SEL.pendingAdmin));
  }

  /* ----------------------- MEV protection / sandwich-resistant submission ----------------------- */

  /**
   * Routes currently usable (already sorted by privacy tier, private first).
   * Pass a chainId to inspect another chain; an empty array means "this chain has no fallback route" and the
   * caller must configure one explicitly.
   */
  availableRoutes(chainId: number = this.chainId ?? 0): SubmissionRoute[] {
    const extra = this.routes.filter((r) => r.chainId === chainId);
    return routesForChain(chainId, extra);
  }

  /**
   * Integrity self-check for transaction data: prevents the caller (or any middleware) from tampering with
   * already-built calldata. Any mismatch throws BAD_PLAN — a suspicious transaction is never signed and sent.
   */
  assertPlanIntegrity(plan: TradePlan): void {
    if (plan.to.toLowerCase() !== this.vault.toLowerCase()) {
      throw new SdkError("BAD_PLAN", `plan.to ${plan.to} is not the configured vault`);
    }
    const d = plan.data.toLowerCase();
    if (d.slice(0, 10) !== SEL_BUY) {
      throw new SdkError("BAD_PLAN", `unexpected selector ${d.slice(0, 10)} (expected buy)`);
    }
    if (d.length !== 10 + 3 * 64) {
      throw new SdkError("BAD_PLAN", `malformed calldata length ${d.length}`);
    }
    const outcome = BigInt("0x" + d.slice(10, 74));
    const amountIn = BigInt("0x" + d.slice(74, 138));
    const minOut = BigInt("0x" + d.slice(138, 202));

    if (outcome !== 0n && outcome !== 1n) {
      throw new SdkError("BAD_PLAN", `outcome word must be 0 or 1, got ${outcome}`);
    }
    if (amountIn !== plan.quote.amountIn) {
      throw new SdkError("BAD_PLAN", "calldata amountIn differs from quote", {
        calldata: amountIn.toString(),
        quote: plan.quote.amountIn.toString(),
      });
    }
    if (minOut !== plan.quote.minSharesOut) {
      throw new SdkError("BAD_PLAN", "calldata minSharesOut differs from quote", {
        calldata: minOut.toString(),
        quote: plan.quote.minSharesOut.toString(),
      });
    }
    if (minOut === 0n) {
      throw new SdkError("SLIPPAGE_NOT_SET", "minSharesOut is 0 in calldata — refusing to sign");
    }
    if (minOut > plan.quote.expectedSharesOut) {
      throw new SdkError("BAD_PLAN", "minSharesOut exceeds expected shares — would always revert");
    }
  }

  /**
   * Pre-submission "quote freshness" gate: when the network jitters or the price runs, the order is stopped
   * locally instead of on-chain.
   *
   * Three checks:
   *   1. quote age > maxQuoteAgeMs                               -> QUOTE_STALE (2s by default, one Base block)
   *   2. shares drop after a fresh previewBuy > allowed drift    -> QUOTE_STALE
   *   3. minSharesOut recomputed at the new price exceeds the old -> QUOTE_STALE (guaranteed revert on-chain,
   *      so there is no point burning gas)
   */
  async confirmQuoteStillValid(
    plan: TradePlan,
    req: BuyRequest,
    maxDriftBps?: number,
    maxQuoteAgeMs: number = this.maxQuoteAgeMs,
  ): Promise<bigint> {
    const age = Date.now() - plan.quote.quotedAt;
    if (!Number.isFinite(age) || age < 0) {
      throw new SdkError("BAD_PLAN", "quote has no valid timestamp");
    }
    if (age > maxQuoteAgeMs) {
      throw new SdkError("QUOTE_STALE", `quote is ${age}ms old (limit ${maxQuoteAgeMs}ms)`, { ageMs: age });
    }

    const fresh = await withTimeout(
      this.previewBuy(req.outcome, req.amountIn),
      this.submitTimeoutMs,
      "NETWORK_TIMEOUT",
      "previewBuy",
    );
    if (fresh === 0n) throw new SdkError("ZERO_SHARES", "re-quote returned 0 shares");

    const expected = plan.quote.expectedSharesOut;
    if (fresh < expected) {
      const driftBps = Number(((expected - fresh) * BPS) / expected);
      const limit = maxDriftBps ?? req.slippageBps;
      if (driftBps > limit) {
        throw new SdkError("QUOTE_STALE", `quote drifted ${driftBps}bps > ${limit}bps`, {
          quoted: expected.toString(),
          fresh: fresh.toString(),
          driftBps,
          limit,
        });
      }
      // Even when the drift is within tolerance, the old minSharesOut must still be fillable
      const minOutNow = (fresh * (BPS - BigInt(req.slippageBps))) / BPS;
      if (minOutNow < plan.quote.minSharesOut) {
        throw new SdkError("QUOTE_STALE", "price moved: minSharesOut would revert on-chain", {
          recommendedMinSharesOut: minOutNow.toString(),
          currentMinSharesOut: plan.quote.minSharesOut.toString(),
        });
      }
    }
    return fresh;
  }

  /**
   * Submits a signed transaction through the route chain.
   *
   * Safety rules (far more important than "just try a few endpoints"):
   *   - A private-route timeout means **the outcome is unknown** (the tx may already be accepted) -> throw
   *     SUBMIT_AMBIGUOUS and never auto-fall back to a public pool, otherwise the same nonce is exposed to
   *     the public mempool or submitted twice.
   *   - An explicit JSON-RPC rejection from a private route means it did not land, so the next route may be tried.
   *   - A public-route failure also moves on to the next route; if every route fails, throw NO_ROUTE.
   */
  async submitProtected(
    rawTx: string,
    opts: SubmissionOptions = {},
  ): Promise<{ hash: string; route: SubmissionRoute }> {
    if (!this.transport.sendRawTransaction) {
      throw new SdkError("BAD_CONFIG", "transport.sendRawTransaction is not implemented");
    }
    if (!/^0x[0-9a-fA-F]+$/.test(rawTx)) {
      throw new SdkError("BAD_CONFIG", "rawTx must be 0x-prefixed hex");
    }
    const routes = opts.routes ?? this.availableRoutes();
    if (routes.length === 0) {
      throw new SdkError("NO_ROUTE", "no submission route configured for this chain");
    }
    const timeout = opts.submitTimeoutMs ?? this.submitTimeoutMs;
    const failures: string[] = [];

    for (const route of routes) {
      try {
        const hash = await withTimeout(
          this.transport.sendRawTransaction(route, rawTx),
          timeout,
          "NETWORK_TIMEOUT",
          `send via ${route.id}`,
        );
        if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
          throw new SdkError("BAD_RESPONSE", `route ${route.id} returned malformed hash: ${hash}`);
        }
        return { hash, route };
      } catch (e) {
        const isTimeout = e instanceof SdkError && e.code === "NETWORK_TIMEOUT";
        const isMalformed = e instanceof SdkError && e.code === "BAD_RESPONSE";
        if ((isTimeout || isMalformed) && route.privacy !== "public") {
          throw new SdkError(
            "SUBMIT_AMBIGUOUS",
            `no usable response from ${route.id} — tx may already be accepted; check the receipt before any retry`,
            { route: route.id, submittedTo: route.url },
          );
        }
        failures.push(`${route.id}: ${(e as Error)?.message ?? String(e)}`);
      }
    }

    throw new SdkError("NO_ROUTE", `all submission routes failed: ${failures.join(" | ")}`);
  }

  /**
   * End to end: quote -> integrity self-check -> freshness gate -> sign -> submit over a private route.
   *
   * The point is that **every locally decidable risk is eliminated before signing** (price ran away, data
   * tampered with, network timeout), so a user never signs a transaction that is bound to be sandwiched or
   * bound to revert because of a network hiccup.
   */
  async signAndSubmitBuy(
    req: BuyRequest,
    signer: TxSigner,
    opts: SubmissionOptions = {},
  ): Promise<{ hash: string; route: SubmissionRoute; quote: TradePlan["quote"] }> {
    const plan = await this.buildBuy(req);
    this.assertPlanIntegrity(plan);
    await this.confirmQuoteStillValid(plan, req, opts.maxDriftBps, opts.maxQuoteAgeMs);

    const rawTx = await withTimeout(
      signer({ to: plan.to, data: plan.data, value: plan.value }),
      opts.submitTimeoutMs ?? this.submitTimeoutMs,
      "NETWORK_TIMEOUT",
      "signer",
    );

    const { hash, route } = await this.submitProtected(rawTx, opts);
    return { hash, route, quote: plan.quote };
  }

  /**
   * Polls for a receipt. After a private-route timeout (SUBMIT_AMBIGUOUS) this is how you settle whether the
   * transaction actually landed, avoiding a double-spend caused by "assume it failed, send it again".
   */
  async waitForReceipt(
    hash: string,
    opts: { timeoutMs?: number; pollMs?: number } = {},
  ): Promise<TransactionReceipt> {
    if (!this.transport.getTransactionReceipt) {
      throw new SdkError("BAD_CONFIG", "transport.getTransactionReceipt is not implemented");
    }
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const pollMs = opts.pollMs ?? 500;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const rcpt = await withTimeout(
        this.transport.getTransactionReceipt(hash),
        this.submitTimeoutMs,
        "NETWORK_TIMEOUT",
        "getTransactionReceipt",
      );
      if (rcpt) return rcpt;
      if (Date.now() + pollMs > deadline) {
        throw new SdkError("RECEIPT_TIMEOUT", `no receipt for ${hash} within ${timeoutMs}ms`, { hash });
      }
      await new Promise((r) => setTimeout(r, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
    }
  }

  /* --------------------------- Error mapping --------------------------- */

  /** Turns an error code into copy that can be shown on screen directly */
  static message(code: SdkErrorCode | "UNKNOWN"): string {
    return ERROR_MESSAGES[code as SdkErrorCode] ?? "Transaction failed, please try again shortly";
  }

  /**
   * Translates an on-chain revert (or an error object thrown by ethers/viem) into { code, message }.
   * Handles: bare hex, { data }, { error: { data } }, { info: { error: { data } } }
   */
  static mapRevert(err: unknown): { code: SdkErrorCode | "UNKNOWN"; message: string; detail?: string } {
    const data = PredictionSDK.extractRevertData(err);
    if (!data) return { code: "UNKNOWN", message: PredictionSDK.message("UNKNOWN") };

    const selector = data.slice(0, 10).toLowerCase();
    const code = REVERT_MAP[selector];
    if (code) return { code, message: PredictionSDK.message(code), detail: data };

    // Error(string) — the fallback path for require()
    if (selector === "0x08c379a0" && data.length > 138) {
      const len = Number(BigInt("0x" + data.slice(74, 138)));
      const hex = data.slice(138, 138 + len * 2);
      let text = "";
      for (let i = 0; i < hex.length; i += 2) text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      return { code: "UNKNOWN", message: `Reverted on-chain: ${text}`, detail: data };
    }

    return { code: "UNKNOWN", message: PredictionSDK.message("UNKNOWN"), detail: data };
  }

  private static extractRevertData(err: unknown): string | undefined {
    if (typeof err === "string") return err.startsWith("0x") ? err : undefined;
    const e = err as Record<string, any>;
    return (
      e?.data ??
      e?.error?.data ??
      e?.info?.error?.data ??
      e?.cause?.data ??
      (typeof e?.revert?.data === "string" ? e.revert.data : undefined)
    );
  }

  /* ------------------------------- Assertion layer ------------------------------- */

  /** Slippage is a hard gate: both 0 (unprotected) and >5% are refused outright */
  private assertSlippage(bps: number): void {
    if (!Number.isInteger(bps) || bps < MIN_SLIPPAGE_BPS) {
      throw new SdkError(
        "SLIPPAGE_NOT_SET",
        `slippageBps must be an integer in [${MIN_SLIPPAGE_BPS}, ${MAX_SLIPPAGE_BPS}]; ` +
          `0 means "no protection" and is refused by design`,
        { slippageBps: bps },
      );
    }
    if (bps > MAX_SLIPPAGE_BPS) {
      throw new SdkError("SLIPPAGE_TOO_HIGH", `slippageBps must be <= ${MAX_SLIPPAGE_BPS}`, {
        slippageBps: bps,
      });
    }
  }

  private assertOutcome(outcome: number): void {
    if (outcome !== 0 && outcome !== 1) {
      throw new SdkError("BAD_OUTCOME", "outcome must be 0 (NO) or 1 (YES)", { outcome });
    }
  }

  private assertTradable(state: MarketState, amountIn: bigint): void {
    if (state.resolved) {
      throw new SdkError("MARKET_RESOLVED", "market already resolved", { outcome: state.outcome });
    }
    if (state.paused) throw new SdkError("TRADING_PAUSED", "trading is paused");
    if (!state.tradingOpen) {
      throw new SdkError("TRADING_PAUSED", "trading window closed", {
        resolutionTime: state.resolutionTime,
      });
    }
    if (amountIn < state.minBet) {
      throw new SdkError("BELOW_MIN_BET", `amountIn below minBet`, {
        amountIn: amountIn.toString(),
        minBet: state.minBet.toString(),
      });
    }

    if (amountIn > state.maxBet) {
      throw new SdkError("ABOVE_MAX_BET", "amountIn exceeds the absolute per-trade cap", {
        amountIn: amountIn.toString(),
        maxBet: state.maxBet.toString(),
      });
    }

    const cap = (state.depth * (state.maxImpactBps - BigInt(this.impactMarginBps))) / BPS;
    if (amountIn > cap) {
      throw new SdkError("IMPACT_TOO_HIGH", "amountIn exceeds max impact cap — would revert", {
        amountIn: amountIn.toString(),
        cap: cap.toString(),
        maxImpactBps: state.maxImpactBps.toString(),
      });
    }
    if (state.depth === 0n) {
      throw new SdkError("INSUFFICIENT_DEPTH", "pool has no liquidity");
    }
  }

  /* ------------------------------- Helper math ------------------------------- */

  /**
   * Price impact = post-trade price movement relative to the pre-trade price (bps).
   * Computed from the same reserve deltas the contract uses: after buying `outcome`, the opposing reserve on
   * that side grows by `net`.
   */
  private priceImpactBps(
    state: MarketState,
    outcome: Outcome,
    amountIn: bigint,
    sharesOut: bigint,
  ): number {
    const WAD = 10n ** 18n;
    const fee = ceilDiv(amountIn * state.tradeFeeBps, BPS);
    const net = amountIn - fee;

    let before: bigint;
    let after: bigint;
    if (outcome === 1) {
      before = (state.noReserve * WAD) / state.depth;
      const newNo = state.noReserve + net;
      const newYes = state.yesReserve - sharesOut;
      after = newNo + newYes === 0n ? 0n : (newNo * WAD) / (newNo + newYes);
    } else {
      before = (state.yesReserve * WAD) / state.depth;
      const newYes = state.yesReserve + net;
      const newNo = state.noReserve - sharesOut;
      after = newNo + newYes === 0n ? 0n : (newYes * WAD) / (newNo + newYes);
    }
    if (before === 0n) return 0;
    return Number(((after - before) * BPS) / before);
  }

  private effectivePrice(amountIn: bigint, sharesOut: bigint): number {
    if (sharesOut === 0n) return 0;
    return Number(amountIn) / 1e6 / (Number(sharesOut) / 1e6);
  }

  private async call(selector: string): Promise<string> {
    return this.transport.ethCall(this.vault, selector);
  }
}

/* ------------------------------- Adapters ------------------------------- */

/** viem PublicClient adapter (client.call returns { data }) */
export function viemTransport(client: {
  call(args: { to: string; data: string }): Promise<{ data?: string }>;
}): EthCallTransport {
  return {
    async ethCall(to, data) {
      const res = await client.call({ to: to as `0x${string}`, data: data as `0x${string}` });
      if (!res.data) throw new Error("viem returned empty data");
      return res.data;
    },
  };
}

/** ethers v6 Provider adapter */
export function ethersTransport(provider: {
  call(tx: { to: string; data: string }): Promise<string>;
}): EthCallTransport {
  return {
    ethCall: (to, data) => provider.call({ to, data }),
  };
}

export const __internals = {
  padWord,
  padAddress,
  padBytes32,
  word,
  addr,
  withTimeout,
  routesForChain,
  mevProtectedRoute,
  KNOWN_ROUTES,
  SEL,
  SEL_CREATE_MARKET,
  SEL_TRANSFER_ADMIN,
  SEL_ACCEPT_ADMIN,
  SEL_PREVIEW_BUY,
  SEL_BUY,
  BPS,
  REVERT_MAP,
};
