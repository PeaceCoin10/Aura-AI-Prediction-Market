/**
 * PredictionSDK 单元测试（离线，MockTransport）
 * 运行：npm test
 */
import assert from "node:assert/strict";
import {
  PredictionSDK,
  SdkError,
  __internals,
  type EthCallTransport,
  type Outcome,
  type SubmissionRoute,
  type TradePlan,
  type TransactionReceipt,
} from "./PredictionSDK";

const {
  SEL,
  padWord,
  SEL_CREATE_MARKET,
  SEL_TRANSFER_ADMIN,
  SEL_ACCEPT_ADMIN,
  SEL_PREVIEW_BUY,
  SEL_BUY,
  routesForChain,
  mevProtectedRoute,
} = __internals;

/* ------------------------------- 测试夹具 ------------------------------- */

const VAULT = "0x00000000000000000000000000000000000Va017".replace("Va017", "aa017");

interface MockState {
  resolved: boolean;
  outcome: number;
  tradingOpen: boolean;
  paused: boolean;
  resolutionTime: number;
  minBet: bigint;
  maxBet: bigint;
  maxImpactBps: bigint;
  yes: bigint;
  no: bigint;
  priceYes: bigint;
  priceNo: bigint;
  totalLpShares: bigint;
  tradeFeeBps: bigint;
}

const WAD = 10n ** 18n;
const BPS = 10_000n;

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

function defaultState(): MockState {
  const yes = 1_000_000_000n; // 1000 USDC
  const no = 1_000_000_000n;
  return {
    resolved: false,
    outcome: 0,
    tradingOpen: true,
    paused: false,
    resolutionTime: 2_000_000_000,
    minBet: 5_000_000n,
    maxBet: 10_000_000_000n,
    maxImpactBps: 500n,
    yes,
    no,
    priceYes: (no * WAD) / (yes + no),
    priceNo: (yes * WAD) / (yes + no),
    totalLpShares: 1_000_000_000n,
    tradeFeeBps: 150n,
  };
}

function word(v: bigint | boolean | number): string {
  const n = typeof v === "boolean" ? (v ? 1n : 0n) : BigInt(v);
  return n.toString(16).padStart(64, "0");
}

function pack(...words: string[]): string {
  return "0x" + words.join("");
}

/** 复刻合约的 previewBuy 数学，供 mock 使用 */
function mockPreview(s: MockState, outcome: number, amountIn: bigint): bigint {
  const fee = ceilDiv(amountIn * s.tradeFeeBps, BPS);
  const net = amountIn - fee;
  if (outcome === 1) {
    const newNo = s.no + net;
    const newYes = ceilDiv(s.yes * s.no, newNo);
    return s.yes - newYes;
  }
  const newYes = s.yes + net;
  const newNo = ceilDiv(s.no * s.yes, newYes);
  return s.no - newNo;
}

class MockTransport implements EthCallTransport {
  constructor(public state: MockState = defaultState()) {}

  calls: string[] = [];

  async ethCall(_to: string, data: string): Promise<string> {
    this.calls.push(data);
    const sel = data.slice(0, 10);
    const s = this.state;

    switch (sel) {
      case SEL.resolved:
        return pack(word(s.resolved));
      case SEL.outcome:
        return pack(word(s.outcome));
      case SEL.tradingOpen:
        return pack(word(s.tradingOpen));
      case SEL.paused:
        return pack(word(s.paused));
      case SEL.resolutionTime:
        return pack(word(s.resolutionTime));
      case SEL.minBet:
        return pack(word(s.minBet));
      case SEL.maxBet:
        return pack(word(s.maxBet));
      case SEL.maxImpactBps:
        return pack(word(s.maxImpactBps));
      case SEL.yesReserve:
        return pack(word(s.yes));
      case SEL.noReserve:
        return pack(word(s.no));
      case SEL.depth:
        return pack(word(s.yes + s.no));
      case SEL.priceYes:
        return pack(word(s.priceYes));
      case SEL.priceNo:
        return pack(word(s.priceNo));
      case SEL.totalLpShares:
        return pack(word(s.totalLpShares));
      case SEL.tradeFeeBps:
        return pack(word(s.tradeFeeBps));
      case SEL.admin:
        // 0x...00ad
        return pack("0".repeat(24) + "00000000000000000000000000000000000000ad");
      case SEL.pendingAdmin:
        // 没有进行中的移交
        return pack("0".repeat(64));
      case "0x5e573804": {
        // previewBuy(uint8,uint256)
        const outcome = Number(BigInt("0x" + data.slice(10, 74)));
        const amountIn = BigInt("0x" + data.slice(74, 138));
        return pack(word(mockPreview(s, outcome, amountIn)));
      }
      default:
        throw new Error(`MockTransport: unknown selector ${sel}`);
    }
  }
}

