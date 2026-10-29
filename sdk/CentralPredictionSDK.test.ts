/**
 * CentralPredictionSDK 单元测试
 *
 * 运行：cd sdk && npm test        （或 npx tsc -p tsconfig.json && node dist/CentralPredictionSDK.test.js）
 *
 * 两层验证：
 *   1) **calldata 逐字节对齐**：SDK 手工编码的结果，直接跟 `cast calldata`（Solidity 自己的编码器）比对，
 *      任何一个字节不同就算失败。选择器表也逐条跟 `cast sig` 比对 —— 不信任手抄的常量。
 *   2) **预检与错误映射**：用 MockTransport 造出各种链上状态（未到时间、争议期、暂停、越权…），
 *      断言 SDK 在本地就拦下来，以及链上 revert data → 中文文案的映射。
 *
 * 离线定价用的是**真链数据**生成的夹具（anvil 上部署真合约、seed 10,000 USDC 后实测），
 * 生成命令见文件末尾注释。
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

/* ------------------------------- 测试运行器 ------------------------------- */

const cases: Array<[string, () => void | Promise<void>]> = [];
function test(name: string, fn: () => void | Promise<void>): void {
  cases.push([name, fn]);
}

function eq(actual: unknown, expected: unknown, what: string): void {
  assert.deepEqual(actual, expected, `${what}: 期望 ${String(expected)}，实际 ${String(actual)}`);
}

async function expectThrow(fn: () => Promise<unknown>, code: string, contains?: string): Promise<SdkError> {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof SdkError, `期望 SdkError，实际 ${String(err)}`);
    const e = err as SdkError;
    eq(e.code, code, "错误码");
    if (contains) assert.ok(e.message.includes(contains), `文案应包含「${contains}」，实际「${e.message}」`);
    return e;
  }
  throw new Error(`期望抛出 ${code}，但调用成功了`);
}

/* ------------------------------- cast 作为基准 ------------------------------- */

const CAST_ENV = { ...process.env, PATH: `/opt/foundry:${process.env.PATH ?? ""}` };

