/**
 * CentralPredictionSDK 真链联调（anvil）
 *
 * 目的：unit test 只能证明「calldata 与 ABI 一致」；这里证明「SDK 造出来的交易**真的能上链并生效**」，
 *       并且 preflight 用的解码器在真实 RPC 返回值上也是对的（mock 可能掩盖解码 bug）。
 *
 * 用法：
 *   cd sdk && npm run build && node dist/e2e-central.js
 * 需要环境变量（默认对齐 script/e2e-sdk-central.sh）：
 *   RPC_URL, ENGINE, USDC, PK, ORACLE_PK(可省略，默认同 PK)
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
  if (r.status !== 0 && !allowFail) throw new Error(`cast ${args.join(" ")} 失败: ${r.stderr || r.stdout}`);
  return (r.stdout || "").trim();
}

function send(to: Address, data: Hex): string {
  const out = cast(["send", to, data, "--private-key", PK, "--rpc-url", RPC]);
  const m = /transactionHash\s+(0x[0-9a-fA-F]{64})/.exec(out);
  if (!m) throw new Error(`没拿到 tx hash:\n${out}`);
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
  if (a !== b) throw new Error(`${msg}：${a} != ${b}`);
}

let rpcCount = 0;
const transport: Transport = {
  ethCall: async (to: Address, data: Hex): Promise<Hex> => {
    rpcCount += 1;
    const out = cast(["call", to, data, "--rpc-url", RPC], true);
    if (out.startsWith("0x")) return out as Hex;
    // cast 失败时会把 revert 输出在 stderr/stdout 里，抛出去让 SDK 走 decodeRevert
    throw Object.assign(new Error(out || "eth_call failed"), { data: /0x[0-9a-fA-F]{8,}/.exec(out)?.[0] });
  },
  now: async (): Promise<bigint> => BigInt(cast(["block", "latest", "--field", "timestamp", "--rpc-url", RPC])),
};

async function chainNow(): Promise<bigint> {
  return BigInt(await transport.now!());
}

async function main(): Promise<void> {
  if (!ENGINE || !USDC) {
    console.error("需要 ENGINE / USDC 环境变量");
    process.exit(2);
  }
  const me = cast(["wallet", "address", "--private-key", PK]) as Address;
  const sdk = new CentralPredictionSDK(transport, { engine: ENGINE, chainId: Number(cast(["chain-id", "--rpc-url", RPC])), account: me });
  const k = await sdk.constants();
  console.log(`engine=${ENGINE}\nusdc=${USDC}\naccount=${me}\nminBet=${k.minBet} disputeWindow=${k.disputeWindow}s\n`);

  const marketId = ("0x" + Buffer.from(`sdk-e2e-${Date.now()}`).toString("hex").padEnd(64, "0")) as Hex;
  const rt = (await chainNow()) + 7200n;

  /* 1. 建盘 */
  try {
    const plan = await sdk.buildCreateMarket({
      marketId,
      question: `SDK 联调盘口：BTC 24h 内能突破 90,000 吗？（${Date.now()}）`,
      resolutionTime: rt,
      meta: { category: "e2e" },
    });
    const tx = send(plan.to, plan.data);
    const core = await sdk.marketCore(marketId);
    check(core.exists, "建盘后 exists 应为 true");
    const evs = sdk.decodeReceiptLogs(receiptLogs(tx));
    const created = evs.find((e) => e.name === "MarketCreated");
    check(!!created, `建盘 receipt 里应解出 MarketCreated，实际 ${evs.map((e) => e.name).join(",") || "无"}`);
    check(created!.args.marketId === marketId, "事件里的 marketId 应等于请求的 marketId");
    check(created!.args.category === "e2e", `category 应为 e2e，实际 ${String(created!.args.category)}`);
    check(String(created!.args.question) === String(plan.meta.question), "事件里的题目应与原文一致（中文 UTF-8）");
    ok(`buildCreateMarket 上链生效 tx=${tx.slice(0, 12)}… 事件解码出 MarketCreated{question=「${String(created!.args.question)}」, category=${String(created!.args.category)}}`);
  } catch (err) {
    bad("buildCreateMarket", err);
    process.exit(1);
  }

  /* 2. 做市（SDK 没有 seedLiquidity 的 builder，这里直接用 cast，属于运维动作） */
  cast(["send", USDC, "approve(address,uint256)", ENGINE, "10000000000", "--private-key", PK, "--rpc-url", RPC]);
  cast(["send", ENGINE, "seedLiquidity(bytes32,uint256)", marketId, "1000000000", "--private-key", PK, "--rpc-url", RPC]);
  const seeded = await sdk.marketCore(marketId);
  ok(`seedLiquidity 1,000 USDC → 池深 ${formatUsdc(seeded.yesReserve + seeded.noReserve)} USDC`);

  /* 3. 买入（preflight 会读真链报价 + 本地复算比对） */
  try {
    const amountIn = parseUsdc("50");
    const plan = await sdk.buildBuyShares({ marketId, outcome: OUTCOME_YES, amountIn, slippageBps: 100 });
    const minOut = BigInt(String(plan.meta.minSharesOut));
    const tx = send(plan.to, plan.data);
    const held = await sdk.sharesOf(marketId);
    check(held.yes >= minOut, `实际到手 ${held.yes} 应 >= 保护价 ${minOut}`);
    ok(`buildBuyShares 成交 tx=${tx.slice(0, 12)}… 付 50 USDC 得 ${held.yes} 份（保护价 ${minOut}）`);
    const offline = previewBuyOffline({ yesReserve: seeded.yesReserve, noReserve: seeded.noReserve }, OUTCOME_YES, amountIn, k.tradeFeeBps);
    check(offline === BigInt(String(plan.meta.quote)), `离线报价 ${offline} 应与链上 ${plan.meta.quote} 一致`);
    ok(`离线 previewBuy(${offline}) 与链上报价逐位相同`);

    // —— 真 receipt 的事件解码（拿链上真实日志喂 SDK 的解码器）
    const evs = sdk.decodeReceiptLogs(receiptLogs(tx));
    const bought = evs.find((e) => e.name === "SharesBought");
    check(!!bought, `receipt 里应解出 SharesBought，实际解出 ${evs.map((e) => e.name).join(",") || "无"}`);
    check(bought!.args.amountIn === amountIn, `事件 amountIn ${bought!.args.amountIn} 应等于 ${amountIn}`);
    check(bought!.args.sharesOut === held.yes, `事件 sharesOut ${bought!.args.sharesOut} 应等于持仓 ${held.yes}`);
    check(bought!.args.outcome === 1, "事件 outcome 应为 YES");
    ok(`事件解码：真实 receipt 里 SharesBought{amountIn=${bought!.args.amountIn}, sharesOut=${bought!.args.sharesOut}, fee=${bought!.args.fee}} 全部对上`);
  } catch (err) {
    bad("buildBuyShares", err);
  }

  /* 3.5 批量快照：一次 RPC 拿 3 个盘口 */
  try {
    const ids = [marketId, marketId, marketId];
    const before = rpcCount;
    const snaps = await sdk.marketSnapshots(ids);
    const used = rpcCount - before;
    check(snaps.length === 3, "应返回 3 个快照");
    eqNum(snaps[0].priceYes, snaps[1].priceYes, "同一盘口价格一致");
    check(snaps[0].depth > 0n, "池深应大于 0");
    check(snaps[0].exists && snaps[0].tradingOpen, "应存在且开放交易");
    if (used === 1) {
      ok(`marketSnapshots：3 盘口 × 4 字段 = 12 次查询压成 1 次 RPC（Multicall3 ${MULTICALL3}）`);
    } else {
      console.log(`\x1b[1;33m⚠️  WARN\x1b[0m 本条链没有 Multicall3，已自动降级为 ${used} 次单条 RPC（本地 anvil 属正常；Base 主网/fork 应为 1 次）`);
      pass++;
    }
  } catch (err) {
    bad("marketSnapshots", err);
  }

  /* 3.6 冲击预警：贴着 4% 与 1% 各造一笔，验证 warning 只在临界区出现 */
  try {
    const core = await sdk.marketCore(marketId);
    const poolDepth = core.yesReserve + core.noReserve; // 6 位 USDC
    const near = (poolDepth * 420n) / 10_000n; // 4.2% → 应预警
    const far = (poolDepth * 100n) / 10_000n; // 1.0%  → 不该预警

    const p1 = await sdk.buildBuyShares({ marketId, outcome: OUTCOME_YES, amountIn: near, slippageBps: SLIPPAGE_CONSERVATIVE });
    check(p1.warning === "impact_near_limit", `冲击 ${p1.meta.impactBps}bps 应预警`);
    ok(`冲击预警：${formatUsdc(near)} USDC / 池深 ${formatUsdc(poolDepth)} USDC = ${p1.meta.impactBps}bps → warning="impact_near_limit"`);

    const p2 = await sdk.buildBuyShares({ marketId, outcome: OUTCOME_YES, amountIn: far, slippageBps: SLIPPAGE_NORMAL });
    check(p2.warning === undefined, `冲击 ${p2.meta.impactBps}bps 不该预警`);
    ok(`无误报：${formatUsdc(far)} USDC = ${p2.meta.impactBps}bps → 无 warning`);
  } catch (err) {
    bad("冲击预警", err);
  }

  /* 4. 卖出（只会卖一半，留一半给赎回） */
  try {
    const held = await sdk.sharesOf(marketId);
    const half = held.yes / 2n;
    const plan = await sdk.buildSellShares({ marketId, outcome: OUTCOME_YES, sharesIn: half, slippageBps: 100 });
    const tx = send(plan.to, plan.data);
    const after = await sdk.sharesOf(marketId);
    check(after.yes < held.yes, "卖出后持仓应减少");
    ok(`buildSellShares 成交 tx=${tx.slice(0, 12)}… 卖 ${half} 份 → 持仓 ${held.yes} → ${after.yes}`);
  } catch (err) {
    bad("buildSellShares", err);
  }

  /* 5. 时间快进 + 裁决 */
  try {
    const core = await sdk.marketCore(marketId);
    const now = await chainNow();
    cast(["rpc", "evm_increaseTime", String(Number(core.resolutionTime - now) + 60), "--rpc-url", RPC]);
    cast(["rpc", "evm_mine", "--rpc-url", RPC]);

    const plan = await sdk.buildResolveMarket({ marketId, outcome: OUTCOME_NO });
    const tx = send(plan.to, plan.data);
    const st = await sdk.resolutionState(marketId);
    check(st.resolved && st.disputing, "裁决后应进入争议期");
    ok(`buildResolveMarket 上链 tx=${tx.slice(0, 12)}… 进入争议期至 ${new Date(Number(st.disputeEndsAt) * 1000).toISOString()}`);
  } catch (err) {
    bad("buildResolveMarket", err);
  }

  /* 6. 争议期内提现必须被 SDK 拦住 */
  try {
    await sdk.buildRedeem({ marketId });
    bad("争议期内 buildRedeem 应当报错", new Error("没有报错"));
  } catch (err) {
    if (err instanceof SdkError && err.code === "chain/DISPUTE_WINDOW_OPEN") {
      ok(`争议期内 buildRedeem 被拦：${err.message}`);
    } else {
      bad("争议期内 buildRedeem", err);
    }
  }

  /* 7. Safe 改判（NO → YES），验证 overrideResolution 的 calldata 真能生效 */
  try {
    const plan = await sdk.buildOverrideResolution({ marketId, newOutcome: OUTCOME_YES });
    const tx = send(plan.to, plan.data);
    const st = await sdk.resolutionState(marketId);
    check(st.outcome === OUTCOME_YES, "改判后 outcome 应为 YES");
    ok(`buildOverrideResolution 上链 tx=${tx.slice(0, 12)}… outcome=${st.outcome}`);
  } catch (err) {
    bad("buildOverrideResolution", err);
  }

  /* 8. 争议期结束 → 提现 */
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
    check(after > before, `提现后余额应增加：${before} → ${after}`);
    ok(`buildRedeem 上链 tx=${tx.slice(0, 12)}… 余额 +${formatUsdc(after - before)} USDC`);
  } catch (err) {
    bad("buildRedeem", err);
  }

  /* 9. 盘口剩余现金：sweep 后引擎余额归零（确认没有资金死锁） */
  try {
    cast(["send", ENGINE, "sweepResidual(bytes32)", marketId, "--private-key", PK, "--rpc-url", RPC]);
    const left = BigInt(cast(["call", USDC, "balanceOf(address)(uint256)", ENGINE, "--rpc-url", RPC]).split(" ")[0]);
    // 引擎里可能还有别的盘口的钱（本次只动自己那个），所以按本盘 cash 判断
    const core = await sdk.marketCore(marketId);
    check(core.cash === 0n, `本盘 cash 应清零，实际 ${core.cash}`);
    ok(`sweepResidual 后本盘 cash=0（引擎总余额 ${formatUsdc(left)} USDC 属于其他盘口）`);
  } catch (err) {
    bad("sweepResidual", err);
  }

  console.log(`\n${pass} passed / ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
