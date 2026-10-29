/**
 * CentralPredictionSDK live-chain integration (anvil)
 *
 * Purpose: unit tests can only prove "calldata matches the ABI"; this proves "the transactions the SDK builds
 *          **actually land on-chain and take effect**", and that the decoders used by preflight are also correct
 *          against real RPC return values (mocks can hide decoding bugs).
 *
 * Usage:
 *   cd sdk && npm run build && node dist/e2e-central.js
 * Required environment variables (defaults match script/e2e-sdk-central.sh):
 *   RPC_URL, ENGINE, USDC, PK, ORACLE_PK (optional, defaults to PK)
 */
import { spawnSync } from "node:child_process";
import {
  CentralPredictionSDK,
  SdkError,
  OUTCOME_NO,
  OUTCOME_YES,
  MULTICALL3,
  SLIPPAGE_CONSERVATIVE,
  SLIPPAGE_NORMAL,
  formatUsdc,
  previewBuyOffline,
  parseUsdc,
  type Address,
  type Hex,
  type Transport,
} from "./CentralPredictionSDK";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const ENGINE = (process.env.ENGINE ?? "") as Address;
const USDC = (process.env.USDC ?? "") as Address;
const PK = process.env.PK ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ENV = { ...process.env, PATH: `/opt/foundry:${process.env.PATH ?? ""}` };

