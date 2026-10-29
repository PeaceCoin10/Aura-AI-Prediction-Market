/**
 * CentralPredictionSDK unit tests
 *
 * Run: cd sdk && npm test        (or npx tsc -p tsconfig.json && node dist/CentralPredictionSDK.test.js)
 *
 * Two layers of verification:
 *   1) **Byte-exact calldata**: every hand-rolled encoding is diffed against `cast calldata` (Solidity's
 *      own encoder); one differing byte fails the test. Selector tables are checked against `cast sig` the
 *      same way — hand-copied constants are never trusted.
 *   2) **Preflight and error mapping**: MockTransport manufactures on-chain states (too early, dispute
 *      window, paused, unauthorized...), asserting that the SDK blocks locally and that revert data maps
 *      to the English message attached to each error code.
 *
 * Offline pricing uses fixtures generated from **real chain data** (a real contract deployed on anvil with
 * 10,000 USDC of seeded liquidity, then measured); the generation commands are noted at the end of the file.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  CentralPredictionSDK,
  SdkError,
  SEL,
  ERROR_SELECTORS,
  decodeRevert,
  previewBuyOffline,
  previewSellOffline,
  priceYesOffline,
  formatUsdc,
  parseUsdc,
  uintWord,
  addressWord,
  OUTCOME_NO,
  OUTCOME_YES,
  OUTCOME_INVALID,
  SLIPPAGE_CONSERVATIVE,
  SLIPPAGE_NORMAL,
  SLIPPAGE_DEGEN,
  IMPACT_WARN_BPS,
  MULTICALL3,
  SEL_AGGREGATE3,
  EVENT_TOPICS,
  encodeAggregate3,
  decodeAggregate3Result,
  decodeLog,
  decodeLogs,
  decodeString,
  eventNameOf,
  eventTopic,
  type Address,
  type Hex,
  type Transport,
} from "./CentralPredictionSDK";

/* ------------------------------- Test runner ------------------------------- */

const cases: Array<[string, () => void | Promise<void>]> = [];
function test(name: string, fn: () => void | Promise<void>): void {
  cases.push([name, fn]);
}

function eq(actual: unknown, expected: unknown, what: string): void {
  assert.deepEqual(actual, expected, `${what}: expected ${String(expected)}, got ${String(actual)}`);
}

async function expectThrow(fn: () => Promise<unknown>, code: string, contains?: string): Promise<SdkError> {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof SdkError, `expected an SdkError, got ${String(err)}`);
    const e = err as SdkError;
    eq(e.code, code, "error code");
    if (contains) assert.ok(e.message.includes(contains), `message should contain "${contains}", got "${e.message}"`);
    return e;
  }
  throw new Error(`expected ${code} to be thrown, but the call succeeded`);
}

/* ------------------------------- cast as the reference ------------------------------- */

const CAST_ENV = { ...process.env, PATH: `/opt/foundry:${process.env.PATH ?? ""}` };

