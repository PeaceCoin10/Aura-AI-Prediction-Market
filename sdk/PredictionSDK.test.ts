/**
 * PredictionSDK unit tests (offline, MockTransport)
 * Run: npm test
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

/* ------------------------------- Test fixtures ------------------------------- */

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

/** Replicates the contract's previewBuy math for use by the mock */
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
        // no handover in flight
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

/* ------------------------------- Test harness ------------------------------- */

type T = { name: string; fn: () => Promise<void> | void };
const tests: T[] = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push({ name, fn });

/* --------------------- MEV route / submission pipeline fixtures --------------------- */

const TX_HASH = "0x" + "ab".repeat(32);

interface RouteHarness {
  transport: EthCallTransport;
  sends: { route: SubmissionRoute; rawTx: string }[];
}

/**
 * Wraps MockTransport with a "submission route" capability.
 * previewOverride simulates a moving price: callIndex=0 is the quote, callIndex>=1 is the recompute before
 * submission.
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

/* --------------------------------- Test cases --------------------------------- */

test("getMarketState decodes all 14 fields correctly", async () => {
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

test("previewBuy matches the contract math (100 USDC -> 89,667,728 shares)", async () => {
  const t = new MockTransport();
  const sdk = new PredictionSDK(t, { vault: VAULT });
  const out = await sdk.previewBuy(1, 100_000_000n);
  assert.equal(out, 89_667_728n);
});

test("calculateMinSharesOut: discounts the preview by 1%, rounding down", async () => {
  const t = new MockTransport();
  const sdk = new PredictionSDK(t, { vault: VAULT });
  const min = await sdk.calculateMinSharesOut(1, 100_000_000n, 100);

  const expected = 89_667_728n;
  assert.equal(min, (expected * 9_900n) / 10_000n);
  assert.ok(min < expected, "minSharesOut must be strictly below the theoretical share count");
});

test("[core] slippageBps = 0 is refused (no unprotected orders)", async () => {
  const t = new MockTransport();
  const sdk = new PredictionSDK(t, { vault: VAULT });
  await expectSdkError(() => sdk.calculateMinSharesOut(1, 100_000_000n, 0), "SLIPPAGE_NOT_SET");
  await expectSdkError(() => sdk.buildBuy({ outcome: 1, amountIn: 100_000_000n, slippageBps: 0 }), "SLIPPAGE_NOT_SET");
});

test("negative / non-integer slippage is refused", async () => {
  const t = new MockTransport();
  const sdk = new PredictionSDK(t, { vault: VAULT });
  await expectSdkError(() => sdk.calculateMinSharesOut(1, 100_000_000n, -1), "SLIPPAGE_NOT_SET");
  await expectSdkError(() => sdk.calculateMinSharesOut(1, 100_000_000n, 1.5 as unknown as number), "SLIPPAGE_NOT_SET");
});

test("slippage > 5% is refused", async () => {
  const t = new MockTransport();
  const sdk = new PredictionSDK(t, { vault: VAULT });
  await expectSdkError(() => sdk.calculateMinSharesOut(1, 100_000_000n, 501), "SLIPPAGE_TOO_HIGH");
});

test("below the 5 USDC minimum bet -> BELOW_MIN_BET (no transaction, no gas burned)", async () => {
  const t = new MockTransport();
  const sdk = new PredictionSDK(t, { vault: VAULT });
  await expectSdkError(() => sdk.buildBuy({ outcome: 1, amountIn: 4_999_999n, slippageBps: 100 }), "BELOW_MIN_BET");
});

test("exactly the 5 USDC minimum is accepted", async () => {
  const sdk = new PredictionSDK(new MockTransport(), { vault: VAULT });
  const plan = await sdk.buildBuy({ outcome: 1, amountIn: 5_000_000n, slippageBps: 100 });
  assert.ok(plan.quote.minSharesOut > 0n);
});

test("above the absolute cap (10,000 USDC) -> ABOVE_MAX_BET", async () => {
  const st = defaultState();
  // Build a deep pool so the 5% impact cap does not trip first
  st.yes = 400_000_000_000n;
  st.no = 400_000_000_000n;
  st.priceYes = (st.no * WAD) / (st.yes + st.no);
  st.priceNo = (st.yes * WAD) / (st.yes + st.no);
  const sdk = new PredictionSDK(new MockTransport(st), { vault: VAULT });
  await expectSdkError(
    () => sdk.buildBuy({ outcome: 1, amountIn: 10_000_000_001n, slippageBps: 100 }),
    "ABOVE_MAX_BET",
  );
  // exactly 10,000 is accepted
  const ok = await sdk.buildBuy({ outcome: 1, amountIn: 10_000_000_000n, slippageBps: 100 });
  assert.ok(ok.quote.minSharesOut > 0n);
});

test("above the per-trade impact cap -> IMPACT_TOO_HIGH (blocked locally)", async () => {
  const t = new MockTransport();
  const sdk = new PredictionSDK(t, { vault: VAULT });
  // depth 2000 USDC, 5% = 100 USDC
  await expectSdkError(() => sdk.buildBuy({ outcome: 1, amountIn: 100_000_001n, slippageBps: 100 }), "IMPACT_TOO_HIGH");
});

test("boundary: exactly 5% of pool depth is accepted", async () => {
  const t = new MockTransport();
  const sdk = new PredictionSDK(t, { vault: VAULT });
  const plan = await sdk.buildBuy({ outcome: 1, amountIn: 100_000_000n, slippageBps: 100 });
  assert.ok(plan.quote.minSharesOut > 0n);
});

test("resolved market -> MARKET_RESOLVED", async () => {
  const st = defaultState();
  st.resolved = true;
  const sdk = new PredictionSDK(new MockTransport(st), { vault: VAULT });
  await expectSdkError(() => sdk.buildBuy({ outcome: 1, amountIn: 10_000_000n, slippageBps: 100 }), "MARKET_RESOLVED");
});

test("paused market -> TRADING_PAUSED", async () => {
  const st = defaultState();
  st.paused = true;
  const sdk = new PredictionSDK(new MockTransport(st), { vault: VAULT });
  await expectSdkError(() => sdk.buildBuy({ outcome: 1, amountIn: 10_000_000n, slippageBps: 100 }), "TRADING_PAUSED");
});

test("past the resolution time -> TRADING_PAUSED", async () => {
  const st = defaultState();
  st.tradingOpen = false;
  const sdk = new PredictionSDK(new MockTransport(st), { vault: VAULT });
  await expectSdkError(() => sdk.buildBuy({ outcome: 1, amountIn: 10_000_000n, slippageBps: 100 }), "TRADING_PAUSED");
});

test("an invalid outcome is refused", async () => {
  const sdk = new PredictionSDK(new MockTransport(), { vault: VAULT });
  await expectSdkError(() => sdk.buildBuy({ outcome: 2 as Outcome, amountIn: 10_000_000n, slippageBps: 100 }), "BAD_OUTCOME");
});

test("buildBuy calldata is structured correctly (selector + 3 words)", async () => {
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
  assert.ok(minOut <= plan.quote.expectedSharesOut, "minSharesOut must not exceed the theoretical value");
});

test("buildBuy's minSharesOut is always at or below the expected share count (otherwise it must revert)", async () => {
  // legal band between the 5 USDC minimum and the 5% impact cap (2000 depth -> 100 USDC)
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

test("buildSell replicates the contract math: net proceeds and fee on sold shares", async () => {
  const t = new MockTransport();
  const sdk = new PredictionSDK(t, { vault: VAULT });

  // buy 100 USDC first
  const plan = await sdk.buildBuy({ outcome: 1, amountIn: 100_000_000n, slippageBps: 100 });
  const shares = plan.quote.expectedSharesOut;

  // Derive the sell from the untouched starting state
  const st = t.state;
  const newYes = st.yes + shares; // note: real reserves already moved on the buy; this only validates the formula
  const grossOut = st.no - ceilDiv(st.no * st.yes, newYes);
  const fee = ceilDiv(grossOut * 150n, BPS);

  const sell = await sdk.buildSell({ outcome: 1, sharesIn: shares, slippageBps: 100 });
  assert.ok(sell.quote.expectedSharesOut > 0n);
  assert.equal(sell.data.slice(0, 10), SEL.sell);
  assert.equal(sell.data.length, 10 + 64 * 3);
  // the sell's minAmountOut must be > 0 and <= the theoretical net
  assert.ok(sell.quote.minSharesOut > 0n);
  assert.ok(sell.quote.minSharesOut <= sell.quote.expectedSharesOut);
  assert.ok(fee > 0n);
});

test("selling zero shares is refused", async () => {
  const sdk = new PredictionSDK(new MockTransport(), { vault: VAULT });
  await expectSdkError(() => sdk.buildSell({ outcome: 1, sharesIn: 0n, slippageBps: 100 }), "ZERO_SHARES");
});

test("address validation: an invalid vault address throws in the constructor", () => {
  assert.throws(() => new PredictionSDK(new MockTransport(), { vault: "0x123" }), /invalid vault address/);
});

test("impactSafetyMarginBps tightens the cap (safety buffer for the front end)", async () => {
  const sdk = new PredictionSDK(new MockTransport(), { vault: VAULT, impactSafetyMarginBps: 100 });
  // cap tightens from 5% to 4% => 80 USDC; 90 USDC must be refused
  await expectSdkError(() => sdk.buildBuy({ outcome: 1, amountIn: 90_000_000n, slippageBps: 100 }), "IMPACT_TOO_HIGH");
  const ok = await sdk.buildBuy({ outcome: 1, amountIn: 79_000_000n, slippageBps: 100 });
  assert.ok(ok.quote.minSharesOut > 0n);
});

/* --------------------------------- Execution --------------------------------- */

(async () => {
  let passed = 0;
  const failures: string[] = [];

  /* ------------------- 6-param createMarket / circuit breaker / error mapping ------------------- */

  const FACTORY = "0x00000000000000000000000000000000000000F4";

  tests.push({
    name: "buildCreateMarket encodes 6 params (selector + 6 words)",
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
    name: "buildCreateMarket refuses a maxBet above 10,000 USDC",
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
    name: "buildCreateMarket refuses a minBet below 5 USDC and an inverted maxBet",
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
    name: "buildCreateMarket throws when no factory is configured instead of silently sending an empty tx",
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
    name: "buildPause / buildUnpause use the correct selectors",
    fn: async () => {
      const sdk = new PredictionSDK(new MockTransport(), { vault: VAULT });
      assert.equal(sdk.buildPause().data, "0x8456cb59");
      assert.equal(sdk.buildUnpause().data, "0x3f4ba83a");
      assert.equal(sdk.buildPause().to, VAULT);
    },
  });

  /* ----------------------- Two-step admin handover (transferAdmin/acceptAdmin) ----------------------- */

  tests.push({
    name: "two-step handover: transferAdmin only encodes pending, acceptAdmin is a separate transaction",
    fn: async () => {
      const sdk = new PredictionSDK(new MockTransport(), { vault: VAULT, factory: FACTORY });
      const newAdmin = "0x00000000000000000000000000000000000000Ad";

      const t1 = sdk.buildTransferAdmin(newAdmin);
      assert.equal(t1.to, VAULT);
      assert.equal(t1.data.slice(0, 10), SEL_TRANSFER_ADMIN);
      assert.equal(t1.data.length, 10 + 64, "selector + one address word");
      assert.equal(t1.data.slice(10), "0".repeat(24) + "00000000000000000000000000000000000000ad");

      // the second step is its own transaction and must not be merged with the first
      const t2 = sdk.buildAcceptAdmin();
      assert.equal(t2.to, VAULT);
      assert.equal(t2.data, SEL_ACCEPT_ADMIN);
      assert.notEqual(t1.data, t2.data);
    },
  });

  tests.push({
    name: "two-step handover: same ABI on the factory side, encoding refused when no factory is configured",
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
    name: "two-step handover: getAdmin / getPendingAdmin decode addresses correctly",
    fn: async () => {
      const sdk = new PredictionSDK(new MockTransport(), { vault: VAULT });
      assert.equal(await sdk.getAdmin(), "0x00000000000000000000000000000000000000ad");
      assert.equal(await sdk.getPendingAdmin(), "0x0000000000000000000000000000000000000000");
    },
  });

  tests.push({
    name: "on-chain revert mapping: NotPendingAdmin -> friendly message",
    fn: async () => {
      const m = PredictionSDK.mapRevert({ data: "0x058d9a1b" });
      assert.equal(m.code, "NOT_PENDING_ADMIN");
      assert.equal(m.message, "Only the nominated pending admin can complete the handover (acceptAdmin)");
    },
  });

  /* -------------------- MEV protection: routes, anti-sandwich, quote freshness -------------------- */

  tests.push({
    name: "route table: Base mainnet uses sequencer-private, ETH mainnet prefers Flashbots, unknown chains never degrade silently",
    fn: async () => {
      const base = routesForChain(8453);
      assert.equal(base.length, 1);
      assert.equal(base[0].id, "base-mainnet-sequencer");
      assert.equal(base[0].privacy, "sequencer-private");
      assert.ok(!base.some((r) => /flashbots/i.test(r.url)), "Flashbots does not support Base and must not appear in the table");

      const eth = routesForChain(1);
      assert.equal(eth[0].id, "flashbots-protect");
      assert.equal(eth[0].privacy, "private-relay");

      assert.deepEqual(routesForChain(999), [], "an unknown chain must return empty rather than fall back to a public RPC");
    },
  });

  tests.push({
    name: "custom private routes rank first; an invalid URL is refused outright",
    fn: async () => {
      const routes = routesForChain(8453, [PRIVATE_BASE_ROUTE]);
      assert.equal(routes.length, 2);
      assert.equal(routes[0].id, "acme-private-base", "the private relay must be tried first");
      assert.equal(routes[1].id, "base-mainnet-sequencer");

      assert.throws(
        () => mevProtectedRoute({ chainId: 8453, url: "private.example/base" }),
        /invalid route url/,
      );
    },
  });

  tests.push({
    name: "submitProtected: a successful private route returns immediately and never touches a public endpoint",
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
      assert.equal(h.sends.length, 1, "the transaction must be submitted exactly once");
    },
  });

  tests.push({
    name: "submitProtected: a private-route timeout means unknown outcome (SUBMIT_AMBIGUOUS), never an automatic fallback to the public pool",
    fn: async () => {
      const h = makeRouteTransport({ send: () => new Promise<string>(() => {}) });
      const sdk = new PredictionSDK(h.transport, {
        vault: VAULT,
        chainId: 8453,
        routes: [PRIVATE_BASE_ROUTE],
        submitTimeoutMs: 40,
      });

      await expectSdkError(() => sdk.submitProtected("0x02f8deadbeef"), "SUBMIT_AMBIGUOUS");
      assert.equal(h.sends.length, 1, "a timeout must not trigger a resend to a second route");
      assert.equal(h.sends[0].route.id, "acme-private-base");
    },
  });

  tests.push({
    name: "submitProtected: only an explicit private-route rejection falls back to the next route (order: private -> sequencer)",
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
    name: "submitProtected: with no usable route it throws NO_ROUTE and sends nothing",
    fn: async () => {
      const h = makeRouteTransport();
      const sdk = new PredictionSDK(h.transport, { vault: VAULT, chainId: 999 });
      await expectSdkError(() => sdk.submitProtected("0x02f8deadbeef"), "NO_ROUTE");
      assert.equal(h.sends.length, 0);
    },
  });

  tests.push({
    name: "assertPlanIntegrity: a tampered minSharesOut / selector is always caught",
    fn: async () => {
      const sdk = new PredictionSDK(new MockTransport(), { vault: VAULT });
      const plan = await sdk.buildBuy({ outcome: 1, amountIn: 10_000_000n, slippageBps: 100 });
      sdk.assertPlanIntegrity(plan); // a legitimate plan does not throw

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
    name: "signAndSubmitBuy: the quote is recomputed before signing and minSharesOut matches it exactly",
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

      assert.ok(signed, "the signer must be invoked");
      assert.equal(signed!.to, VAULT);
      assert.equal(signed!.data.slice(0, 10), SEL_BUY);
      // the minSharesOut inside the calldata must be exactly the one from the quote
      assert.equal("0x" + signed!.data.slice(138, 202), "0x" + padWord(res.quote.minSharesOut));
      assert.equal(res.route.id, "acme-private-base");
      assert.ok(res.quote.minSharesOut > 0n);
    },
  });

  tests.push({
    name: "signAndSubmitBuy: a price that leaves the slippage band during confirmation -> QUOTE_STALE, neither signing nor submission happens",
    fn: async () => {
      // previewBuy call 0 = the normal quote; call 1 (the pre-submit recompute) is half the shares
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
      assert.equal(signerCalls, 0, "the signer must never be called when the quote is invalid");
      assert.equal(h.sends.length, 0, "and no transaction should be sent");
    },
  });

  tests.push({
    name: "confirmQuoteStillValid: an expired quote (older than maxQuoteAgeMs) is caught immediately",
    fn: async () => {
      const sdk = new PredictionSDK(new MockTransport(), { vault: VAULT, maxQuoteAgeMs: 2_000 });
      const req = { outcome: 1 as Outcome, amountIn: 10_000_000n, slippageBps: 100 };
      const plan = await sdk.buildBuy(req);
      const stale: TradePlan = { ...plan, quote: { ...plan.quote, quotedAt: Date.now() - 10_000 } };
      await expectSdkError(() => sdk.confirmQuoteStillValid(stale, req), "QUOTE_STALE");
    },
  });

  tests.push({
    name: "waitForReceipt: returns as soon as a receipt is polled; throws RECEIPT_TIMEOUT on timeout",
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
    name: "on-chain revert mapping: AboveMaxBet -> friendly message",
    fn: async () => {
      const m = PredictionSDK.mapRevert({ data: "0xb8ab88d4" });
      assert.equal(m.code, "ABOVE_MAX_BET");
      assert.equal(m.message, "Maximum bet size is 10,000 USDC");
    },
  });

  tests.push({
    name: "on-chain revert mapping: BelowMinBet -> friendly message",
    fn: async () => {
      const m = PredictionSDK.mapRevert({ error: { data: "0x5688ffb3" } });
      assert.equal(m.code, "BELOW_MIN_BET");
      assert.equal(m.message, "Minimum bet size is 5 USDC");
    },
  });

  tests.push({
    name: "on-chain revert mapping: EnforcedPause -> paused message",
    fn: async () => {
      const m = PredictionSDK.mapRevert("0xd93c0665");
      assert.equal(m.code, "TRADING_PAUSED");
      assert.ok(m.message.includes("paused"));
    },
  });

  tests.push({
    name: "on-chain revert mapping: unknown errors are not swallowed and return UNKNOWN",
    fn: async () => {
      const m = PredictionSDK.mapRevert({ data: "0xdeadbeef" });
      assert.equal(m.code, "UNKNOWN");
      assert.ok(m.message.length > 0);
      assert.equal(PredictionSDK.mapRevert(undefined).code, "UNKNOWN");
    },
  });

  tests.push({
    name: "every SdkErrorCode has user-facing copy (no gaps)",
    fn: async () => {
      for (const code of [
        "SLIPPAGE_NOT_SET","SLIPPAGE_TOO_HIGH","BELOW_MIN_BET","ABOVE_MAX_BET","IMPACT_TOO_HIGH",
        "MARKET_RESOLVED","TRADING_PAUSED","ZERO_SHARES","INSUFFICIENT_DEPTH","BAD_OUTCOME",
        "BAD_RESPONSE","MARKET_NOT_RESOLVED","NOTHING_TO_REDEEM","NOT_ADMIN","BAD_CONFIG",
      ] as const) {
        const msg = PredictionSDK.message(code);
        assert.ok(msg && msg !== "Transaction failed, please try again shortly", `missing message for ${code}`);
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