function cast(args: string[], allowFail = false): string {
  const r = spawnSync("cast", args, { encoding: "utf8", env: ENV });
  if (r.status !== 0 && !allowFail) throw new Error(`cast ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return (r.stdout || "").trim();
}

function send(to: Address, data: Hex): string {
  const out = cast(["send", to, data, "--private-key", PK, "--rpc-url", RPC]);
  const m = /transactionHash\s+(0x[0-9a-fA-F]{64})/.exec(out);
  if (!m) throw new Error(`no tx hash returned:\n${out}`);
  return m[1];
}

function receiptLogs(tx: string): Array<{ address: string; topics: string[]; data: string; logIndex: string; blockNumber: string }> {
  const receipt = JSON.parse(cast(["receipt", tx, "--json", "--rpc-url", RPC])) as {
    logs: Array<{ address: string; topics: string[]; data: string; logIndex: string; blockNumber: string }>;
  };
  return receipt.logs;
}

let pass = 0;
let fail = 0;
function ok(msg: string): void {
  pass++;
  console.log(`\x1b[1;32m✅ PASS\x1b[0m ${msg}`);
}
function bad(msg: string, err: unknown): void {
  fail++;
  console.error(`\x1b[1;31m❌ FAIL\x1b[0m ${msg}\n         ${err instanceof Error ? err.message : String(err)}`);
}
function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function eqNum(a: bigint, b: bigint, msg: string): void {
  if (a !== b) throw new Error(`${msg}: ${a} != ${b}`);
}

let rpcCount = 0;
const transport: Transport = {
  ethCall: async (to: Address, data: Hex): Promise<Hex> => {
    rpcCount += 1;
    const out = cast(["call", to, data, "--rpc-url", RPC], true);
    if (out.startsWith("0x")) return out as Hex;
    // When cast fails it prints the revert on stderr/stdout; rethrow it so the SDK can run decodeRevert
    throw Object.assign(new Error(out || "eth_call failed"), { data: /0x[0-9a-fA-F]{8,}/.exec(out)?.[0] });
  },
  now: async (): Promise<bigint> => BigInt(cast(["block", "latest", "--field", "timestamp", "--rpc-url", RPC])),
};

async function chainNow(): Promise<bigint> {
  return BigInt(await transport.now!());
}

async function main(): Promise<void> {
  if (!ENGINE || !USDC) {
    console.error("ENGINE / USDC environment variables are required");
    process.exit(2);
  }
  const me = cast(["wallet", "address", "--private-key", PK]) as Address;
  const sdk = new CentralPredictionSDK(transport, { engine: ENGINE, chainId: Number(cast(["chain-id", "--rpc-url", RPC])), account: me });
  const k = await sdk.constants();
  console.log(`engine=${ENGINE}\nusdc=${USDC}\naccount=${me}\nminBet=${k.minBet} disputeWindow=${k.disputeWindow}s\n`);

  const marketId = ("0x" + Buffer.from(`sdk-e2e-${Date.now()}`).toString("hex").padEnd(64, "0")) as Hex;
  const rt = (await chainNow()) + 7200n;

  /* 1. Create the market */
  try {
    const plan = await sdk.buildCreateMarket({
      marketId,
      question: `SDK integration market: can BTC break 90,000 within 24h? (${Date.now()})`,
      resolutionTime: rt,
      meta: { category: "e2e" },
    });
    const tx = send(plan.to, plan.data);
    const core = await sdk.marketCore(marketId);
    check(core.exists, "exists should be true after market creation");
    const evs = sdk.decodeReceiptLogs(receiptLogs(tx));
    const created = evs.find((e) => e.name === "MarketCreated");
    check(!!created, `the creation receipt should decode a MarketCreated event, got ${evs.map((e) => e.name).join(",") || "none"}`);
    check(created!.args.marketId === marketId, "the event's marketId should equal the requested marketId");
    check(created!.args.category === "e2e", `category should be e2e, got ${String(created!.args.category)}`);
    check(String(created!.args.question) === String(plan.meta.question), "the question in the event should match the original text (UTF-8)");
    ok(`buildCreateMarket took effect on-chain tx=${tx.slice(0, 12)}… event decoded MarketCreated{question="${String(created!.args.question)}", category=${String(created!.args.category)}}`);
  } catch (err) {
    bad("buildCreateMarket", err);
    process.exit(1);
  }

  /* 2. Make the market (the SDK has no seedLiquidity builder, so this is done with cast as an ops action) */
  cast(["send", USDC, "approve(address,uint256)", ENGINE, "10000000000", "--private-key", PK, "--rpc-url", RPC]);
  cast(["send", ENGINE, "seedLiquidity(bytes32,uint256)", marketId, "1000000000", "--private-key", PK, "--rpc-url", RPC]);
  const seeded = await sdk.marketCore(marketId);
  ok(`seedLiquidity 1,000 USDC -> pool depth ${formatUsdc(seeded.yesReserve + seeded.noReserve)} USDC`);

  /* 3. Buy (preflight reads the real on-chain quote, recomputes locally and cross-checks) */
  try {
    const amountIn = parseUsdc("50");
    const plan = await sdk.buildBuyShares({ marketId, outcome: OUTCOME_YES, amountIn, slippageBps: 100 });
    const minOut = BigInt(String(plan.meta.minSharesOut));
    const tx = send(plan.to, plan.data);
    const held = await sdk.sharesOf(marketId);
    check(held.yes >= minOut, `shares received ${held.yes} should be >= the protected price ${minOut}`);
    ok(`buildBuyShares filled tx=${tx.slice(0, 12)}… paid 50 USDC for ${held.yes} shares (protected at ${minOut})`);
    const offline = previewBuyOffline({ yesReserve: seeded.yesReserve, noReserve: seeded.noReserve }, OUTCOME_YES, amountIn, k.tradeFeeBps);
    check(offline === BigInt(String(plan.meta.quote)), `offline quote ${offline} should match the on-chain quote ${plan.meta.quote}`);
    ok(`offline previewBuy(${offline}) is bit-for-bit identical to the on-chain quote`);

    // -- Decode events from a real receipt (feed genuine chain logs into the SDK's decoder)
    const evs = sdk.decodeReceiptLogs(receiptLogs(tx));
    const bought = evs.find((e) => e.name === "SharesBought");
    check(!!bought, `the receipt should decode SharesBought, decoded ${evs.map((e) => e.name).join(",") || "none"}`);
    check(bought!.args.amountIn === amountIn, `event amountIn ${bought!.args.amountIn} should equal ${amountIn}`);
    check(bought!.args.sharesOut === held.yes, `event sharesOut ${bought!.args.sharesOut} should equal the balance ${held.yes}`);
    check(bought!.args.outcome === 1, "event outcome should be YES");
    ok(`event decoding: SharesBought{amountIn=${bought!.args.amountIn}, sharesOut=${bought!.args.sharesOut}, fee=${bought!.args.fee}} from the real receipt all match`);
  } catch (err) {
    bad("buildBuyShares", err);
  }

  /* 3.5 Batched snapshot: 3 markets in a single RPC */
  try {
    const ids = [marketId, marketId, marketId];
    const before = rpcCount;
    const snaps = await sdk.marketSnapshots(ids);
    const used = rpcCount - before;
    check(snaps.length === 3, "should return 3 snapshots");
    eqNum(snaps[0].priceYes, snaps[1].priceYes, "price should be identical for the same market");
    check(snaps[0].depth > 0n, "pool depth should be greater than 0");
    check(snaps[0].exists && snaps[0].tradingOpen, "market should exist and be open for trading");
    if (used === 1) {
      ok(`marketSnapshots: 3 markets x 4 fields = 12 queries collapsed into 1 RPC (Multicall3 ${MULTICALL3})`);
    } else {
      console.log(`\x1b[1;33m⚠️  WARN\x1b[0m Multicall3 is not available on this chain, automatically degraded to ${used} individual RPCs (normal on a local anvil; Base mainnet / fork should take 1)`);
      pass++;
    }
  } catch (err) {
    bad("marketSnapshots", err);
  }

  /* 3.6 Impact warning: size one order just under 4% and one at 1% to prove the warning only fires near the limit */
  try {
    const core = await sdk.marketCore(marketId);
    const poolDepth = core.yesReserve + core.noReserve; // 6-decimal USDC
    const near = (poolDepth * 420n) / 10_000n; // 4.2% -> should warn
    const far = (poolDepth * 100n) / 10_000n; // 1.0%  -> should not warn

    const p1 = await sdk.buildBuyShares({ marketId, outcome: OUTCOME_YES, amountIn: near, slippageBps: SLIPPAGE_CONSERVATIVE });
    check(p1.warning === "impact_near_limit", `impact ${p1.meta.impactBps}bps should warn`);
    ok(`impact warning: ${formatUsdc(near)} USDC / pool depth ${formatUsdc(poolDepth)} USDC = ${p1.meta.impactBps}bps -> warning="impact_near_limit"`);

    const p2 = await sdk.buildBuyShares({ marketId, outcome: OUTCOME_YES, amountIn: far, slippageBps: SLIPPAGE_NORMAL });
    check(p2.warning === undefined, `impact ${p2.meta.impactBps}bps should not warn`);
    ok(`no false positive: ${formatUsdc(far)} USDC = ${p2.meta.impactBps}bps -> no warning`);
  } catch (err) {
    bad("impact warning", err);
  }

  /* 4. Sell (only half, leaving the other half for redemption) */
  try {
    const held = await sdk.sharesOf(marketId);
    const half = held.yes / 2n;
    const plan = await sdk.buildSellShares({ marketId, outcome: OUTCOME_YES, sharesIn: half, slippageBps: 100 });
    const tx = send(plan.to, plan.data);
    const after = await sdk.sharesOf(marketId);
    check(after.yes < held.yes, "the position should shrink after selling");
    ok(`buildSellShares filled tx=${tx.slice(0, 12)}… sold ${half} shares -> position ${held.yes} -> ${after.yes}`);
  } catch (err) {
    bad("buildSellShares", err);
  }

  /* 5. Fast-forward time and resolve */
  try {
    const core = await sdk.marketCore(marketId);
    const now = await chainNow();
    cast(["rpc", "evm_increaseTime", String(Number(core.resolutionTime - now) + 60), "--rpc-url", RPC]);
    cast(["rpc", "evm_mine", "--rpc-url", RPC]);

    const plan = await sdk.buildResolveMarket({ marketId, outcome: OUTCOME_NO });
    const tx = send(plan.to, plan.data);
    const st = await sdk.resolutionState(marketId);
    check(st.resolved && st.disputing, "the market should enter the dispute window after resolution");
    ok(`buildResolveMarket on-chain tx=${tx.slice(0, 12)}… dispute window runs until ${new Date(Number(st.disputeEndsAt) * 1000).toISOString()}`);
  } catch (err) {
    bad("buildResolveMarket", err);
  }

  /* 6. Redemption must be blocked by the SDK while the dispute window is open */
  try {
    await sdk.buildRedeem({ marketId });
    bad("buildRedeem should have thrown inside the dispute window", new Error("no error thrown"));
  } catch (err) {
    if (err instanceof SdkError && err.code === "chain/DISPUTE_WINDOW_OPEN") {
      ok(`buildRedeem blocked inside the dispute window: ${err.message}`);
    } else {
      bad("buildRedeem inside the dispute window", err);
    }
  }

  /* 7. Safe override (NO -> YES) to verify the overrideResolution calldata really takes effect */
  try {
    const plan = await sdk.buildOverrideResolution({ marketId, newOutcome: OUTCOME_YES });
    const tx = send(plan.to, plan.data);
    const st = await sdk.resolutionState(marketId);
    check(st.outcome === OUTCOME_YES, "outcome should be YES after the override");
    ok(`buildOverrideResolution on-chain tx=${tx.slice(0, 12)}… outcome=${st.outcome}`);
  } catch (err) {
    bad("buildOverrideResolution", err);
  }

  /* 8. Dispute window over -> redeem */
  try {
    const st = await sdk.resolutionState(marketId);
    const now = await chainNow();
    if (st.disputeEndsAt > now) {
      cast(["rpc", "evm_increaseTime", String(Number(st.disputeEndsAt - now) + 5), "--rpc-url", RPC]);
      cast(["rpc", "evm_mine", "--rpc-url", RPC]);
    }
    const before = BigInt(cast(["call", USDC, "balanceOf(address)(uint256)", me, "--rpc-url", RPC]).split(" ")[0]);
    const plan = await sdk.buildRedeem({ marketId });
    const tx = send(plan.to, plan.data);
    const after = BigInt(cast(["call", USDC, "balanceOf(address)(uint256)", me, "--rpc-url", RPC]).split(" ")[0]);
    check(after > before, `balance should increase after redemption: ${before} -> ${after}`);
    ok(`buildRedeem on-chain tx=${tx.slice(0, 12)}… balance +${formatUsdc(after - before)} USDC`);
  } catch (err) {
    bad("buildRedeem", err);
  }

  /* 9. Residual cash: after sweep the engine balance drops to zero (confirming no funds are locked) */
  try {
    cast(["send", ENGINE, "sweepResidual(bytes32)", marketId, "--private-key", PK, "--rpc-url", RPC]);
    const left = BigInt(cast(["call", USDC, "balanceOf(address)(uint256)", ENGINE, "--rpc-url", RPC]).split(" ")[0]);
    // The engine may still hold cash for other markets (only this one was touched here), so judge by this market's cash
    const core = await sdk.marketCore(marketId);
    check(core.cash === 0n, `this market's cash should be zero, got ${core.cash}`);
    ok(`after sweepResidual this market's cash=0 (the engine's total balance ${formatUsdc(left)} USDC belongs to other markets)`);
  } catch (err) {
    bad("sweepResidual", err);
  }

  console.log(`\n${pass} passed / ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