function cast(args: string[]): string {
  const r = spawnSync("cast", args, { encoding: "utf8", env: CAST_ENV });
  if (r.status !== 0) throw new Error(`cast ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

const castCalldata = (sig: string, args: string[]): Hex => cast(["calldata", sig, ...args]) as Hex;
const castSig = (sig: string): Hex => cast(["sig", sig]) as Hex;

/* ------------------------------- Mock chain ------------------------------- */

const ENGINE = "0x00000000000000000000000000000000000e0e0e" as Address;
const ACCOUNT = "0x00000000000000000000000000000000000acc01" as Address;
const ADMIN = "0x000000000000000000000000000000000000ad01" as Address;
const MARKET = ("0x" + "11".repeat(32)) as Hex;

interface MockState {
  exists: boolean;
  resolved: boolean;
  finalized: boolean;
  disputing: boolean;
  outcome: number;
  resolutionTime: bigint;
  yesReserve: bigint;
  noReserve: bigint;
  cash: bigint;
  owed: bigint;
  volume: bigint;
  creator: Address;
  paused: boolean;
  creatorRole: boolean;
  oracleRole: boolean;
  adminAddr: Address;
  yesOf: bigint;
  noOf: bigint;
  nowTs: bigint;
  quoteSkew: bigint; // deliberately skews the on-chain quote so drift detection can be exercised
}

function baseState(): MockState {
  return {
    exists: true,
    resolved: false,
    finalized: false,
    disputing: false,
    outcome: 0,
    resolutionTime: 2_000_000_000n,
    yesReserve: 10_000_000_000n,
    noReserve: 10_000_000_000n,
    cash: 10_000_000_000n,
    owed: 0n,
    volume: 0n,
    creator: ACCOUNT,
    paused: false,
    creatorRole: true,
    oracleRole: true,
    adminAddr: ADMIN,
    yesOf: 0n,
    noOf: 0n,
    nowTs: 1_800_000_000n,
    quoteSkew: 0n,
  };
}

function words(...vals: (bigint | string)[]): Hex {
  return ("0x" + vals.map((v) => (typeof v === "bigint" ? uintWord(v) : v)).join("")) as Hex;
}

/** ABI-encode a string return value (offset=32 / len / UTF-8 bytes) */
function stringWord(text: string): Hex {
  const hex = Buffer.from(text, "utf8").toString("hex");
  const body = hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");
  return ("0x" + uintWord(32n) + uintWord(BigInt(hex.length / 2)) + body) as Hex;
}

function makeTransport(state: MockState): Transport & { calls: string[] } {
  const calls: string[] = [];
  const t = {
    calls,
    now: async (): Promise<bigint> => state.nowTs,
    ethCall: async (_to: Address, data: Hex): Promise<Hex> => {
      const sel = data.slice(0, 10).toLowerCase();
      calls.push(sel);
      switch (sel) {
        case SEL.marketCore:
          return words(
            state.yesReserve,
            state.noReserve,
            state.cash,
            state.owed,
            state.volume,
            state.resolutionTime,
            state.nowTs,
            addressWord(state.creator),
            BigInt(state.outcome),
            state.resolved ? 1n : 0n,
            state.exists ? 1n : 0n,
          );
        case SEL.resolutionState:
          return words(
            state.resolved ? 1n : 0n,
            state.finalized ? 1n : 0n,
            state.disputing ? 1n : 0n,
            BigInt(state.outcome),
            state.disputing ? state.nowTs + 3600n : 0n,
            state.owed,
          );
        case SEL.yesOf:
          return words(state.yesOf);
        case SEL.noOf:
          return words(state.noOf);
        case SEL.paused:
          return words(state.paused ? 1n : 0n);
        case SEL.creators:
          return words(state.creatorRole ? 1n : 0n);
        case SEL.oracles:
          return words(state.oracleRole ? 1n : 0n);
        case SEL.admin:
          return words(addressWord(state.adminAddr));
        case SEL.minBet:
          return words(5_000_000n);
        case SEL.maxBet:
          return words(10_000_000_000n);
        case SEL.minTradingWindow:
          return words(3600n);
        case SEL.maxTradingWindow:
          return words(31_536_000n);
        case SEL.disputeWindow:
          return words(3600n);
        case SEL.refundDelay:
          return words(604_800n);
        case SEL.tradeFeeBps:
          return words(150n);
        case SEL.settleFeeBps:
          return words(50n);
        case SEL.depth:
          return words(state.yesReserve + state.noReserve);
        case SEL.marketCount:
          return words(1n);
        case SEL.marketIds:
          return words("11".repeat(32));
        case SEL.marketQuestion:
          return stringWord("Will BTC break 82,000 within 24 hours?");
        case SEL.marketCategory:
          return stringWord("crypto");
        case SEL.priceYes:
          return words((state.noReserve * 10n ** 18n) / (state.yesReserve + state.noReserve));
        case SEL.isFinal:
          return words(state.finalized ? 1n : 0n);
        case SEL.tradingOpen:
          return words(state.exists && !state.resolved && !state.paused ? 1n : 0n);
        case SEL.previewBuy: {
          const body = data.slice(10);
          const outcome = Number(BigInt("0x" + body.slice(64, 128)));
          const amountIn = BigInt("0x" + body.slice(128, 192));
          return words(previewBuyOffline({ yesReserve: state.yesReserve, noReserve: state.noReserve }, outcome as 0 | 1, amountIn) + state.quoteSkew);
        }
        case SEL.previewSell: {
          const body = data.slice(10);
          const outcome = Number(BigInt("0x" + body.slice(64, 128)));
          const sharesIn = BigInt("0x" + body.slice(128, 192));
          return words(previewSellOffline({ yesReserve: state.yesReserve, noReserve: state.noReserve }, outcome as 0 | 1, sharesIn) + state.quoteSkew);
        }
        default:
          throw new Error(`MockTransport has no handler for selector ${sel}`);
      }
    },
  };
  return t as Transport & { calls: string[] };
}

function sdkFor(state: MockState, account: Address | undefined = ACCOUNT): CentralPredictionSDK {
  return new CentralPredictionSDK(makeTransport(state), { engine: ENGINE, chainId: 8453, account });
}

/* ============================ A. Selectors and ABI alignment ============================ */

const SIG_MAP: Record<keyof typeof SEL, string> = {
  createMarket: "createMarket(bytes32,string,uint256)",
  createMarketWithMeta: "createMarketWithMeta(bytes32,string,string,uint256)",
  buyShares: "buyShares(bytes32,uint8,uint256,uint256)",
  sellShares: "sellShares(bytes32,uint8,uint256,uint256)",
  redeem: "redeem(bytes32)",
  resolveMarket: "resolveMarket(bytes32,uint8)",
  overrideResolution: "overrideResolution(bytes32,uint8)",
  previewBuy: "previewBuy(bytes32,uint8,uint256)",
  previewSell: "previewSell(bytes32,uint8,uint256)",
  marketCore: "marketCore(bytes32)",
  resolutionState: "resolutionState(bytes32)",
  yesOf: "yesOf(bytes32,address)",
  noOf: "noOf(bytes32,address)",
  paused: "paused()",
  admin: "admin()",
  creators: "creators(address)",
  oracles: "oracles(address)",
  minBet: "MIN_BET()",
  maxBet: "MAX_BET()",
  minTradingWindow: "MIN_TRADING_WINDOW()",
  maxTradingWindow: "MAX_TRADING_WINDOW()",
  disputeWindow: "DISPUTE_WINDOW()",
  refundDelay: "REFUND_DELAY()",
  depth: "depth(bytes32)",
  priceYes: "priceYes(bytes32)",
  marketCount: "marketCount()",
  marketIds: "marketIds(uint256)",
  marketQuestion: "marketQuestion(bytes32)",
  marketCategory: "marketCategory(bytes32)",
  isFinal: "isFinal(bytes32)",
  tradingOpen: "tradingOpen(bytes32)",
  tradeFeeBps: "TRADE_FEE_BPS()",
  settleFeeBps: "SETTLE_FEE_BPS()",
};

test("all 28 selectors match cast sig (compiler ABI)", () => {
  for (const [key, sig] of Object.entries(SIG_MAP)) {
    eq(SEL[key as keyof typeof SEL], castSig(sig), `${key} ${sig}`);
  }
});

test("error selector table matches cast sig (all 36 custom errors)", () => {
  const errs: Array<[string, string]> = [
    ["0x5688ffb3", "BelowMinBet()"],
    ["0xb8ab88d4", "AboveMaxBet()"],
    ["0x22410594", "ImpactTooHigh()"],
    ["0x87920b43", "DisputeWindowOpen()"],
    ["0x435a3cfe", "DisputeWindowClosed()"],
    ["0x47bc7cc8", "OnlyCreator()"],
    ["0x80fee105", "OnlyOracle()"],
    ["0x47556579", "OnlyAdmin()"],
    ["0x7db1be50", "MarketNotFound()"],
    ["0x8fc6f59b", "MarketExists()"],
    ["0x1db9461a", "MarketResolvedAlready()"],
    ["0x9f4a6489", "NotResolved()"],
    ["0xc74a206d", "InvalidOutcome()"],
    ["0x81e1c048", "InvalidQuestion()"],
    ["0x10549aa0", "InvalidResolutionTime()"],
    ["0xe2c865df", "TradingClosed()"],
    ["0xd93c0665", "EnforcedPause()"],
    ["0x0fce133d", "TooEarlyToResolve()"],
    ["0xb5b6d675", "RefundWindowNotReached()"],
    ["0x9890af60", "NothingToRedeem()"],
    ["0x351261fc", "NothingToSweep()"],
    ["0x03580407", "BelowMinSeed()"],
    ["0x9811e0c7", "ZeroShares()"],
    ["0x8199f5f3", "SlippageExceeded()"],
    ["0xbb55fd27", "InsufficientLiquidity()"],
    ["0x3f8dadf7", "SameOutcome()"],
    ["0xd92e233d", "ZeroAddress()"],
    ["0x6f7c43f1", "NotContract()"],
    ["0x5274afe7", "SafeERC20FailedOperation(address)"],
    ["0xcd786059", "AddressInsufficientBalance(address)"],
    ["0x9996b315", "AddressEmptyCode(address)"],
    ["0x1425ea42", "FailedInnerCall()"],
    ["0x227bc153", "MathOverflowedMulDiv()"],
    ["0x3ee5aeb5", "ReentrancyGuardReentrantCall()"],
  ];
  for (const [sel, sig] of errs) {
    eq(sel, castSig(sig), `${sig}`);
    assert.ok(ERROR_SELECTORS[sel], `${sig} is missing from ERROR_SELECTORS`);
  }
  // The three customer-supplied entries must hit exactly
  eq(ERROR_SELECTORS["0x5688ffb3"]?.code, "chain/BELOW_MIN_BET", "BelowMinBet mapping");
  eq(ERROR_SELECTORS["0xb8ab88d4"]?.code, "chain/ABOVE_MAX_BET", "AboveMaxBet mapping");
  eq(ERROR_SELECTORS["0x22410594"]?.code, "chain/IMPACT_TOO_HIGH", "ImpactTooHigh mapping");
});

/* ============================ B. Byte-exact calldata ============================ */

const Q = "Will BTC break 82,000 within 24 hours?"; // non-ASCII, exercises the UTF-8 path
/** Resolution time used for market creation: the fixture's nowTs is 1_800_000_000, so +24h lands in range */
const RT = 1_800_000_000n + 86_400n;

test("buildCreateMarket (3 args) → createMarket(bytes32,string,uint256) calldata is byte-identical to cast", async () => {
  const state = baseState();
  state.exists = false; // the market cannot exist before it is created
  const sdk = sdkFor(state);
  const plan = await sdk.buildCreateMarket({ marketId: MARKET, question: Q, resolutionTime: RT });
  eq(plan.method, "createMarket", "method");
  eq(plan.data, castCalldata("createMarket(bytes32,string,uint256)", [MARKET, Q, String(RT)]), "calldata");
  eq(plan.to, ENGINE, "to");
  eq(plan.value, "0x0", "value");
});

test("buildCreateMarket (with meta.category) → createMarketWithMeta calldata is byte-identical to cast", async () => {
  const fresh = baseState();
  fresh.exists = false;
  const sdk = sdkFor(fresh);
  const plan = await sdk.buildCreateMarket({
    marketId: MARKET,
    question: Q,
    resolutionTime: RT,
    meta: { category: "crypto" },
  });
  eq(plan.method, "createMarketWithMeta", "method");
  eq(
    plan.data,
    castCalldata("createMarketWithMeta(bytes32,string,string,uint256)", [MARKET, Q, "crypto", String(RT)]),
    "calldata",
  );
});

test("buildBuyShares → buyShares calldata is byte-identical to cast", async () => {
  const sdk = sdkFor(baseState());
  const plan = await sdk.buildBuyShares({ marketId: MARKET, outcome: OUTCOME_YES, amountIn: 100_000_000n, slippageBps: 100 });
  const minSharesOut = String(plan.meta.minSharesOut);
  eq(plan.data, castCalldata("buyShares(bytes32,uint8,uint256,uint256)", [MARKET, "1", "100000000", minSharesOut]), "calldata");
  // 100 bps = 1%: quote 196,039,238 → floor 194,078,845
  eq(minSharesOut, "194078845", "minSharesOut");
});

test("buildSellShares → sellShares calldata is byte-identical to cast", async () => {
  const state = baseState();
  state.yesOf = 1_000_000_000n;
  const sdk = sdkFor(state);
  const plan = await sdk.buildSellShares({ marketId: MARKET, outcome: OUTCOME_YES, sharesIn: 1_000_000_000n, slippageBps: 50 });
  eq(plan.data, castCalldata("sellShares(bytes32,uint8,uint256,uint256)", [MARKET, "1", "1000000000", String(plan.meta.minAmountOut)]), "calldata");
});

test("buildRedeem → redeem calldata is byte-identical to cast", async () => {
  const state = baseState();
  state.resolved = true;
  state.finalized = true;
  state.outcome = 1;
  state.yesOf = 500n;
  const sdk = sdkFor(state);
  const plan = await sdk.buildRedeem({ marketId: MARKET });
  eq(plan.data, castCalldata("redeem(bytes32)", [MARKET]), "calldata");
});

test("buildResolveMarket → resolveMarket calldata is byte-identical to cast", async () => {
  const state = baseState();
  state.nowTs = 2_000_000_001n;
  const sdk = sdkFor(state);
  const plan = await sdk.buildResolveMarket({ marketId: MARKET, outcome: OUTCOME_NO });
  eq(plan.data, castCalldata("resolveMarket(bytes32,uint8)", [MARKET, "0"]), "calldata");
});

test("buildOverrideResolution → overrideResolution calldata is byte-identical to cast", async () => {
  const state = baseState();
  state.resolved = true;
  state.disputing = true;
  state.outcome = 1;
  const sdk = sdkFor(state, ADMIN);
  const plan = await sdk.buildOverrideResolution({ marketId: MARKET, newOutcome: OUTCOME_INVALID });
  eq(plan.data, castCalldata("overrideResolution(bytes32,uint8)", [MARKET, "2"]), "calldata");
});

/* ============================ C. Anti-sandwich and protection-floor checks ============================ */

test("minSharesOut=0 is rejected outright (no unprotected orders)", async () => {
  const sdk = sdkFor(baseState());
  await expectThrow(
    () => sdk.buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n, minSharesOut: 0n }),
    "local/MIN_OUT_REQUIRED",
    "minSharesOut",
  );
});

test("omitting both minSharesOut and slippageBps is rejected", async () => {
  const sdk = sdkFor(baseState());
  await expectThrow(
    () => sdk.buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n }),
    "local/MIN_OUT_REQUIRED",
  );
});

test("minSharesOut above the quote is rejected (the trade cannot fill)", async () => {
  const sdk = sdkFor(baseState());
  await expectThrow(
    () => sdk.buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n, minSharesOut: 999_999_999n }),
    "local/MIN_OUT_ABOVE_QUOTE",
  );
});

test("minSharesOut below 95% of the quote is rejected (loose tolerance means no protection)", async () => {
  const sdk = sdkFor(baseState());
  await expectThrow(
    () => sdk.buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n, minSharesOut: 1n }),
    "local/SLIPPAGE_TOO_LOOSE",
  );
});

test("out-of-range slippage (0 / 501 bps) is rejected", async () => {
  const sdk = sdkFor(baseState());
  await expectThrow(
    () => sdk.buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n, slippageBps: 0 }),
    "local/SLIPPAGE_OUT_OF_RANGE",
  );
  await expectThrow(
    () => sdk.buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n, slippageBps: 501 }),
    "local/SLIPPAGE_OUT_OF_RANGE",
  );
});

test("supplying both minSharesOut and slippageBps picks the stricter one", async () => {
  const sdk = sdkFor(baseState());
  const plan = await sdk.buildBuyShares({
    marketId: MARKET,
    outcome: 1,
    amountIn: 100_000_000n,
    slippageBps: 500, // floor = quote × 95% = 186,237,276
    minSharesOut: 190_000_000n, // the stricter of the two
  });
  eq(plan.meta.minSharesOut, "190000000", "stricter value wins");
});

test("confirmQuoteStillValid: quote unchanged → passes", async () => {
  const sdk = sdkFor(baseState());
  const plan = await sdk.buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n, slippageBps: 100 });
  await sdk.confirmQuoteStillValid(plan, 60_000);
});

test("confirmQuoteStillValid: pool dumped and quote falls through the floor → aborts", async () => {
  const state = baseState();
  const sdk = sdkFor(state);
  const plan = await sdk.buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n, slippageBps: 100 });
  // The attacker dumps into the small pool: yesReserve collapses
  state.yesReserve = 1_000_000_000n;
  state.noReserve = 19_000_000_000n;
  await expectThrow(() => sdk.confirmQuoteStillValid(plan, 60_000), "chain/SLIPPAGE_EXCEEDED", "Price moved");
});

test("confirmQuoteStillValid: stale quote → aborts", async () => {
  const sdk = sdkFor(baseState());
  const plan = await sdk.buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n, slippageBps: 100 });
  await new Promise((r) => setTimeout(r, 5));
  await expectThrow(() => sdk.confirmQuoteStillValid(plan, 1), "local/SLIPPAGE_TOO_LOOSE", "Quote expired");
});

/* ============================ D. Preflight across on-chain states ============================ */

test("market does not exist", async () => {
  const state = baseState();
  state.exists = false;
  await expectThrow(
    () => sdkFor(state).buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n, slippageBps: 100 }),
    "local/MARKET_NOT_FOUND",
  );
});

test("below the minimum bet (5 USDC)", async () => {
  await expectThrow(
    () => sdkFor(baseState()).buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 4_999_999n, slippageBps: 100 }),
    "chain/BELOW_MIN_BET",
  );
});

test("above the per-trade cap (10,000 USDC)", async () => {
  const state = baseState();
  state.yesReserve = 10_000_000_000_000n;
  state.noReserve = 10_000_000_000_000n;
  await expectThrow(
    () => sdkFor(state).buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 10_000_000_001n, slippageBps: 100 }),
    "chain/ABOVE_MAX_BET",
  );
});

test("price impact above 5% of the pool", async () => {
  // Depth 20,000 USDC → cap 1,000 USDC, so a 1,001 USDC order must be blocked
  await expectThrow(
    () => sdkFor(baseState()).buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 1_001_000_000n, slippageBps: 100 }),
    "chain/IMPACT_TOO_HIGH",
  );
});

test("past resolution time → trading closed", async () => {
  const state = baseState();
  state.resolutionTime = state.nowTs - 1n;
  await expectThrow(
    () => sdkFor(state).buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n, slippageBps: 100 }),
    "local/TRADING_CLOSED",
  );
});

test("resolved / paused are both blocked", async () => {
  const resolved = baseState();
  resolved.resolved = true;
  await expectThrow(
    () => sdkFor(resolved).buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n, slippageBps: 100 }),
    "local/MARKET_RESOLVED",
  );

  const paused = baseState();
  paused.paused = true;
  await expectThrow(
    () => sdkFor(paused).buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n, slippageBps: 100 }),
    "local/MARKET_PAUSED",
  );
});

test("local quote disagreeing with the chain is blocked (ABI/model drift)", async () => {
  const state = baseState();
  state.quoteSkew = 1n;
  await expectThrow(
    () => sdkFor(state).buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n, slippageBps: 100 }),
    "local/QUOTE_MISMATCH",
  );
});

test("selling more than the position holds", async () => {
  const state = baseState();
  state.yesOf = 100n;
  await expectThrow(
    () => sdkFor(state).buildSellShares({ marketId: MARKET, outcome: 1, sharesIn: 101n, slippageBps: 100 }),
    "local/INSUFFICIENT_SHARES",
  );
});

test("create market: question too short / category too long / resolution time out of range", async () => {
  const fresh = baseState();
  fresh.exists = false;
  const sdk = sdkFor(fresh);
  await expectThrow(
    () => sdk.buildCreateMarket({ marketId: MARKET, question: "Shrt", resolutionTime: RT }),
    "local/QUESTION_LENGTH",
  );
  await expectThrow(
    () =>
      sdk.buildCreateMarket({
        marketId: MARKET,
        question: Q,
        resolutionTime: RT,
        meta: { category: "x".repeat(33) },
      }),
    "local/CATEGORY_LENGTH",
  );
  await expectThrow(
    () => sdk.buildCreateMarket({ marketId: MARKET, question: Q, resolutionTime: 1_800_000_100n }),
    "local/RESOLUTION_TIME_RANGE",
  );
  await expectThrow(
    () => sdk.buildCreateMarket({ marketId: MARKET, question: Q, resolutionTime: 9_999_999_999n }),
    "local/RESOLUTION_TIME_RANGE",
  );
});

test("create market: market exists / no creation permission", async () => {
  const exists = baseState();
  await expectThrow(
    () => sdkFor(exists).buildCreateMarket({ marketId: MARKET, question: Q, resolutionTime: RT }),
    "local/MARKET_EXISTS",
  );
  const noRole = baseState();
  noRole.exists = false;
  noRole.creatorRole = false;
  await expectThrow(
    () => sdkFor(noRole).buildCreateMarket({ marketId: MARKET, question: Q, resolutionTime: RT }),
    "local/NOT_CREATOR",
  );
});

test("resolve: too early / no permission / already resolved", async () => {
  const early = baseState();
  early.nowTs = 1_900_000_000n;
  await expectThrow(
    () => sdkFor(early).buildResolveMarket({ marketId: MARKET, outcome: 1 }),
    "chain/TOO_EARLY_TO_RESOLVE",
  );

  const noRole = baseState();
  noRole.nowTs = 2_000_000_001n;
  noRole.oracleRole = false;
  await expectThrow(() => sdkFor(noRole).buildResolveMarket({ marketId: MARKET, outcome: 1 }), "local/NOT_ORACLE");

  const done = baseState();
  done.nowTs = 2_000_000_001n;
  done.resolved = true;
  await expectThrow(() => sdkFor(done).buildResolveMarket({ marketId: MARKET, outcome: 1 }), "local/MARKET_RESOLVED");
});

test("redeem: blocked inside the dispute window (the window end is reported)", async () => {
  const state = baseState();
  state.resolved = true;
  state.disputing = true;
  state.outcome = 1;
  state.yesOf = 1_000n;
  const err = await expectThrow(() => sdkFor(state).buildRedeem({ marketId: MARKET }), "chain/DISPUTE_WINDOW_OPEN", "dispute window");
  assert.ok(err.message.includes("T"), "message should carry the dispute-window deadline");
});

test("redeem: not resolved / nothing held / paused (under 7 days) are all blocked", async () => {
  await expectThrow(() => sdkFor(baseState()).buildRedeem({ marketId: MARKET }), "local/MARKET_NOT_RESOLVED");

  const empty = baseState();
  empty.resolved = true;
  empty.finalized = true;
  await expectThrow(() => sdkFor(empty).buildRedeem({ marketId: MARKET }), "chain/NOTHING_TO_REDEEM");

  const paused = baseState();
  paused.resolved = true;
  paused.finalized = true;
  paused.paused = true;
  paused.yesOf = 1n;
  paused.resolutionTime = paused.nowTs - 3600n; // not yet resolution+7d, so the pause still bites
  await expectThrow(() => sdkFor(paused).buildRedeem({ marketId: MARKET }), "local/MARKET_PAUSED");
});

test("redeem: paused but past resolution + 7 days → allowed, matching the contract", async () => {
  const state = baseState();
  state.resolved = true;
  state.finalized = true;
  state.paused = true;
  state.yesOf = 1n;
  state.resolutionTime = state.nowTs - 604_801n;
  const plan = await sdkFor(state).buildRedeem({ marketId: MARKET });
  eq(plan.method, "redeem", "method");
});

test("override: non-admin / finalized / outside the dispute window / same outcome are all blocked", async () => {
  const notAdmin = baseState();
  notAdmin.resolved = true;
  notAdmin.disputing = true;
  await expectThrow(
    () => sdkFor(notAdmin, ACCOUNT).buildOverrideResolution({ marketId: MARKET, newOutcome: 0 }),
    "local/NOT_ADMIN",
  );

  const final = baseState();
  final.resolved = true;
  final.finalized = true;
  await expectThrow(
    () => sdkFor(final, ADMIN).buildOverrideResolution({ marketId: MARKET, newOutcome: 0 }),
    "local/ALREADY_FINAL",
  );

  const notDisputing = baseState();
  notDisputing.resolved = true;
  notDisputing.disputing = false;
  await expectThrow(
    () => sdkFor(notDisputing, ADMIN).buildOverrideResolution({ marketId: MARKET, newOutcome: 0 }),
    "local/NOT_DISPUTING",
  );

  const same = baseState();
  same.resolved = true;
  same.disputing = true;
  same.outcome = 1;
  await expectThrow(
    () => sdkFor(same, ADMIN).buildOverrideResolution({ marketId: MARKET, newOutcome: 1 }),
    "local/SAME_OUTCOME",
  );
});

/* ============================ E. Error decoding ============================ */

test("decodeRevert: the three customer-supplied selectors map to English messages", () => {
  const e1 = decodeRevert({ data: "0x5688ffb3" });
  eq(e1.code, "chain/BELOW_MIN_BET", "BelowMinBet");
  assert.ok(e1.message.includes("5 USDC"));
  assert.ok(e1.onchain);

  const e2 = decodeRevert({ data: "0xb8ab88d4" });
  eq(e2.code, "chain/ABOVE_MAX_BET", "AboveMaxBet");

  const e3 = decodeRevert({ data: "0x22410594" });
  eq(e3.code, "chain/IMPACT_TOO_HIGH", "ImpactTooHigh");
  assert.ok(e3.message.includes("5%"));
});

test("decodeRevert: DisputeWindowOpen and the role errors map to English messages", () => {
  eq(decodeRevert({ data: "0x87920b43" }).code, "chain/DISPUTE_WINDOW_OPEN", "DisputeWindowOpen");
  for (const sel of ["0x47bc7cc8", "0x80fee105", "0x47556579"]) {
    const e = decodeRevert({ data: sel });
    eq(e.code, "chain/NOT_AUTHORIZED_ROLE", `role error ${sel}`);
    assert.ok(e.message.includes("not authorized"));
  }
});

test("decodeRevert: Error(string) passes through / Panic carries its code / unknown selector falls back", () => {
  const reason = "insufficient allowance";
  const hex = Buffer.from(reason, "utf8").toString("hex").padEnd(64, "0");
  const data = "0x08c379a0" + uintWord(32n) + uintWord(BigInt(reason.length)) + hex;
  const e = decodeRevert({ data });
  eq(e.code, "chain/REVERT_STRING", "Error(string)");
  eq(e.message, reason, "surfaces the raw reason");

  const p = decodeRevert({ data: "0x4e487b71" + uintWord(0x11n) });
  eq(p.code, "chain/PANIC", "panic");
  assert.ok(p.message.includes("0x11"));

  const u = decodeRevert({ data: "0xdeadbeef" });
  eq(u.code, "chain/UNKNOWN", "unknown");
  assert.ok(u.message.includes("0xdeadbeef"));

  const bare = decodeRevert(new Error("execution reverted"));
  eq(bare.code, "chain/UNKNOWN", "no data");
});

test("decodeRevert: digs revert data out of a nested provider error", () => {
  const nested = { error: { data: { data: "0x87920b43" } } };
  eq(decodeRevert(nested).code, "chain/DISPUTE_WINDOW_OPEN", "nested error.data.data");
});

/* ============================ F. Offline pricing (real-chain fixtures) ============================ */

/**
 * Fixture source: a real contract deployed on anvil, then createMarket + seedLiquidity(10,000 USDC):
 *   previewBuy(YES, 100e6)  = 196039238
 *   previewBuy(NO,  100e6)  = 196039238
 *   previewSell(YES, 1000e6)= 479539473
 * then after buying 100e6 of YES (yesReserve=9902460762, noReserve=10098500000):
 *   previewBuy(YES, 50e6)   = 97309539
 *   previewSell(YES, 50e6)  = 24835806
 */
test("previewBuyOffline matches on-chain previewBuy exactly", () => {
  const pool = { yesReserve: 10_000_000_000n, noReserve: 10_000_000_000n };
  eq(previewBuyOffline(pool, OUTCOME_YES, 100_000_000n), 196_039_238n, "previewBuy(YES,100)");
  eq(previewBuyOffline(pool, OUTCOME_NO, 100_000_000n), 196_039_238n, "previewBuy(NO,100)");

  const after = { yesReserve: 9_902_460_762n, noReserve: 10_098_500_000n };
  eq(previewBuyOffline(after, OUTCOME_YES, 50_000_000n), 97_309_539n, "previewBuy(YES,50) after");
});

test("previewSellOffline matches on-chain previewSell exactly", () => {
  const pool = { yesReserve: 10_000_000_000n, noReserve: 10_000_000_000n };
  eq(previewSellOffline(pool, OUTCOME_YES, 1_000_000_000n), 479_539_473n, "previewSell(YES,1000)");

  const after = { yesReserve: 9_902_460_762n, noReserve: 10_098_500_000n };
  eq(previewSellOffline(after, OUTCOME_YES, 50_000_000n), 24_835_806n, "previewSell(YES,50) after");
});

test("buy-then-sell always loses (fee + impact); there is no free arbitrage", () => {
  const pool = { yesReserve: 10_000_000_000n, noReserve: 10_000_000_000n };
  const amountIn = 100_000_000n;
  const shares = previewBuyOffline(pool, OUTCOME_YES, amountIn);
  // Pool right after the buy
  const net = amountIn - (amountIn * 150n + 9999n) / 10_000n;
  const newYes = 10_000_000_000n - (shares - net);
  const after = { yesReserve: newYes, noReserve: 10_000_000_000n + net };
  const back = previewSellOffline(after, OUTCOME_YES, shares);
  assert.ok(back < amountIn, `selling back must return less than principal: ${back} < ${amountIn}`);
});

test("priceYes starts at 50% and rises after buying YES (price = probability)", () => {
  const pool = { yesReserve: 10_000_000_000n, noReserve: 10_000_000_000n };
  eq(priceYesOffline(pool), 500_000_000_000_000_000n, "initial 0.5");
  const after = { yesReserve: 9_902_460_762n, noReserve: 10_098_500_000n };
  assert.ok(priceYesOffline(after) > 500_000_000_000_000_000n, "price rises after buying YES");
});

/* ============================ G. Utilities ============================ */

test("formatUsdc / parseUsdc round-trip", () => {
  eq(formatUsdc(196_039_238n), "196.039238", "format");
  eq(formatUsdc(5_000_000n), "5", "whole number");
  eq(formatUsdc(1n), "0.000001", "smallest unit");
  eq(parseUsdc("5"), 5_000_000n, "parse 5");
  eq(parseUsdc("10,000".replace(",", "")), 10_000_000_000n, "parse 10000");
  assert.throws(() => parseUsdc("1.1234567"), SdkError, "more than 6 decimals must throw");
});

test("constructing the SDK: an invalid engine address throws", () => {
  assert.throws(
    () => new CentralPredictionSDK(makeTransport(baseState()), { engine: "0x1234" }),
    (err: unknown) => err instanceof SdkError && (err as SdkError).code === "local/NOT_CONNECTED",
  );
});

test("account-dependent actions throw when no account is configured", async () => {
  const sdk = new CentralPredictionSDK(makeTransport(baseState()), { engine: ENGINE });
  await expectThrow(
    () => sdk.buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n, slippageBps: 100 }),
    "local/ACCOUNT_REQUIRED",
  );
});


test("list-page reads: marketCount / marketIds / question / category (non-ASCII UTF-8)", async () => {
  const sdk = sdkFor(baseState());
  eq(await sdk.marketCount(), 1, "marketCount");
  eq(await sdk.marketId(0), ("0x" + "11".repeat(32)) as Hex, "marketIds(0)");
  eq(await sdk.marketQuestion(MARKET), "Will BTC break 82,000 within 24 hours?", "non-ASCII question");
  eq(await sdk.marketCategory(MARKET), "crypto", "category");
});

test("list-page reads: priceYes / depthOf / isFinal / tradingOpen", async () => {
  const state = baseState();
  state.resolved = true;
  state.finalized = true;
  const sdk = sdkFor(state);
  eq(await sdk.priceYes(MARKET), 500_000_000_000_000_000n, "price 50%");
  eq(await sdk.depthOf(MARKET), 20_000_000_000n, "depth");
  eq(await sdk.isFinal(MARKET), true, "finalized");
  eq(await sdk.tradingOpen(MARKET), false, "resolved → not tradeable (matches the contract's tradingOpen)");
});

test("decodeString handles empty and long multibyte payloads", () => {
  eq(decodeString(stringWord("")), "", "empty string");
  const long = "€".repeat(50);
  eq(decodeString(stringWord(long)), long, "150 bytes of multibyte text");
  eq(decodeString("0x"), "", "no data");
});

/* ============================ H. Slippage presets and impact warnings ============================ */

test("slippage presets: 0.5% / 1% / 3%, all inside the hard bounds", () => {
  eq(SLIPPAGE_CONSERVATIVE, 50n, "CONSERVATIVE");
  eq(SLIPPAGE_NORMAL, 100n, "NORMAL");
  eq(SLIPPAGE_DEGEN, 300n, "DEGEN");
  eq(IMPACT_WARN_BPS, 400n, "warning line = 80% of the cap");
  for (const p of [SLIPPAGE_CONSERVATIVE, SLIPPAGE_NORMAL, SLIPPAGE_DEGEN]) {
    assert.ok(p >= 1n && p <= 500n, `preset ${p} must be within 1..500 bps`);
  }
});

test("ordering with SLIPPAGE_NORMAL: floor = quote × 99%", async () => {
  const sdk = sdkFor(baseState());
  const plan = await sdk.buildBuyShares({ marketId: MARKET, outcome: OUTCOME_YES, amountIn: 100_000_000n, slippageBps: SLIPPAGE_NORMAL });
  const quote = BigInt(String(plan.meta.quote));
  eq(BigInt(String(plan.meta.minSharesOut)), (quote * 99n) / 100n, "minSharesOut");
  eq(plan.warning, undefined, "100 USDC against a 20,000 pool = 0.5% impact, so no warning");
});

test("impact near the 5% cap (≥4%) → warning='impact_near_limit'", async () => {
  const sdk = sdkFor(baseState()); // depth 20,000 USDC → 5% cap = 1,000 USDC
  const plan = await sdk.buildBuyShares({ marketId: MARKET, outcome: OUTCOME_YES, amountIn: 900_000_000n, slippageBps: SLIPPAGE_CONSERVATIVE });
  eq(plan.meta.impactBps, "450", "900/20000 = 450 bps");
  eq(plan.warning, "impact_near_limit", "warning expected");
});

test("impact under 4% does not warn; over 5% is rejected outright (a warning is not an exemption)", async () => {
  const sdk = sdkFor(baseState());
  const ok = await sdk.buildBuyShares({ marketId: MARKET, outcome: OUTCOME_YES, amountIn: 790_000_000n, slippageBps: SLIPPAGE_DEGEN });
  eq(ok.meta.impactBps, "395", "395 bps < 400, so no warning");
  eq(ok.warning, undefined, "no warning");

  await expectThrow(
    () => sdk.buildBuyShares({ marketId: MARKET, outcome: OUTCOME_YES, amountIn: 1_001_000_000n, slippageBps: SLIPPAGE_DEGEN }),
    "chain/IMPACT_TOO_HIGH",
  );
});

test("sells carry the impact warning too", async () => {
  const state = baseState();
  state.yesOf = 900_000_000n;
  const plan = await sdkFor(state).buildSellShares({ marketId: MARKET, outcome: OUTCOME_YES, sharesIn: 900_000_000n, slippageBps: SLIPPAGE_CONSERVATIVE });
  eq(plan.meta.impactBps, "450", "sell impact bps");
  eq(plan.warning, "impact_near_limit", "sells warn too");
});

/* ============================ I. Event decoding ============================ */

const CORE_EVENTS: Array<[string, string]> = [
  ["MarketCreated", "MarketCreated(bytes32,address,string,string,uint256)"],
  ["MarketCategoryUpdated", "MarketCategoryUpdated(bytes32,string)"],
  ["LiquiditySeeded", "LiquiditySeeded(bytes32,address,uint256)"],
  ["SharesBought", "SharesBought(bytes32,address,uint8,uint256,uint256,uint256,uint256)"],
  ["SharesSold", "SharesSold(bytes32,address,uint8,uint256,uint256,uint256,uint256)"],
  ["MarketResolved", "MarketResolved(bytes32,uint8,uint256,bool,uint256)"],
  ["DisputeWindowOpened", "DisputeWindowOpened(bytes32,uint8,uint256,uint256)"],
  ["ResolutionOverridden", "ResolutionOverridden(bytes32,uint8,uint8,uint256,uint8)"],
  ["ResolutionFinalized", "ResolutionFinalized(bytes32,uint8,uint256)"],
  ["Redeemed", "Redeemed(bytes32,address,uint256,uint256,uint256,uint256)"],
  ["ResidualSwept", "ResidualSwept(bytes32,address,uint256)"],
  ["FeeVaultUpdated", "FeeVaultUpdated(address,address)"],
  ["TreasuryUpdated", "TreasuryUpdated(address,address)"],
  ["CreatorUpdated", "CreatorUpdated(address,bool)"],
  ["OracleUpdated", "OracleUpdated(address,bool)"],
  ["Paused", "Paused(address)"],
  ["Unpaused", "Unpaused(address)"],
  ["AdminTransferStarted", "AdminTransferStarted(address,address)"],
  ["AdminTransferred", "AdminTransferred(address,address)"],
];

test("all 19 event topic0 values match cast keccak", () => {
  eq(Object.keys(EVENT_TOPICS).length, 19, "event count");
  for (const [name, sig] of CORE_EVENTS) {
    eq(EVENT_TOPICS[name as keyof typeof EVENT_TOPICS], cast(["keccak", sig]), `${name} topic0`);
  }
});

test("eventNameOf / eventTopic lookup in both directions", () => {
  eq(eventNameOf(EVENT_TOPICS.SharesBought), "SharesBought", "name from topic");
  eq(eventNameOf(EVENT_TOPICS.SharesBought.toUpperCase().replace("0X", "0x")), "SharesBought", "case-insensitive");
  eq(eventNameOf("0xdeadbeef"), null, "unknown topic returns null");
  eq(eventTopic("DisputeWindowOpened"), EVENT_TOPICS.DisputeWindowOpened, "topic from name");
});

/** An independent ABI log encoder that cross-checks the SDK decoder (deliberately separate code) */
function encLog(topic: string, indexed: string[], dyn: string[], stat: bigint[]): { topics: string[]; data: string } {
  const head: string[] = [];
  const tails: string[] = [];
  const nDyn = dyn.length;
  let tailCursor = (nDyn + stat.length) * 32;
  for (const s of dyn) {
    head.push(tailCursor.toString(16).padStart(64, "0"));
    const hex = Buffer.from(s, "utf8").toString("hex");
    const body = Math.ceil(hex.length / 64) * 64;
    tails.push((hex.padEnd(body, "0")) + "");
    // the length word goes before the payload
    tails[tails.length - 1] = BigInt(hex.length / 2).toString(16).padStart(64, "0") + hex.padEnd(body, "0");
    tailCursor += 32 + body / 2;
  }
  for (const v of stat) head.push(v.toString(16).padStart(64, "0"));
  return { topics: [topic, ...indexed], data: "0x" + head.join("") + tails.join("") };
}

test("MarketCreated: two indexed args (marketId/creator) + two dynamic strings + one timestamp", () => {
  const log = encLog(EVENT_TOPICS.MarketCreated, ["0x" + "11".repeat(32), "0".repeat(24) + ACCOUNT.slice(2).toLowerCase()], ["Will BTC break 90k in 24h?", "crypto"], [1_800_086_400n]);
  const ev = decodeLog(log);
  assert.ok(ev, "should decode");
  eq(ev!.name, "MarketCreated", "event name");
  eq(ev!.args.marketId, "0x" + "11".repeat(32), "marketId");
  eq((ev!.args.creator as string).toLowerCase(), ACCOUNT.toLowerCase(), "creator");
  eq(ev!.args.question, "Will BTC break 90k in 24h?", "non-ASCII question (UTF-8 round-trip)");
  eq(ev!.args.category, "crypto", "category");
  eq(ev!.args.resolutionTime, 1_800_086_400n, "resolutionTime");
});

test("SharesBought: 2 indexed + 5 static fields, the order must be exact", () => {
  const log = encLog(
    EVENT_TOPICS.SharesBought,
    ["0x" + "22".repeat(32), "0".repeat(24) + ACCOUNT.slice(2).toLowerCase()],
    [],
    [1n, 100_000_000n, 1_500_000n, 196_039_238n, 500_000_000_000_000_000n],
  );
  const ev = decodeLog(log)!;
  eq(ev.name, "SharesBought", "name");
  eq(ev.args.outcome, 1, "outcome=YES");
  eq(ev.args.amountIn, 100_000_000n, "amountIn");
  eq(ev.args.fee, 1_500_000n, "fee=1.5%");
  eq(ev.args.sharesOut, 196_039_238n, "sharesOut");
  eq(ev.args.priceYes, 500_000_000_000_000_000n, "priceYes");
});

test("DisputeWindowOpened: the window deadline feeds a frontend countdown directly", () => {
  const log = encLog(EVENT_TOPICS.DisputeWindowOpened, ["0x" + "33".repeat(32)], [], [0n, 1_800_003_600n, 12_345_678n]);
  const ev = decodeLog(log)!;
  eq(ev.args.outcome, 0, "NO");
  eq(ev.args.disputeEndsAt, 1_800_003_600n, "disputeEndsAt");
  eq(ev.args.owed, 12_345_678n, "owed");
});

test("ResolutionOverridden: old → new plus the override count", () => {
  const log = encLog(EVENT_TOPICS.ResolutionOverridden, ["0x" + "44".repeat(32)], [], [0n, 1n, 12_345_678n, 1n]);
  const ev = decodeLog(log)!;
  eq(ev.args.oldOutcome, 0, "oldOutcome");
  eq(ev.args.newOutcome, 1, "newOutcome");
  eq(ev.args.newOwed, 12_345_678n, "newOwed");
  eq(ev.args.disputes, 1, "disputes");
});

test("MarketResolved decodes its bool field (emergency refund) into a boolean", () => {
  const log = encLog(EVENT_TOPICS.MarketResolved, ["0x" + "55".repeat(32)], [], [2n, 1_800_003_600n, 1n, 0n]);
  const ev = decodeLog(log)!;
  eq(ev.args.outcome, 2, "INVALID");
  eq(ev.args.emergency, true, "emergency=true");
  eq(typeof ev.args.emergency, "boolean", "type must be boolean");
});

test("decodeLogs: unknown logs such as USDC Transfer are skipped, never thrown", () => {
  const known = encLog(EVENT_TOPICS.LiquiditySeeded, ["0x" + "66".repeat(32), "0".repeat(24) + ACCOUNT.slice(2).toLowerCase()], [], [10_000_000_000n]);
  const unknown = { topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"], data: "0x" };
  const evs = decodeLogs([unknown, known, unknown]);
  eq(evs.length, 1, "only recognised events kept");
  eq(evs[0].name, "LiquiditySeeded", "event name");
  eq(evs[0].args.amount, 10_000_000_000n, "amount");
});

test("decodeReceiptLogs: decodes only this engine's logs (filtered by address)", () => {
  const log = encLog(EVENT_TOPICS.Redeemed, ["0x" + "77".repeat(32), "0".repeat(24) + ACCOUNT.slice(2).toLowerCase()], [], [100n, 0n, 95_000_000n, 500_000n]);
  const sdk = sdkFor(baseState());
  const evs = sdk.decodeReceiptLogs([
    { address: ENGINE, ...log },
    { address: "0x00000000000000000000000000000000000000ff", ...log },
  ]);
  eq(evs.length, 1, "only this engine's logs");
  eq(evs[0].args.payout, 95_000_000n, "payout");
  eq(evs[0].args.fee, 500_000n, "fee");
});

/* ============================ J. Multicall3 batch reads ============================ */

/** Independent aggregate3 return-value encoder, used to validate the SDK decoder */
function encAggResult(items: Array<{ success: boolean; data: Hex }>): Hex {
  const bodies: string[] = [];
  for (const it of items) {
    const hex = it.data.slice(2);
    const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");
    bodies.push(
      (it.success ? 1n : 0n).toString(16).padStart(64, "0") +
        (64n).toString(16).padStart(64, "0") +
        BigInt(hex.length / 2).toString(16).padStart(64, "0") +
        padded,
    );
  }
  const heads: string[] = [];
  let cur = 32 * items.length;
  for (const b of bodies) {
    heads.push(BigInt(cur).toString(16).padStart(64, "0"));
    cur += b.length / 2;
  }
  return ("0x" + (32n).toString(16).padStart(64, "0") + BigInt(items.length).toString(16).padStart(64, "0") + heads.join("") + bodies.join("")) as Hex;
}

test("MULTICALL3 address and aggregate3 selector are correct", () => {
  eq(MULTICALL3, "0xcA11bde05977b3631167028862bE2a173976CA11", "Base Multicall3 address");
  eq(SEL_AGGREGATE3, cast(["sig", "aggregate3((address,bool,bytes)[])"]) as Hex, "aggregate3 selector");
});

test("encodeAggregate3 is byte-identical to cast calldata (1 and 2 calls)", () => {
  const one = encodeAggregate3([{ target: ENGINE, allowFailure: true, data: "0x313ce567" }]);
  eq(one, castCalldata("aggregate3((address,bool,bytes)[])", [`[(${ENGINE},true,0x313ce567)]`]), "1 call");
  const two = encodeAggregate3([
    { target: ENGINE, allowFailure: true, data: "0x313ce567" },
    { target: ACCOUNT, allowFailure: false, data: "0x70a08231" },
  ]);
  eq(
    two,
    castCalldata("aggregate3((address,bool,bytes)[])", [`[(${ENGINE},true,0x313ce567),(${ACCOUNT},false,0x70a08231)]`]),
    "2 calls",
  );
});

test("decodeAggregate3Result yields the (success, data) list", () => {
  const items = [
    { success: true, data: words(7n) as Hex },
    { success: false, data: "0x" as Hex },
    { success: true, data: words(42n) as Hex },
  ];
  const dec = decodeAggregate3Result(encAggResult(items));
  eq(dec.length, 3, "item count");
  eq(dec[0].success, true, "item 1 success");
  eq(BigInt(dec[0].data), 7n, "item 1 value");
  eq(dec[1].success, false, "item 2 success");
  eq(dec[2].success, true, "item 3 success");
  eq(BigInt(dec[2].data), 42n, "item 3 value");
});

/** Teach MockTransport to answer aggregate3: decode the SDK-encoded call, then fan it back out one by one */
function withMulticall(state: MockState): Transport & { calls: string[]; netCalls: string[] } {
  const base = makeTransport(state);
  const netCalls: string[] = [];
  const t = {
    calls: base.calls,
    netCalls,
    now: base.now,
    get rpcCount() {
      return base.calls.length;
    },
    ethCall: async (to: Address, data: Hex): Promise<Hex> => {
      netCalls.push(data.slice(0, 10).toLowerCase());
      if (to.toLowerCase() !== MULTICALL3.toLowerCase()) return base.ethCall(to, data);
      t.calls.push(data.slice(0, 10).toLowerCase());
      // Parse the aggregate3 arguments (length + element offsets), then forward each sub-call
      const body = data.slice(10);
      const n = Number(BigInt("0x" + body.slice(64, 128)));
      const results: Array<{ success: boolean; data: Hex }> = [];
      for (let i = 0; i < n; i += 1) {
        const rel = Number(BigInt("0x" + body.slice(128 + i * 64, 192 + i * 64))) * 2;
        const elem = 128 + rel;
        const target = "0x" + body.slice(elem + 24, elem + 64);
        const bytesRel = Number(BigInt("0x" + body.slice(elem + 128, elem + 192))) * 2;
        const lenPos = elem + bytesRel;
        const len = Number(BigInt("0x" + body.slice(lenPos, lenPos + 64)));
        const call = ("0x" + body.slice(lenPos + 64, lenPos + 64 + len * 2)) as Hex;
        try {
          results.push({ success: true, data: (await base.ethCall(target as Address, call)) as Hex });
        } catch {
          results.push({ success: false, data: "0x" });
        }
      }
      return encAggResult(results);
    },
  };
  return t as unknown as Transport & { calls: string[]; netCalls: string[] };
}

test("marketSnapshots: 4 markets × 4 views cost exactly 1 RPC", async () => {
  const state = baseState();
  const t = withMulticall(state);
  const sdk = new CentralPredictionSDK(t, { engine: ENGINE, chainId: 8453, account: ACCOUNT });
  const ids = [1, 2, 3, 4].map((i) => ("0x" + String(i).repeat(64).slice(0, 64)) as Hex);
  const snaps = await sdk.marketSnapshots(ids);
  eq(snaps.length, 4, "market count");
  eq(t.netCalls.length, 1, `expected exactly 1 network call, got ${t.netCalls.join(",")}`);
  eq(t.netCalls[0], SEL_AGGREGATE3, "and it must be aggregate3");
  for (const [i, s] of snaps.entries()) {
    eq(s.marketId, ids[i], "marketId alignment");
    eq(s.exists, true, "exists");
    eq(s.priceYes, 500_000_000_000_000_000n, "price 50%");
    eq(s.priceNo, 500_000_000_000_000_000n, "complementary price");
    eq(s.depth, 20_000_000_000n, "depth 20,000 USDC");
    eq(s.tradingOpen, true, "tradeable");
    eq(s.disputing, false, "not in a dispute window");
  }
});

test("marketSnapshots withMeta: question/category ride the same RPC (still 1 network call)", async () => {
  const t = withMulticall(baseState());
  const sdk = new CentralPredictionSDK(t, { engine: ENGINE, chainId: 8453, account: ACCOUNT });
  const ids = [MARKET, ("0x" + "22".repeat(32)) as Hex];
  const snaps = await sdk.marketSnapshots(ids, { withMeta: true });
  eq(t.netCalls.length, 1, "still exactly 1 network call");
  eq(snaps.length, 2, "market count");
  eq(snaps[0].question, "Will BTC break 82,000 within 24 hours?", "non-ASCII question");
  eq(snaps[0].category, "crypto", "category");
  eq(snaps[1].marketId, ids[1], "order preserved");
});

test("marketSnapshots: reflects dispute and resolution state", async () => {
  const state = baseState();
  state.resolved = true;
  state.disputing = true;
  state.outcome = 1;
  state.owed = 123n;
  const sdk = new CentralPredictionSDK(withMulticall(state), { engine: ENGINE, chainId: 8453, account: ACCOUNT });
  const [snap] = await sdk.marketSnapshots([MARKET]);
  eq(snap.resolved, true, "resolved");
  eq(snap.disputing, true, "disputing");
  eq(snap.finalized, false, "not finalized");
  eq(snap.outcome, 1, "outcome");
  eq(snap.owed, 123n, "owed");
  eq(snap.tradingOpen, false, "resolved, so not tradeable");
});

test("marketSnapshots: multicall=false reads market by market (N markets × 4 RPCs)", async () => {
  const state = baseState();
  const t = makeTransport(state);
  const sdk = new CentralPredictionSDK(t, { engine: ENGINE, chainId: 8453, account: ACCOUNT });
  const snaps = await sdk.marketSnapshots([MARKET, MARKET], { multicall: false });
  eq(snaps.length, 2, "market count");
  eq(t.calls.filter((c) => c === SEL_AGGREGATE3).length, 0, "no aggregate3");
  assert.ok(t.calls.length >= 8, `expected per-market reads (≥8), got ${t.calls.length}`);
});

test("marketSnapshots: a total Multicall failure degrades to per-market reads without throwing", async () => {
  const state = baseState();
  const base = makeTransport(state);
  const t: Transport = {
    now: base.now,
    ethCall: async (to: Address, data: Hex) => {
      if (to.toLowerCase() === MULTICALL3.toLowerCase()) throw new Error("multicall not deployed");
      return base.ethCall(to, data);
    },
  };
  const sdk = new CentralPredictionSDK(t, { engine: ENGINE, chainId: 8453, account: ACCOUNT });
  const [snap] = await sdk.marketSnapshots([MARKET]);
  eq(snap.exists, true, "data still arrives after degradation");
  eq(snap.depth, 20_000_000_000n, "depth");
});

test("marketSnapshots: an empty array returns empty without any RPC", async () => {
  const t = makeTransport(baseState());
  const sdk = new CentralPredictionSDK(t, { engine: ENGINE, chainId: 8453, account: ACCOUNT });
  eq((await sdk.marketSnapshots([])).length, 0, "empty");
  eq(t.calls.length, 0, "zero RPC");
});

/* ------------------------------- Execution ------------------------------- */

(async () => {
  let pass = 0;
  const failures: string[] = [];
  for (const [name, fn] of cases) {
    try {
      await fn();
      pass += 1;
      console.log(`✅ PASS  ${name}`);
    } catch (err) {
      failures.push(name);
      console.error(`❌ FAIL  ${name}\n         ${(err as Error).message}`);
    }
  }
  console.log(`\n${pass}/${cases.length} passed, ${failures.length} failed`);
  if (failures.length) {
    console.error(`Failed cases:\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
})();