function cast(args: string[]): string {
  const r = spawnSync("cast", args, { encoding: "utf8", env: CAST_ENV });
  if (r.status !== 0) throw new Error(`cast ${args.join(" ")} 失败：${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

const castCalldata = (sig: string, args: string[]): Hex => cast(["calldata", sig, ...args]) as Hex;
const castSig = (sig: string): Hex => cast(["sig", sig]) as Hex;

/* ------------------------------- Mock 链 ------------------------------- */

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
  quoteSkew: bigint; // 故意让链上报价与本地算的不一致（测试模型漂移拦截）
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

/** ABI 编码一个 string 返回值（offset=32 / len / UTF-8 bytes） */
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
          return stringWord("BTC 能否在 24 小时内突破 82,000？");
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
          throw new Error(`MockTransport 未实现的选择器 ${sel}`);
      }
    },
  };
  return t as Transport & { calls: string[] };
}

function sdkFor(state: MockState, account: Address | undefined = ACCOUNT): CentralPredictionSDK {
  return new CentralPredictionSDK(makeTransport(state), { engine: ENGINE, chainId: 8453, account });
}

/* ============================ A. 选择器与 ABI 对齐 ============================ */

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

test("选择器表 28 条全部与 cast sig 一致（编译器 ABI）", () => {
  for (const [key, sig] of Object.entries(SIG_MAP)) {
    eq(SEL[key as keyof typeof SEL], castSig(sig), `${key} ${sig}`);
  }
});

test("错误选择器表与 cast sig 一致（36 个自定义错误全量比对）", () => {
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
    assert.ok(ERROR_SELECTORS[sel], `${sig} 未收录进 ERROR_SELECTORS`);
  }
  // 用户给的三条必须逐字命中
  eq(ERROR_SELECTORS["0x5688ffb3"]?.code, "chain/BELOW_MIN_BET", "BelowMinBet 映射");
  eq(ERROR_SELECTORS["0xb8ab88d4"]?.code, "chain/ABOVE_MAX_BET", "AboveMaxBet 映射");
  eq(ERROR_SELECTORS["0x22410594"]?.code, "chain/IMPACT_TOO_HIGH", "ImpactTooHigh 映射");
});

/* ============================ B. calldata 逐字节对齐 ============================ */

const Q = "BTC 能否在 24 小时内突破 82,000？"; // 含中文，验证 UTF-8 编码
/** 建盘用的结算时间：夹具里 nowTs = 1_800_000_000，取「+24 小时」落在合法区间内 */
const RT = 1_800_000_000n + 86_400n;

test("buildCreateMarket(3 参) → createMarket(bytes32,string,uint256) calldata 与 cast 完全一致", async () => {
  const state = baseState();
  state.exists = false; // 建盘前盘口必然还不存在
  const sdk = sdkFor(state);
  const plan = await sdk.buildCreateMarket({ marketId: MARKET, question: Q, resolutionTime: RT });
  eq(plan.method, "createMarket", "method");
  eq(plan.data, castCalldata("createMarket(bytes32,string,uint256)", [MARKET, Q, String(RT)]), "calldata");
  eq(plan.to, ENGINE, "to");
  eq(plan.value, "0x0", "value");
});

test("buildCreateMarket(带 meta.category) → createMarketWithMeta calldata 与 cast 完全一致", async () => {
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

test("buildBuyShares → buyShares calldata 与 cast 完全一致", async () => {
  const sdk = sdkFor(baseState());
  const plan = await sdk.buildBuyShares({ marketId: MARKET, outcome: OUTCOME_YES, amountIn: 100_000_000n, slippageBps: 100 });
  const minSharesOut = String(plan.meta.minSharesOut);
  eq(plan.data, castCalldata("buyShares(bytes32,uint8,uint256,uint256)", [MARKET, "1", "100000000", minSharesOut]), "calldata");
  // 100 bps = 1%，报价 196,039,238 → 保护价 194,078,845
  eq(minSharesOut, "194078845", "minSharesOut");
});

test("buildSellShares → sellShares calldata 与 cast 完全一致", async () => {
  const state = baseState();
  state.yesOf = 1_000_000_000n;
  const sdk = sdkFor(state);
  const plan = await sdk.buildSellShares({ marketId: MARKET, outcome: OUTCOME_YES, sharesIn: 1_000_000_000n, slippageBps: 50 });
  eq(plan.data, castCalldata("sellShares(bytes32,uint8,uint256,uint256)", [MARKET, "1", "1000000000", String(plan.meta.minAmountOut)]), "calldata");
});

test("buildRedeem → redeem calldata 与 cast 完全一致", async () => {
  const state = baseState();
  state.resolved = true;
  state.finalized = true;
  state.outcome = 1;
  state.yesOf = 500n;
  const sdk = sdkFor(state);
  const plan = await sdk.buildRedeem({ marketId: MARKET });
  eq(plan.data, castCalldata("redeem(bytes32)", [MARKET]), "calldata");
});

test("buildResolveMarket → resolveMarket calldata 与 cast 完全一致", async () => {
  const state = baseState();
  state.nowTs = 2_000_000_001n;
  const sdk = sdkFor(state);
  const plan = await sdk.buildResolveMarket({ marketId: MARKET, outcome: OUTCOME_NO });
  eq(plan.data, castCalldata("resolveMarket(bytes32,uint8)", [MARKET, "0"]), "calldata");
});

test("buildOverrideResolution → overrideResolution calldata 与 cast 完全一致", async () => {
  const state = baseState();
  state.resolved = true;
  state.disputing = true;
  state.outcome = 1;
  const sdk = sdkFor(state, ADMIN);
  const plan = await sdk.buildOverrideResolution({ marketId: MARKET, newOutcome: OUTCOME_INVALID });
  eq(plan.data, castCalldata("overrideResolution(bytes32,uint8)", [MARKET, "2"]), "calldata");
});

/* ============================ C. 防夹与保护价强校验 ============================ */

test("minSharesOut=0 直接拒（禁止裸奔）", async () => {
  const sdk = sdkFor(baseState());
  await expectThrow(
    () => sdk.buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n, minSharesOut: 0n }),
    "local/MIN_OUT_REQUIRED",
    "minSharesOut",
  );
});

test("既不传 minSharesOut 也不传 slippageBps 直接拒", async () => {
  const sdk = sdkFor(baseState());
  await expectThrow(
    () => sdk.buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n }),
    "local/MIN_OUT_REQUIRED",
  );
});

test("minSharesOut 高于报价直接拒（这笔必然失败）", async () => {
  const sdk = sdkFor(baseState());
  await expectThrow(
    () => sdk.buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n, minSharesOut: 999_999_999n }),
    "local/MIN_OUT_ABOVE_QUOTE",
  );
});

test("minSharesOut 低于报价 95% 直接拒（容差过松=没保护）", async () => {
  const sdk = sdkFor(baseState());
  await expectThrow(
    () => sdk.buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n, minSharesOut: 1n }),
    "local/SLIPPAGE_TOO_LOOSE",
  );
});

test("滑点容差超范围（0 / 501 bps）拒", async () => {
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

test("同时给 minSharesOut 与 slippageBps 时取更严格的那个", async () => {
  const sdk = sdkFor(baseState());
  const plan = await sdk.buildBuyShares({
    marketId: MARKET,
    outcome: 1,
    amountIn: 100_000_000n,
    slippageBps: 500, // 保护价 = 报价 × 95% = 186,237,276
    minSharesOut: 190_000_000n, // 更严格
  });
  eq(plan.meta.minSharesOut, "190000000", "取更严格值");
});

test("confirmQuoteStillValid：报价没变 → 通过", async () => {
  const sdk = sdkFor(baseState());
  const plan = await sdk.buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n, slippageBps: 100 });
  await sdk.confirmQuoteStillValid(plan, 60_000);
});

test("confirmQuoteStillValid：池子被砸、报价跌穿保护价 → 中止", async () => {
  const state = baseState();
  const sdk = sdkFor(state);
  const plan = await sdk.buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n, slippageBps: 100 });
  // 攻击者把小池子砸歪：yesReserve 大幅下降
  state.yesReserve = 1_000_000_000n;
  state.noReserve = 19_000_000_000n;
  await expectThrow(() => sdk.confirmQuoteStillValid(plan, 60_000), "chain/SLIPPAGE_EXCEEDED", "价格已变动");
});

test("confirmQuoteStillValid：报价太旧 → 中止", async () => {
  const sdk = sdkFor(baseState());
  const plan = await sdk.buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n, slippageBps: 100 });
  await new Promise((r) => setTimeout(r, 5));
  await expectThrow(() => sdk.confirmQuoteStillValid(plan, 1), "local/SLIPPAGE_TOO_LOOSE", "报价已过期");
});

/* ============================ D. preflight 各种链上状态 ============================ */

test("盘口不存在", async () => {
  const state = baseState();
  state.exists = false;
  await expectThrow(
    () => sdkFor(state).buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n, slippageBps: 100 }),
    "local/MARKET_NOT_FOUND",
  );
});

test("低于最低下注（5 USDC）", async () => {
  await expectThrow(
    () => sdkFor(baseState()).buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 4_999_999n, slippageBps: 100 }),
    "chain/BELOW_MIN_BET",
  );
});

test("高于单笔上限（10,000 USDC）", async () => {
  const state = baseState();
  state.yesReserve = 10_000_000_000_000n;
  state.noReserve = 10_000_000_000_000n;
  await expectThrow(
    () => sdkFor(state).buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 10_000_000_001n, slippageBps: 100 }),
    "chain/ABOVE_MAX_BET",
  );
});

test("价格冲击超过池子 5%", async () => {
  // 池深 20,000 USDC → 上限 1,000 USDC，下 1,001 USDC 应被拦
  await expectThrow(
    () => sdkFor(baseState()).buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 1_001_000_000n, slippageBps: 100 }),
    "chain/IMPACT_TOO_HIGH",
  );
});

test("已过结算时间 → 交易关闭", async () => {
  const state = baseState();
  state.resolutionTime = state.nowTs - 1n;
  await expectThrow(
    () => sdkFor(state).buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n, slippageBps: 100 }),
    "local/TRADING_CLOSED",
  );
});

test("已结算 / 暂停 都被拦", async () => {
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

test("本地报价与链上不一致 → 拦（ABI/模型漂移）", async () => {
  const state = baseState();
  state.quoteSkew = 1n;
  await expectThrow(
    () => sdkFor(state).buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n, slippageBps: 100 }),
    "local/QUOTE_MISMATCH",
  );
});

test("卖出超过持仓", async () => {
  const state = baseState();
  state.yesOf = 100n;
  await expectThrow(
    () => sdkFor(state).buildSellShares({ marketId: MARKET, outcome: 1, sharesIn: 101n, slippageBps: 100 }),
    "local/INSUFFICIENT_SHARES",
  );
});

test("建盘：题目太短 / 分类太长 / 结算时间越界", async () => {
  const fresh = baseState();
  fresh.exists = false;
  const sdk = sdkFor(fresh);
  await expectThrow(
    () => sdk.buildCreateMarket({ marketId: MARKET, question: "短", resolutionTime: RT }),
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

test("建盘：盘口已存在 / 无建盘权限", async () => {
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

test("裁决：未到时间 / 无权限 / 已结算", async () => {
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

test("提现：争议期内被拦（并给出窗口截止时间）", async () => {
  const state = baseState();
  state.resolved = true;
  state.disputing = true;
  state.outcome = 1;
  state.yesOf = 1_000n;
  const err = await expectThrow(() => sdkFor(state).buildRedeem({ marketId: MARKET }), "chain/DISPUTE_WINDOW_OPEN", "争议期");
  assert.ok(err.message.includes("T"), "文案里应带争议期截止时间");
});

test("提现：未结算 / 无持仓 / 暂停（未过 7 天）都被拦", async () => {
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
  paused.resolutionTime = paused.nowTs - 3600n; // 还没到「结算+7天」，暂停有效
  await expectThrow(() => sdkFor(paused).buildRedeem({ marketId: MARKET }), "local/MARKET_PAUSED");
});

test("提现：暂停但已过「结算 + 7 天」→ 与合约一致，放行", async () => {
  const state = baseState();
  state.resolved = true;
  state.finalized = true;
  state.paused = true;
  state.yesOf = 1n;
  state.resolutionTime = state.nowTs - 604_801n;
  const plan = await sdkFor(state).buildRedeem({ marketId: MARKET });
  eq(plan.method, "redeem", "method");
});

test("改判：非 admin / 已终结 / 非争议期 / 同结果 都被拦", async () => {
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

/* ============================ E. 错误解码 ============================ */

test("decodeRevert：你给的三条 selector 映射成中文", () => {
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

test("decodeRevert：DisputeWindowOpen / 权限类 都映射成中文", () => {
  eq(decodeRevert({ data: "0x87920b43" }).code, "chain/DISPUTE_WINDOW_OPEN", "DisputeWindowOpen");
  for (const sel of ["0x47bc7cc8", "0x80fee105", "0x47556579"]) {
    const e = decodeRevert({ data: sel });
    eq(e.code, "chain/NOT_AUTHORIZED_ROLE", `权限错误 ${sel}`);
    assert.ok(e.message.includes("权限"));
  }
});

test("decodeRevert：Error(string) 原样透出 / Panic 带 code / 未知 selector 兜底", () => {
  const reason = "insufficient allowance";
  const hex = Buffer.from(reason, "utf8").toString("hex").padEnd(64, "0");
  const data = "0x08c379a0" + uintWord(32n) + uintWord(BigInt(reason.length)) + hex;
  const e = decodeRevert({ data });
  eq(e.code, "chain/REVERT_STRING", "Error(string)");
  eq(e.message, reason, "透出原始 reason");

  const p = decodeRevert({ data: "0x4e487b71" + uintWord(0x11n) });
  eq(p.code, "chain/PANIC", "panic");
  assert.ok(p.message.includes("0x11"));

  const u = decodeRevert({ data: "0xdeadbeef" });
  eq(u.code, "chain/UNKNOWN", "unknown");
  assert.ok(u.message.includes("0xdeadbeef"));

  const bare = decodeRevert(new Error("execution reverted"));
  eq(bare.code, "chain/UNKNOWN", "无 data");
});

test("decodeRevert：嵌套的 provider 错误也能扒出 revert data", () => {
  const nested = { error: { data: { data: "0x87920b43" } } };
  eq(decodeRevert(nested).code, "chain/DISPUTE_WINDOW_OPEN", "嵌套 error.data.data");
});

/* ============================ F. 离线定价（真链夹具） ============================ */

/**
 * 夹具来源：anvil 上部署真合约、createMarket + seedLiquidity(10,000 USDC) 后实测：
 *   previewBuy(YES, 100e6)  = 196039238
 *   previewBuy(NO,  100e6)  = 196039238
 *   previewSell(YES, 1000e6)= 479539473
 * 再 buy YES 100e6 之后（yesReserve=9902460762, noReserve=10098500000）：
 *   previewBuy(YES, 50e6)   = 97309539
 *   previewSell(YES, 50e6)  = 24835806
 */
test("previewBuyOffline 与真链 previewBuy 完全一致", () => {
  const pool = { yesReserve: 10_000_000_000n, noReserve: 10_000_000_000n };
  eq(previewBuyOffline(pool, OUTCOME_YES, 100_000_000n), 196_039_238n, "previewBuy(YES,100)");
  eq(previewBuyOffline(pool, OUTCOME_NO, 100_000_000n), 196_039_238n, "previewBuy(NO,100)");

  const after = { yesReserve: 9_902_460_762n, noReserve: 10_098_500_000n };
  eq(previewBuyOffline(after, OUTCOME_YES, 50_000_000n), 97_309_539n, "previewBuy(YES,50) after");
});

test("previewSellOffline 与真链 previewSell 完全一致", () => {
  const pool = { yesReserve: 10_000_000_000n, noReserve: 10_000_000_000n };
  eq(previewSellOffline(pool, OUTCOME_YES, 1_000_000_000n), 479_539_473n, "previewSell(YES,1000)");

  const after = { yesReserve: 9_902_460_762n, noReserve: 10_098_500_000n };
  eq(previewSellOffline(after, OUTCOME_YES, 50_000_000n), 24_835_806n, "previewSell(YES,50) after");
});

test("买一卖一必亏（手续费 + 冲击），不存在白套利", () => {
  const pool = { yesReserve: 10_000_000_000n, noReserve: 10_000_000_000n };
  const amountIn = 100_000_000n;
  const shares = previewBuyOffline(pool, OUTCOME_YES, amountIn);
  // 买入后的池子
  const net = amountIn - (amountIn * 150n + 9999n) / 10_000n;
  const newYes = 10_000_000_000n - (shares - net);
  const after = { yesReserve: newYes, noReserve: 10_000_000_000n + net };
  const back = previewSellOffline(after, OUTCOME_YES, shares);
  assert.ok(back < amountIn, `卖出应少于本金：${back} < ${amountIn}`);
});

test("priceYes 初始 50%，买 YES 后上升（价格=概率）", () => {
  const pool = { yesReserve: 10_000_000_000n, noReserve: 10_000_000_000n };
  eq(priceYesOffline(pool), 500_000_000_000_000_000n, "初始 0.5");
  const after = { yesReserve: 9_902_460_762n, noReserve: 10_098_500_000n };
  assert.ok(priceYesOffline(after) > 500_000_000_000_000_000n, "买 YES 后价格上升");
});

/* ============================ G. 小工具 ============================ */

test("formatUsdc / parseUsdc 往返", () => {
  eq(formatUsdc(196_039_238n), "196.039238", "format");
  eq(formatUsdc(5_000_000n), "5", "整数");
  eq(formatUsdc(1n), "0.000001", "最小单位");
  eq(parseUsdc("5"), 5_000_000n, "parse 5");
  eq(parseUsdc("10,000".replace(",", "")), 10_000_000_000n, "parse 10000");
  assert.throws(() => parseUsdc("1.1234567"), SdkError, "超过 6 位小数应报错");
});

test("构造 SDK：非法 engine 地址直接报错", () => {
  assert.throws(
    () => new CentralPredictionSDK(makeTransport(baseState()), { engine: "0x1234" }),
    (err: unknown) => err instanceof SdkError && (err as SdkError).code === "local/NOT_CONNECTED",
  );
});

test("需要账户的操作在未配置 account 时报错", async () => {
  const sdk = new CentralPredictionSDK(makeTransport(baseState()), { engine: ENGINE });
  await expectThrow(
    () => sdk.buildBuyShares({ marketId: MARKET, outcome: 1, amountIn: 100_000_000n, slippageBps: 100 }),
    "local/ACCOUNT_REQUIRED",
  );
});


test("列表页读取：marketCount / marketIds / 题目 / 分类（中文 UTF-8）", async () => {
  const sdk = sdkFor(baseState());
  eq(await sdk.marketCount(), 1, "marketCount");
  eq(await sdk.marketId(0), ("0x" + "11".repeat(32)) as Hex, "marketIds(0)");
  eq(await sdk.marketQuestion(MARKET), "BTC 能否在 24 小时内突破 82,000？", "中文题目");
  eq(await sdk.marketCategory(MARKET), "crypto", "分类");
});

test("列表页读取：priceYes / depthOf / isFinal / tradingOpen", async () => {
  const state = baseState();
  state.resolved = true;
  state.finalized = true;
  const sdk = sdkFor(state);
  eq(await sdk.priceYes(MARKET), 500_000_000_000_000_000n, "价格 50%");
  eq(await sdk.depthOf(MARKET), 20_000_000_000n, "池深");
  eq(await sdk.isFinal(MARKET), true, "已终结");
  eq(await sdk.tradingOpen(MARKET), false, "已结算 → 不可交易（与合约 tradingOpen 一致）");
});

test("decodeString 处理空串与超长中文", () => {
  eq(decodeString(stringWord("")), "", "空串");
  const long = "预".repeat(50);
  eq(decodeString(stringWord(long)), long, "150 字节中文");
  eq(decodeString("0x"), "", "无数据");
});

/* ============================ H. 滑点档位与冲击预警 ============================ */

test("滑点档位预设：0.5% / 1% / 3%，都在硬边界内", () => {
  eq(SLIPPAGE_CONSERVATIVE, 50n, "CONSERVATIVE");
  eq(SLIPPAGE_NORMAL, 100n, "NORMAL");
  eq(SLIPPAGE_DEGEN, 300n, "DEGEN");
  eq(IMPACT_WARN_BPS, 400n, "预警线 = 上限 80%");
  for (const p of [SLIPPAGE_CONSERVATIVE, SLIPPAGE_NORMAL, SLIPPAGE_DEGEN]) {
    assert.ok(p >= 1n && p <= 500n, `档位 ${p} 必须在 1~500 bps`);
  }
});

test("用 SLIPPAGE_NORMAL 下单：保护价 = 报价 × 99%", async () => {
  const sdk = sdkFor(baseState());
  const plan = await sdk.buildBuyShares({ marketId: MARKET, outcome: OUTCOME_YES, amountIn: 100_000_000n, slippageBps: SLIPPAGE_NORMAL });
  const quote = BigInt(String(plan.meta.quote));
  eq(BigInt(String(plan.meta.minSharesOut)), (quote * 99n) / 100n, "minSharesOut");
  eq(plan.warning, undefined, "100 USDC / 20,000 池 = 0.5% 冲击，不该预警");
});

test("冲击接近 5% 上限（≥4%）→ 返回 warning='impact_near_limit'", async () => {
  const sdk = sdkFor(baseState()); // 池深 20,000 USDC → 5% 上限 = 1,000 USDC
  const plan = await sdk.buildBuyShares({ marketId: MARKET, outcome: OUTCOME_YES, amountIn: 900_000_000n, slippageBps: SLIPPAGE_CONSERVATIVE });
  eq(plan.meta.impactBps, "450", "900/20000 = 450 bps");
  eq(plan.warning, "impact_near_limit", "应预警");
});

test("冲击低于 4% 不预警；超过 5% 直接拒（预警不是豁免）", async () => {
  const sdk = sdkFor(baseState());
  const ok = await sdk.buildBuyShares({ marketId: MARKET, outcome: OUTCOME_YES, amountIn: 790_000_000n, slippageBps: SLIPPAGE_DEGEN });
  eq(ok.meta.impactBps, "395", "395 bps < 400 不预警");
  eq(ok.warning, undefined, "无预警");

  await expectThrow(
    () => sdk.buildBuyShares({ marketId: MARKET, outcome: OUTCOME_YES, amountIn: 1_001_000_000n, slippageBps: SLIPPAGE_DEGEN }),
    "chain/IMPACT_TOO_HIGH",
  );
});

test("卖出同样带冲击预警", async () => {
  const state = baseState();
  state.yesOf = 900_000_000n;
  const plan = await sdkFor(state).buildSellShares({ marketId: MARKET, outcome: OUTCOME_YES, sharesIn: 900_000_000n, slippageBps: SLIPPAGE_CONSERVATIVE });
  eq(plan.meta.impactBps, "450", "卖出冲击 bps");
  eq(plan.warning, "impact_near_limit", "卖出也预警");
});

/* ============================ I. 事件解码 ============================ */

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

test("19 个事件 topic0 全部与 cast keccak 一致", () => {
  eq(Object.keys(EVENT_TOPICS).length, 19, "事件数量");
  for (const [name, sig] of CORE_EVENTS) {
    eq(EVENT_TOPICS[name as keyof typeof EVENT_TOPICS], cast(["keccak", sig]), `${name} topic0`);
  }
});

test("eventNameOf / eventTopic 双向反查", () => {
  eq(eventNameOf(EVENT_TOPICS.SharesBought), "SharesBought", "按 topic 查名");
  eq(eventNameOf(EVENT_TOPICS.SharesBought.toUpperCase().replace("0X", "0x")), "SharesBought", "大小写不敏感");
  eq(eventNameOf("0xdeadbeef"), null, "未知 topic 返回 null");
  eq(eventTopic("DisputeWindowOpened"), EVENT_TOPICS.DisputeWindowOpened, "按名查 topic");
});

/** 独立写一个「ABI 日志编码器」，跟 SDK 的解码器互为验证（不是同一份代码） */
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
    // 长度字要拼在数据前
    tails[tails.length - 1] = BigInt(hex.length / 2).toString(16).padStart(64, "0") + hex.padEnd(body, "0");
    tailCursor += 32 + body / 2;
  }
  for (const v of stat) head.push(v.toString(16).padStart(64, "0"));
  return { topics: [topic, ...indexed], data: "0x" + head.join("") + tails.join("") };
}

test("MarketCreated：两个 indexed（marketId/creator）+ 两个动态字符串 + 一个时间戳", () => {
  const log = encLog(EVENT_TOPICS.MarketCreated, ["0x" + "11".repeat(32), "0".repeat(24) + ACCOUNT.slice(2).toLowerCase()], ["BTC 能否 24h 破 90k？", "crypto"], [1_800_086_400n]);
  const ev = decodeLog(log);
  assert.ok(ev, "应当解出来");
  eq(ev!.name, "MarketCreated", "事件名");
  eq(ev!.args.marketId, "0x" + "11".repeat(32), "marketId");
  eq((ev!.args.creator as string).toLowerCase(), ACCOUNT.toLowerCase(), "creator");
  eq(ev!.args.question, "BTC 能否 24h 破 90k？", "中文题目（UTF-8 往返）");
  eq(ev!.args.category, "crypto", "category");
  eq(ev!.args.resolutionTime, 1_800_086_400n, "resolutionTime");
});

test("SharesBought：2 indexed + 5 个静态字段，顺序不能错", () => {
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

test("DisputeWindowOpened：争议期截止时间能直接喂给前端倒计时", () => {
  const log = encLog(EVENT_TOPICS.DisputeWindowOpened, ["0x" + "33".repeat(32)], [], [0n, 1_800_003_600n, 12_345_678n]);
  const ev = decodeLog(log)!;
  eq(ev.args.outcome, 0, "NO");
  eq(ev.args.disputeEndsAt, 1_800_003_600n, "disputeEndsAt");
  eq(ev.args.owed, 12_345_678n, "owed");
});

test("ResolutionOverridden：old → new 与改判次数", () => {
  const log = encLog(EVENT_TOPICS.ResolutionOverridden, ["0x" + "44".repeat(32)], [], [0n, 1n, 12_345_678n, 1n]);
  const ev = decodeLog(log)!;
  eq(ev.args.oldOutcome, 0, "oldOutcome");
  eq(ev.args.newOutcome, 1, "newOutcome");
  eq(ev.args.newOwed, 12_345_678n, "newOwed");
  eq(ev.args.disputes, 1, "disputes");
});

test("MarketResolved 的 bool 字段（紧急退款）解成 boolean", () => {
  const log = encLog(EVENT_TOPICS.MarketResolved, ["0x" + "55".repeat(32)], [], [2n, 1_800_003_600n, 1n, 0n]);
  const ev = decodeLog(log)!;
  eq(ev.args.outcome, 2, "INVALID");
  eq(ev.args.emergency, true, "emergency=true");
  eq(typeof ev.args.emergency, "boolean", "类型应为 boolean");
});

test("decodeLogs：混进 USDC Transfer 之类未知日志会被跳过，不抛错", () => {
  const known = encLog(EVENT_TOPICS.LiquiditySeeded, ["0x" + "66".repeat(32), "0".repeat(24) + ACCOUNT.slice(2).toLowerCase()], [], [10_000_000_000n]);
  const unknown = { topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"], data: "0x" };
  const evs = decodeLogs([unknown, known, unknown]);
  eq(evs.length, 1, "只留认识的");
  eq(evs[0].name, "LiquiditySeeded", "事件名");
  eq(evs[0].args.amount, 10_000_000_000n, "amount");
});

test("decodeReceiptLogs：只解本引擎发出的日志（按 address 过滤）", () => {
  const log = encLog(EVENT_TOPICS.Redeemed, ["0x" + "77".repeat(32), "0".repeat(24) + ACCOUNT.slice(2).toLowerCase()], [], [100n, 0n, 95_000_000n, 500_000n]);
  const sdk = sdkFor(baseState());
  const evs = sdk.decodeReceiptLogs([
    { address: ENGINE, ...log },
    { address: "0x00000000000000000000000000000000000000ff", ...log },
  ]);
  eq(evs.length, 1, "只留本引擎");
  eq(evs[0].args.payout, 95_000_000n, "payout");
  eq(evs[0].args.fee, 500_000n, "fee");
});

/* ============================ J. Multicall3 批量查询 ============================ */

/** 独立实现 aggregate3 的返回值编码，用来验证 SDK 的解码器 */
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

test("MULTICALL3 地址与 aggregate3 selector 正确", () => {
  eq(MULTICALL3, "0xcA11bde05977b3631167028862bE2a173976CA11", "Base Multicall3 地址");
  eq(SEL_AGGREGATE3, cast(["sig", "aggregate3((address,bool,bytes)[])"]) as Hex, "aggregate3 selector");
});

test("encodeAggregate3 与 cast calldata 逐字节一致（1 条 / 2 条）", () => {
  const one = encodeAggregate3([{ target: ENGINE, allowFailure: true, data: "0x313ce567" }]);
  eq(one, castCalldata("aggregate3((address,bool,bytes)[])", [`[(${ENGINE},true,0x313ce567)]`]), "1 条");
  const two = encodeAggregate3([
    { target: ENGINE, allowFailure: true, data: "0x313ce567" },
    { target: ACCOUNT, allowFailure: false, data: "0x70a08231" },
  ]);
  eq(
    two,
    castCalldata("aggregate3((address,bool,bytes)[])", [`[(${ENGINE},true,0x313ce567),(${ACCOUNT},false,0x70a08231)]`]),
    "2 条",
  );
});

test("decodeAggregate3Result 解出 (success, data) 列表", () => {
  const items = [
    { success: true, data: words(7n) as Hex },
    { success: false, data: "0x" as Hex },
    { success: true, data: words(42n) as Hex },
  ];
  const dec = decodeAggregate3Result(encAggResult(items));
  eq(dec.length, 3, "条数");
  eq(dec[0].success, true, "第 1 条 success");
  eq(BigInt(dec[0].data), 7n, "第 1 条值");
  eq(dec[1].success, false, "第 2 条 success");
  eq(dec[2].success, true, "第 3 条 success");
  eq(BigInt(dec[2].data), 42n, "第 3 条值");
});

/** 让 MockTransport 会答 aggregate3：按 SDK 编码的调用逐条转发给自身 */
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
      // 解析 aggregate3 的入参：长度 + 元素偏移，然后逐条转发
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

test("marketSnapshots：4 个盘口 × 4 个 view 只发 1 次 RPC", async () => {
  const state = baseState();
  const t = withMulticall(state);
  const sdk = new CentralPredictionSDK(t, { engine: ENGINE, chainId: 8453, account: ACCOUNT });
  const ids = [1, 2, 3, 4].map((i) => ("0x" + String(i).repeat(64).slice(0, 64)) as Hex);
  const snaps = await sdk.marketSnapshots(ids);
  eq(snaps.length, 4, "盘口数");
  eq(t.netCalls.length, 1, `出网调用应只有 1 次，实际 ${t.netCalls.join(",")}`);
  eq(t.netCalls[0], SEL_AGGREGATE3, "且必须是 aggregate3");
  for (const [i, s] of snaps.entries()) {
    eq(s.marketId, ids[i], "marketId 对齐");
    eq(s.exists, true, "exists");
    eq(s.priceYes, 500_000_000_000_000_000n, "价格 50%");
    eq(s.priceNo, 500_000_000_000_000_000n, "互补价格");
    eq(s.depth, 20_000_000_000n, "池深 20,000 USDC");
    eq(s.tradingOpen, true, "可交易");
    eq(s.disputing, false, "不在争议期");
  }
});

test("marketSnapshots withMeta：题目/分类也进同一次 RPC（仍只 1 次出网）", async () => {
  const t = withMulticall(baseState());
  const sdk = new CentralPredictionSDK(t, { engine: ENGINE, chainId: 8453, account: ACCOUNT });
  const ids = [MARKET, ("0x" + "22".repeat(32)) as Hex];
  const snaps = await sdk.marketSnapshots(ids, { withMeta: true });
  eq(t.netCalls.length, 1, "仍然只有 1 次出网调用");
  eq(snaps.length, 2, "盘口数");
  eq(snaps[0].question, "BTC 能否在 24 小时内突破 82,000？", "中文题目");
  eq(snaps[0].category, "crypto", "分类");
  eq(snaps[1].marketId, ids[1], "顺序对齐");
});

test("marketSnapshots：反映争议期与结算状态", async () => {
  const state = baseState();
  state.resolved = true;
  state.disputing = true;
  state.outcome = 1;
  state.owed = 123n;
  const sdk = new CentralPredictionSDK(withMulticall(state), { engine: ENGINE, chainId: 8453, account: ACCOUNT });
  const [snap] = await sdk.marketSnapshots([MARKET]);
  eq(snap.resolved, true, "resolved");
  eq(snap.disputing, true, "disputing");
  eq(snap.finalized, false, "未终结");
  eq(snap.outcome, 1, "outcome");
  eq(snap.owed, 123n, "owed");
  eq(snap.tradingOpen, false, "已结算不可交易");
});

test("marketSnapshots：multicall=false 时逐条查（N 盘口 × 4 次 RPC）", async () => {
  const state = baseState();
  const t = makeTransport(state);
  const sdk = new CentralPredictionSDK(t, { engine: ENGINE, chainId: 8453, account: ACCOUNT });
  const snaps = await sdk.marketSnapshots([MARKET, MARKET], { multicall: false });
  eq(snaps.length, 2, "盘口数");
  eq(t.calls.filter((c) => c === SEL_AGGREGATE3).length, 0, "没有 aggregate3");
  assert.ok(t.calls.length >= 8, `应逐条查（≥8 次），实际 ${t.calls.length}`);
});

test("marketSnapshots：Multicall 整体失败 → 自动降级为逐条，不报错", async () => {
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
  eq(snap.exists, true, "降级后仍然拿到数据");
  eq(snap.depth, 20_000_000_000n, "池深");
});

test("marketSnapshots：空数组直接返回空，不发 RPC", async () => {
  const t = makeTransport(baseState());
  const sdk = new CentralPredictionSDK(t, { engine: ENGINE, chainId: 8453, account: ACCOUNT });
  eq((await sdk.marketSnapshots([])).length, 0, "空");
  eq(t.calls.length, 0, "零 RPC");
});

/* ------------------------------- 执行 ------------------------------- */

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
    console.error(`失败用例：\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
})();