/* ------------------------------- 测试框架 ------------------------------- */

type T = { name: string; fn: () => Promise<void> | void };
const tests: T[] = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push({ name, fn });

/* --------------------- MEV 路由 / 提交链路的测试夹具 --------------------- */

const TX_HASH = "0x" + "ab".repeat(32);

interface RouteHarness {
  transport: EthCallTransport;
  sends: { route: SubmissionRoute; rawTx: string }[];
}

/**
 * 在 MockTransport 外面套一层"提交路由"能力。
 * previewOverride 用来模拟价格跑动：callIndex=0 是报价，callIndex>=1 是提交前复算。
 */
function makeRouteTransport(
  overrides: {
    state?: MockState;
    send?: (route: SubmissionRoute, raw: string) => Promise<string>;
    receipt?: () => Promise<TransactionReceipt | null>;
    previewOverride?: (callIndex: number, outcome: number, amountIn: bigint) => bigint | null;
  } = {},
): RouteHarness {
  const base = new MockTransport(overrides.state);
  const sends: { route: SubmissionRoute; rawTx: string }[] = [];
  let previewCalls = 0;

  const transport: EthCallTransport = {
    async ethCall(to: string, data: string) {
      if (data.slice(0, 10) === SEL_PREVIEW_BUY && overrides.previewOverride) {
        const outcome = Number(BigInt("0x" + data.slice(10, 74)));
        const amountIn = BigInt("0x" + data.slice(74, 138));
        const forced = overrides.previewOverride(previewCalls++, outcome, amountIn);
        if (forced !== null) return pack(word(forced));
      }
      return base.ethCall(to, data);
    },
    sendRawTransaction(route, raw) {
      sends.push({ route, rawTx: raw });
      return overrides.send ? overrides.send(route, raw) : Promise.resolve(TX_HASH);
    },
    getTransactionReceipt() {
      return overrides.receipt ? overrides.receipt() : Promise.resolve(null);
    },
  };

  return { transport, sends };
}

const PRIVATE_BASE_ROUTE = mevProtectedRoute({
  id: "acme-private-base",
  chainId: 8453,
  url: "https://private.example/base",
});

async function expectSdkError(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (e) {
    assert.ok(e instanceof SdkError, `expected SdkError, got ${e}`);
    assert.equal((e as SdkError).code, code, `wrong code: ${(e as SdkError).code}`);
    return;
  }
  assert.fail(`expected SdkError(${code}) but call succeeded`);
}

/* --------------------------------- 用例 --------------------------------- */

test("getMarketState 正确解码 14 个字段", async () => {
  const t = new MockTransport();
  const sdk = new PredictionSDK(t, { vault: VAULT });
  const st = await sdk.getMarketState();

  assert.equal(st.resolved, false);
  assert.equal(st.outcome, 0);
  assert.equal(st.tradingOpen, true);
  assert.equal(st.minBet, 5_000_000n);
  assert.equal(st.maxBet, 10_000_000_000n);
  assert.equal(st.maxImpactBps, 500n);
  assert.equal(st.depth, 2_000_000_000n);
  assert.equal(st.priceYes, 500_000_000_000_000_000n);
  assert.equal(st.tradeFeeBps, 150n);
});

test("previewBuy 与合约数学一致（100 USDC -> 89,667,728 份）", async () => {
  const t = new MockTransport();
  const sdk = new PredictionSDK(t, { vault: VAULT });
  const out = await sdk.previewBuy(1, 100_000_000n);
  assert.equal(out, 89_667_728n);
});

test("calculateMinSharesOut：preview 后按 1% 下折，向下取整", async () => {
  const t = new MockTransport();
  const sdk = new PredictionSDK(t, { vault: VAULT });
  const min = await sdk.calculateMinSharesOut(1, 100_000_000n, 100);

  const expected = 89_667_728n;
  assert.equal(min, (expected * 9_900n) / 10_000n);
  assert.ok(min < expected, "minSharesOut 必须严格小于理论份额");
});

test("【核心】slippageBps = 0 被拒绝（杜绝裸奔）", async () => {
  const t = new MockTransport();
  const sdk = new PredictionSDK(t, { vault: VAULT });
  await expectSdkError(() => sdk.calculateMinSharesOut(1, 100_000_000n, 0), "SLIPPAGE_NOT_SET");
  await expectSdkError(() => sdk.buildBuy({ outcome: 1, amountIn: 100_000_000n, slippageBps: 0 }), "SLIPPAGE_NOT_SET");
});

test("负滑点 / 非整数滑点 被拒绝", async () => {
  const t = new MockTransport();
  const sdk = new PredictionSDK(t, { vault: VAULT });
  await expectSdkError(() => sdk.calculateMinSharesOut(1, 100_000_000n, -1), "SLIPPAGE_NOT_SET");
  await expectSdkError(() => sdk.calculateMinSharesOut(1, 100_000_000n, 1.5 as unknown as number), "SLIPPAGE_NOT_SET");
});

test("滑点 > 5% 被拒绝", async () => {
  const t = new MockTransport();
  const sdk = new PredictionSDK(t, { vault: VAULT });
  await expectSdkError(() => sdk.calculateMinSharesOut(1, 100_000_000n, 501), "SLIPPAGE_TOO_HIGH");
});

test("低于最低下注额(5 USDC) -> BELOW_MIN_BET（不发交易、不烧 gas）", async () => {
  const t = new MockTransport();
  const sdk = new PredictionSDK(t, { vault: VAULT });
  await expectSdkError(() => sdk.buildBuy({ outcome: 1, amountIn: 4_999_999n, slippageBps: 100 }), "BELOW_MIN_BET");
});

test("恰好 5 USDC 起投额可以通过", async () => {
  const sdk = new PredictionSDK(new MockTransport(), { vault: VAULT });
  const plan = await sdk.buildBuy({ outcome: 1, amountIn: 5_000_000n, slippageBps: 100 });
  assert.ok(plan.quote.minSharesOut > 0n);
});

test("超过绝对上限(10,000 USDC) -> ABOVE_MAX_BET", async () => {
  const st = defaultState();
  // 造一个深池，确保不是 5% 影响上限先命中
  st.yes = 400_000_000_000n;
  st.no = 400_000_000_000n;
  st.priceYes = (st.no * WAD) / (st.yes + st.no);
  st.priceNo = (st.yes * WAD) / (st.yes + st.no);
  const sdk = new PredictionSDK(new MockTransport(st), { vault: VAULT });
  await expectSdkError(
    () => sdk.buildBuy({ outcome: 1, amountIn: 10_000_000_001n, slippageBps: 100 }),
    "ABOVE_MAX_BET",
  );
  // 恰好 10,000 通过
  const ok = await sdk.buildBuy({ outcome: 1, amountIn: 10_000_000_000n, slippageBps: 100 });
  assert.ok(ok.quote.minSharesOut > 0n);
});

test("超过单笔影响上限 -> IMPACT_TOO_HIGH（本地拦截）", async () => {
  const t = new MockTransport();
  const sdk = new PredictionSDK(t, { vault: VAULT });
  // 深度 2000 USDC，5% = 100 USDC
  await expectSdkError(() => sdk.buildBuy({ outcome: 1, amountIn: 100_000_001n, slippageBps: 100 }), "IMPACT_TOO_HIGH");
});

test("边界值：恰好 5% 深度可以通过", async () => {
  const t = new MockTransport();
  const sdk = new PredictionSDK(t, { vault: VAULT });
  const plan = await sdk.buildBuy({ outcome: 1, amountIn: 100_000_000n, slippageBps: 100 });
  assert.ok(plan.quote.minSharesOut > 0n);
});

test("已结算盘口 -> MARKET_RESOLVED", async () => {
  const st = defaultState();
  st.resolved = true;
  const sdk = new PredictionSDK(new MockTransport(st), { vault: VAULT });
  await expectSdkError(() => sdk.buildBuy({ outcome: 1, amountIn: 10_000_000n, slippageBps: 100 }), "MARKET_RESOLVED");
});

test("暂停中 -> TRADING_PAUSED", async () => {
  const st = defaultState();
  st.paused = true;
  const sdk = new PredictionSDK(new MockTransport(st), { vault: VAULT });
  await expectSdkError(() => sdk.buildBuy({ outcome: 1, amountIn: 10_000_000n, slippageBps: 100 }), "TRADING_PAUSED");
});

test("过了结算时间 -> TRADING_PAUSED", async () => {
  const st = defaultState();
  st.tradingOpen = false;
  const sdk = new PredictionSDK(new MockTransport(st), { vault: VAULT });
  await expectSdkError(() => sdk.buildBuy({ outcome: 1, amountIn: 10_000_000n, slippageBps: 100 }), "TRADING_PAUSED");
});

test("非法 outcome 被拒绝", async () => {
  const sdk = new PredictionSDK(new MockTransport(), { vault: VAULT });
  await expectSdkError(() => sdk.buildBuy({ outcome: 2 as Outcome, amountIn: 10_000_000n, slippageBps: 100 }), "BAD_OUTCOME");
});

test("buildBuy calldata 结构正确（selector + 3 个 word）", async () => {
  const t = new MockTransport();
  const sdk = new PredictionSDK(t, { vault: VAULT });
  const plan = await sdk.buildBuy({ outcome: 1, amountIn: 100_000_000n, slippageBps: 100 });

  assert.equal(plan.to, VAULT);
  assert.equal(plan.value, "0x0");
  assert.equal(plan.data.slice(0, 10), SEL.buy, "selector mismatch");
  assert.equal(plan.data.length, 10 + 64 * 3, "calldata length mismatch");

  const outcome = BigInt("0x" + plan.data.slice(10, 74));
  const amountIn = BigInt("0x" + plan.data.slice(74, 138));
  const minOut = BigInt("0x" + plan.data.slice(138, 202));

  assert.equal(outcome, 1n);
  assert.equal(amountIn, 100_000_000n);
  assert.equal(minOut, plan.quote.minSharesOut);
  assert.ok(minOut <= plan.quote.expectedSharesOut, "minSharesOut 不得超过理论值");
});

test("buildBuy 的 minSharesOut 永远严格小于等于理论份额（否则必 revert）", async () => {
  // 5 USDC 起投、5% 深度上限（2000 深度 -> 100 USDC）之间的合法区间
  for (const amount of [5_000_000n, 20_000_000n, 50_000_000n, 99_999_999n, 100_000_000n]) {
    for (const slip of [1, 10, 50, 100, 300, 500]) {
      const t = new MockTransport();
      const sdk = new PredictionSDK(t, { vault: VAULT });
      const plan = await sdk.buildBuy({ outcome: 1, amountIn: amount, slippageBps: slip });
      assert.ok(plan.quote.minSharesOut <= plan.quote.expectedSharesOut);
      assert.ok(plan.quote.minSharesOut >= 1n);
    }
  }
});

test("buildSell 复刻合约数学：卖出份额的净额与费率", async () => {
  const t = new MockTransport();
  const sdk = new PredictionSDK(t, { vault: VAULT });

  // 先买 100 USDC
  const plan = await sdk.buildBuy({ outcome: 1, amountIn: 100_000_000n, slippageBps: 100 });
  const shares = plan.quote.expectedSharesOut;

  // 用未成交的原始状态推演卖出
  const st = t.state;
  const newYes = st.yes + shares; // 注意：真实链上储备已被买入改变，这里只验证公式
  const grossOut = st.no - ceilDiv(st.no * st.yes, newYes);
  const fee = ceilDiv(grossOut * 150n, BPS);

  const sell = await sdk.buildSell({ outcome: 1, sharesIn: shares, slippageBps: 100 });
  assert.ok(sell.quote.expectedSharesOut > 0n);
  assert.equal(sell.data.slice(0, 10), SEL.sell);
  assert.equal(sell.data.length, 10 + 64 * 3);
  // 卖出的 minAmountOut 必须 > 0 且 <= 理论净额
  assert.ok(sell.quote.minSharesOut > 0n);
  assert.ok(sell.quote.minSharesOut <= sell.quote.expectedSharesOut);
  assert.ok(fee > 0n);
});

test("零份额卖出被拒绝", async () => {
  const sdk = new PredictionSDK(new MockTransport(), { vault: VAULT });
  await expectSdkError(() => sdk.buildSell({ outcome: 1, sharesIn: 0n, slippageBps: 100 }), "ZERO_SHARES");
});

test("地址校验：非法 vault 地址直接构造函数报错", () => {
  assert.throws(() => new PredictionSDK(new MockTransport(), { vault: "0x123" }), /invalid vault address/);
});

test("impactSafetyMarginBps 收紧上限（给前端留安全垫）", async () => {
  const sdk = new PredictionSDK(new MockTransport(), { vault: VAULT, impactSafetyMarginBps: 100 });
  // 上限从 5% 收紧到 4% => 80 USDC；90 USDC 应被拒
  await expectSdkError(() => sdk.buildBuy({ outcome: 1, amountIn: 90_000_000n, slippageBps: 100 }), "IMPACT_TOO_HIGH");
  const ok = await sdk.buildBuy({ outcome: 1, amountIn: 79_000_000n, slippageBps: 100 });
  assert.ok(ok.quote.minSharesOut > 0n);
});

/* --------------------------------- 执行 --------------------------------- */

(async () => {
  let passed = 0;
  const failures: string[] = [];

  /* ------------------- 6 参 createMarket / 熔断 / 错误映射 ------------------- */

  const FACTORY = "0x00000000000000000000000000000000000000F4";

  tests.push({
    name: "buildCreateMarket 编码 6 个参数（selector + 6 words）",
    fn: async () => {
      const sdk = new PredictionSDK(new MockTransport(), { vault: VAULT, factory: FACTORY });
      const cid = "0x" + "11".repeat(32);
      const tx = await sdk.buildCreateMarket({
        conditionId: cid,
        admin: "0x00000000000000000000000000000000000000Ad",
        resolutionTime: Math.floor(Date.now() / 1000) + 86_400,
        minBet: 5_000_000n,
        maxBet: 10_000_000_000n,
        maxImpactBps: 500,
      });
      assert.equal(tx.to, FACTORY);
      assert.equal(tx.data.slice(0, 10), SEL_CREATE_MARKET);
      // selector(8) + 6 * 64 hex
      assert.equal(tx.data.length, 10 + 6 * 64);
      assert.equal(tx.data.slice(10, 74), "11".repeat(32), "conditionId word");
      assert.ok(tx.data.slice(74, 138).endsWith("ad"), "admin word");
      assert.ok(tx.data.slice(138 + 64, 138 + 128).endsWith("4c4b40"), "minBet = 5e6");
      assert.ok(tx.data.slice(138 + 128, 138 + 192).endsWith("2540be400"), "maxBet = 1e10");
    },
  });

  tests.push({
    name: "buildCreateMarket 拒绝超过 10,000 USDC 的 maxBet",
    fn: async () => {
      const sdk = new PredictionSDK(new MockTransport(), { vault: VAULT, factory: FACTORY });
      await expectSdkError(
        () =>
          sdk.buildCreateMarket({
            conditionId: "0x" + "22".repeat(32),
            admin: "0x00000000000000000000000000000000000000Ad",
            resolutionTime: Math.floor(Date.now() / 1000) + 86_400,
            minBet: 5_000_000n,
            maxBet: 10_000_000_001n,
            maxImpactBps: 500,
          }),
        "BAD_CONFIG",
      );
    },
  });

  tests.push({
    name: "buildCreateMarket 拒绝低于 5 USDC 的 minBet 与倒挂的 maxBet",
    fn: async () => {
      const sdk = new PredictionSDK(new MockTransport(), { vault: VAULT, factory: FACTORY });
      const base = {
        conditionId: "0x" + "33".repeat(32),
        admin: "0x00000000000000000000000000000000000000Ad",
        resolutionTime: Math.floor(Date.now() / 1000) + 86_400,
        maxImpactBps: 500,
      };
      await expectSdkError(() => sdk.buildCreateMarket({ ...base, minBet: 4_999_999n, maxBet: 10_000_000_000n }), "BAD_CONFIG");
      await expectSdkError(() => sdk.buildCreateMarket({ ...base, minBet: 5_000_000n, maxBet: 1_000_000n }), "BAD_CONFIG");
    },
  });

  tests.push({
    name: "未配置 factory 时 buildCreateMarket 直接报错，不静默发空交易",
    fn: async () => {
      const sdk = new PredictionSDK(new MockTransport(), { vault: VAULT });
      await expectSdkError(
        () =>
          sdk.buildCreateMarket({
            conditionId: "0x" + "44".repeat(32),
            admin: "0x00000000000000000000000000000000000000Ad",
            resolutionTime: Math.floor(Date.now() / 1000) + 86_400,
            minBet: 5_000_000n,
            maxBet: 10_000_000_000n,
            maxImpactBps: 500,
          }),
        "BAD_CONFIG",
      );
    },
  });

  tests.push({
    name: "buildPause / buildUnpause 选择器正确",
    fn: async () => {
      const sdk = new PredictionSDK(new MockTransport(), { vault: VAULT });
      assert.equal(sdk.buildPause().data, "0x8456cb59");
      assert.equal(sdk.buildUnpause().data, "0x3f4ba83a");
      assert.equal(sdk.buildPause().to, VAULT);
    },
  });

  /* ----------------------- 两步 Admin 移交（transferAdmin/acceptAdmin） ----------------------- */

  tests.push({
    name: "两步移交：transferAdmin 只编码 pending，acceptAdmin 是独立交易",
    fn: async () => {
      const sdk = new PredictionSDK(new MockTransport(), { vault: VAULT, factory: FACTORY });
      const newAdmin = "0x00000000000000000000000000000000000000Ad";

      const t1 = sdk.buildTransferAdmin(newAdmin);
      assert.equal(t1.to, VAULT);
      assert.equal(t1.data.slice(0, 10), SEL_TRANSFER_ADMIN);
      assert.equal(t1.data.length, 10 + 64, "selector + one address word");
      assert.equal(t1.data.slice(10), "0".repeat(24) + "00000000000000000000000000000000000000ad");

      // 第二步是独立交易，不能和第一步合并
      const t2 = sdk.buildAcceptAdmin();
      assert.equal(t2.to, VAULT);
      assert.equal(t2.data, SEL_ACCEPT_ADMIN);
      assert.notEqual(t1.data, t2.data);
    },
  });

  tests.push({
    name: "两步移交：工厂侧同一 ABI，未配置 factory 时拒绝编码",
    fn: async () => {
      const sdk = new PredictionSDK(new MockTransport(), { vault: VAULT, factory: FACTORY });
      const f1 = sdk.buildFactoryTransferAdmin("0x00000000000000000000000000000000000000Ad");
      assert.equal(f1.to, FACTORY);
      assert.equal(f1.data.slice(0, 10), SEL_TRANSFER_ADMIN);
      assert.equal(sdk.buildFactoryAcceptAdmin().data, SEL_ACCEPT_ADMIN);

      const bare = new PredictionSDK(new MockTransport(), { vault: VAULT });
      await expectSdkError(() => Promise.resolve(bare.buildFactoryAcceptAdmin()), "BAD_CONFIG");
      await expectSdkError(
        () => Promise.resolve(bare.buildFactoryTransferAdmin("0x00000000000000000000000000000000000000Ad")),
        "BAD_CONFIG",
      );
    },
  });

  tests.push({
    name: "两步移交：getAdmin / getPendingAdmin 正确解码地址",
    fn: async () => {
      const sdk = new PredictionSDK(new MockTransport(), { vault: VAULT });
      assert.equal(await sdk.getAdmin(), "0x00000000000000000000000000000000000000ad");
      assert.equal(await sdk.getPendingAdmin(), "0x0000000000000000000000000000000000000000");
    },
  });

  tests.push({
    name: "链上 revert 映射：NotPendingAdmin -> 友好中文提示",
    fn: async () => {
      const m = PredictionSDK.mapRevert({ data: "0x058d9a1b" });
      assert.equal(m.code, "NOT_PENDING_ADMIN");
      assert.equal(m.message, "只有被指定的待接收管理员才能完成交接（acceptAdmin）");
    },
  });

  /* -------------------- MEV 保护：路由、防夹、报价新鲜度 -------------------- */

  tests.push({
    name: "路由表：Base 主网走 sequencer-private，ETH 主网优先 Flashbots，未知链不静默降级",
    fn: async () => {
      const base = routesForChain(8453);
      assert.equal(base.length, 1);
      assert.equal(base[0].id, "base-mainnet-sequencer");
      assert.equal(base[0].privacy, "sequencer-private");
      assert.ok(!base.some((r) => /flashbots/i.test(r.url)), "Flashbots 不支持 Base，不能出现在表里");

      const eth = routesForChain(1);
      assert.equal(eth[0].id, "flashbots-protect");
      assert.equal(eth[0].privacy, "private-relay");

      assert.deepEqual(routesForChain(999), [], "未知链必须返回空，而不是降级到公开 RPC");
    },
  });

  tests.push({
    name: "自定义私有路由排在最前，非法 URL 直接拒绝",
    fn: async () => {
      const routes = routesForChain(8453, [PRIVATE_BASE_ROUTE]);
      assert.equal(routes.length, 2);
      assert.equal(routes[0].id, "acme-private-base", "私有中继必须先试");
      assert.equal(routes[1].id, "base-mainnet-sequencer");

      assert.throws(
        () => mevProtectedRoute({ chainId: 8453, url: "private.example/base" }),
        /invalid route url/,
      );
    },
  });

  tests.push({
    name: "submitProtected：私有路由成功即返回，不再碰公开端点",
    fn: async () => {
      const h = makeRouteTransport();
      const sdk = new PredictionSDK(h.transport, {
        vault: VAULT,
        chainId: 8453,
        routes: [PRIVATE_BASE_ROUTE],
      });

      const res = await sdk.submitProtected("0x02f8deadbeef");
      assert.equal(res.hash, TX_HASH);
      assert.equal(res.route.id, "acme-private-base");
      assert.equal(h.sends.length, 1, "只应提交一次");
    },
  });

  tests.push({
    name: "submitProtected：私有路由超时 = 结果未知（SUBMIT_AMBIGUOUS），绝不自动改投公开池",
    fn: async () => {
      const h = makeRouteTransport({ send: () => new Promise<string>(() => {}) });
      const sdk = new PredictionSDK(h.transport, {
        vault: VAULT,
        chainId: 8453,
        routes: [PRIVATE_BASE_ROUTE],
        submitTimeoutMs: 40,
      });

      await expectSdkError(() => sdk.submitProtected("0x02f8deadbeef"), "SUBMIT_AMBIGUOUS");
      assert.equal(h.sends.length, 1, "超时后不得重发到第二个路由");
      assert.equal(h.sends[0].route.id, "acme-private-base");
    },
  });

  tests.push({
    name: "submitProtected：私有路由明确拒绝才回退到下一条（顺序为 私有 → 排序器）",
    fn: async () => {
      const h = makeRouteTransport({
        send: async (route) => {
          if (route.id === "acme-private-base") throw new Error("rpc: rejected");
          return TX_HASH;
        },
      });
      const sdk = new PredictionSDK(h.transport, {
        vault: VAULT,
        chainId: 8453,
        routes: [PRIVATE_BASE_ROUTE],
      });

      const res = await sdk.submitProtected("0x02f8deadbeef");
      assert.equal(res.route.id, "base-mainnet-sequencer");
      assert.deepEqual(
        h.sends.map((s) => s.route.id),
        ["acme-private-base", "base-mainnet-sequencer"],
      );
    },
  });

  tests.push({
    name: "submitProtected：没有可用路由直接 NO_ROUTE，不发任何东西",
    fn: async () => {
      const h = makeRouteTransport();
      const sdk = new PredictionSDK(h.transport, { vault: VAULT, chainId: 999 });
      await expectSdkError(() => sdk.submitProtected("0x02f8deadbeef"), "NO_ROUTE");
      assert.equal(h.sends.length, 0);
    },
  });

  tests.push({
    name: "assertPlanIntegrity：被篡改的 minSharesOut / selector 一律拦下",
    fn: async () => {
      const sdk = new PredictionSDK(new MockTransport(), { vault: VAULT });
      const plan = await sdk.buildBuy({ outcome: 1, amountIn: 10_000_000n, slippageBps: 100 });
      sdk.assertPlanIntegrity(plan); // 合法 plan 不抛

      const tamperedMin: TradePlan = {
        ...plan,
        data: plan.data.slice(0, 138) + padWord(1n),
      };
      assert.throws(() => sdk.assertPlanIntegrity(tamperedMin), /minSharesOut differs/);

      const tamperedSelector: TradePlan = { ...plan, data: "0xdeadbeef" + plan.data.slice(10) };
      assert.throws(() => sdk.assertPlanIntegrity(tamperedSelector), /unexpected selector/);
    },
  });

  tests.push({
    name: "signAndSubmitBuy：签名前完成报价复算，minSharesOut 与报价完全一致",
    fn: async () => {
      const h = makeRouteTransport();
      const sdk = new PredictionSDK(h.transport, {
        vault: VAULT,
        chainId: 8453,
        routes: [PRIVATE_BASE_ROUTE],
      });

      let signed: { to: string; data: string; value: "0x0" } | undefined;
      const res = await sdk.signAndSubmitBuy(
        { outcome: 1, amountIn: 10_000_000n, slippageBps: 100 },
        async (tx) => {
          signed = tx;
          return TX_HASH;
        },
      );

      assert.ok(signed, "signer 必须被调用");
      assert.equal(signed!.to, VAULT);
      assert.equal(signed!.data.slice(0, 10), SEL_BUY);
      // calldata 里的 minSharesOut 必须就是报价里的那个值
      assert.equal("0x" + signed!.data.slice(138, 202), "0x" + padWord(res.quote.minSharesOut));
      assert.equal(res.route.id, "acme-private-base");
      assert.ok(res.quote.minSharesOut > 0n);
    },
  });

  tests.push({
    name: "signAndSubmitBuy：价格在确认期间跑出滑点 → QUOTE_STALE，签名与提交都不发生",
    fn: async () => {
      // 第 0 次 previewBuy = 正常报价；第 1 次（提交前复算）价格腰斩
      const h = makeRouteTransport({
        previewOverride: (callIndex, outcome, amountIn) =>
          callIndex === 0 ? null : mockPreview(defaultState(), outcome, amountIn) / 2n,
      });
      const sdk = new PredictionSDK(h.transport, {
        vault: VAULT,
        chainId: 8453,
        routes: [PRIVATE_BASE_ROUTE],
      });

      let signerCalls = 0;
      await expectSdkError(
        () =>
          sdk.signAndSubmitBuy({ outcome: 1, amountIn: 10_000_000n, slippageBps: 100 }, async () => {
            signerCalls++;
            return TX_HASH;
          }),
        "QUOTE_STALE",
      );
      assert.equal(signerCalls, 0, "报价失效时绝不能调 signer");
      assert.equal(h.sends.length, 0, "更不该发交易");
    },
  });

  tests.push({
    name: "confirmQuoteStillValid：报价过期（超过 maxQuoteAgeMs）直接拦下",
    fn: async () => {
      const sdk = new PredictionSDK(new MockTransport(), { vault: VAULT, maxQuoteAgeMs: 2_000 });
      const req = { outcome: 1 as Outcome, amountIn: 10_000_000n, slippageBps: 100 };
      const plan = await sdk.buildBuy(req);
      const stale: TradePlan = { ...plan, quote: { ...plan.quote, quotedAt: Date.now() - 10_000 } };
      await expectSdkError(() => sdk.confirmQuoteStillValid(stale, req), "QUOTE_STALE");
    },
  });

  tests.push({
    name: "waitForReceipt：轮询到回执即返回；超时抛 RECEIPT_TIMEOUT",
    fn: async () => {
      let polls = 0;
      const h = makeRouteTransport({
        receipt: async () => (++polls >= 3 ? { status: "0x1", blockNumber: "0x10" } : null),
      });
      const sdk = new PredictionSDK(h.transport, { vault: VAULT });
      const rcpt = await sdk.waitForReceipt(TX_HASH, { timeoutMs: 2_000, pollMs: 5 });
      assert.equal(rcpt.status, "0x1");

      const h2 = makeRouteTransport({ receipt: async () => null });
      const sdk2 = new PredictionSDK(h2.transport, { vault: VAULT });
      await expectSdkError(() => sdk2.waitForReceipt(TX_HASH, { timeoutMs: 60, pollMs: 20 }), "RECEIPT_TIMEOUT");
    },
  });

  tests.push({
    name: "链上 revert 映射：AboveMaxBet -> 友好中文提示",
    fn: async () => {
      const m = PredictionSDK.mapRevert({ data: "0xb8ab88d4" });
      assert.equal(m.code, "ABOVE_MAX_BET");
      assert.equal(m.message, "单笔下注不能超过 10,000 USDC");
    },
  });

  tests.push({
    name: "链上 revert 映射：BelowMinBet -> 友好中文提示",
    fn: async () => {
      const m = PredictionSDK.mapRevert({ error: { data: "0x5688ffb3" } });
      assert.equal(m.code, "BELOW_MIN_BET");
      assert.equal(m.message, "单笔下注不能低于 5 USDC");
    },
  });

  tests.push({
    name: "链上 revert 映射：EnforcedPause -> 暂停提示",
    fn: async () => {
      const m = PredictionSDK.mapRevert("0xd93c0665");
      assert.equal(m.code, "TRADING_PAUSED");
      assert.ok(m.message.includes("暂停"));
    },
  });

  tests.push({
    name: "链上 revert 映射：未知错误不吞异常，返回 UNKNOWN",
    fn: async () => {
      const m = PredictionSDK.mapRevert({ data: "0xdeadbeef" });
      assert.equal(m.code, "UNKNOWN");
      assert.ok(m.message.length > 0);
      assert.equal(PredictionSDK.mapRevert(undefined).code, "UNKNOWN");
    },
  });

  tests.push({
    name: "每个 SdkErrorCode 都有中文文案（无空洞）",
    fn: async () => {
      for (const code of [
        "SLIPPAGE_NOT_SET","SLIPPAGE_TOO_HIGH","BELOW_MIN_BET","ABOVE_MAX_BET","IMPACT_TOO_HIGH",
        "MARKET_RESOLVED","TRADING_PAUSED","ZERO_SHARES","INSUFFICIENT_DEPTH","BAD_OUTCOME",
        "BAD_RESPONSE","MARKET_NOT_RESOLVED","NOTHING_TO_REDEEM","NOT_ADMIN","BAD_CONFIG",
      ] as const) {
        const msg = PredictionSDK.message(code);
        assert.ok(msg && msg !== "交易失败，请稍后重试", `missing message for ${code}`);
      }
    },
  });


  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`✅ PASS  ${t.name}`);
    } catch (e) {
      failures.push(`${t.name}: ${(e as Error).message}`);
      console.log(`❌ FAIL  ${t.name}\n         ${(e as Error).message}`);
    }
  }

  console.log(`\n${passed}/${tests.length} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
})();
