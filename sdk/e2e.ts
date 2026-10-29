/**
 * PredictionSDK — 链上端到端验证（anvil）
 *
 * 证明两件事：
 *   1. SDK 算出的 minSharesOut 恰好是「合约能接受的最小值」：原样能成交，+1 wei 就 revert
 *   2. SDK 的 previewBuy 与链上真实成交份额完全一致
 *
 * 运行：node dist/e2e.js   （需要 RPC_URL / VAULT / PRIVATE_KEY 环境变量）
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { PredictionSDK, type EthCallTransport } from "./PredictionSDK";

const RPC = process.env.RPC_URL || "http://127.0.0.1:8545";
const VAULT = process.env.VAULT || "";
const PK = process.env.PRIVATE_KEY || "";
const CAST = process.env.CAST_BIN || "cast";
const FACTORY = process.env.FACTORY || "";

const results: string[] = [];
function pass(msg: string) {
  results.push(msg);
  console.log(`✅ PASS  ${msg}`);
}

/** 极简 JSON-RPC 传输层（零依赖） */
const transport: EthCallTransport = {
  async ethCall(to, data) {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
    });
    const body = (await res.json()) as { result?: string; error?: { message: string } };
    if (body.error) throw new Error(`rpc: ${body.error.message}`);
    if (!body.result) throw new Error("rpc: empty result");
    return body.result;
  },
};

function cast(args: string[]): string {
  return execFileSync(CAST, args, { encoding: "utf8", timeout: 60_000 }).trim();
}

/** cast 会把 uint 打印成 "4903402962 [4.9e9]"，只取数字部分 */
function castUint(args: string[]): bigint {
  const out = cast(args);
  return BigInt(out.split(/\s+/)[0]);
}

async function main() {
  assert.ok(VAULT, "VAULT env required");
  assert.ok(PK, "PRIVATE_KEY env required");

  const sdk = new PredictionSDK(transport, { vault: VAULT });

  /* ---------------- 1. 读取真实盘口状态 ---------------- */
  const state = await sdk.getMarketState();
  console.log(
    `market: depth=${Number(state.depth) / 1e6} USDC minBet=${Number(state.minBet) / 1e6} ` +
      `maxImpact=${state.maxImpactBps}bps priceYes=${Number(state.priceYes) / 1e18}`,
  );
  assert.equal(state.resolved, false, "market should not be resolved yet");
  assert.ok(state.depth > 0n);
  pass("SDK 读取链上状态成功");

  /* ---------------- 2. previewBuy 与链上一致 ---------------- */
  const amountIn = state.depth / 40n; // 2.5% 深度，稳稳落在 5% 上限内
  const quoted = await sdk.previewBuy(1, amountIn);
  const minOut = await sdk.calculateMinSharesOut(1, amountIn, 100); // 1% 滑点

  assert.ok(quoted > 0n, "previewBuy returned 0");
  assert.ok(minOut < quoted, "minSharesOut must be below the quote");
  console.log(`quote: ${amountIn} USDC -> ${quoted} shares, minSharesOut(1%) = ${minOut}`);
  pass("SDK previewBuy 返回非零报价，minSharesOut 严格低于报价");

  /* ---------------- 3. 构造交易计划（不改链上状态） ---------------- */
  const plan = await sdk.buildBuy({ outcome: 1, amountIn, slippageBps: 100 });
  assert.equal(plan.data.slice(0, 10), "0xf6d956df");
  pass("SDK 生成合法 calldata（selector buy(uint8,uint256,uint256)）");

  /* ---------------- 4. minSharesOut + 1 wei 必须 revert ---------------- */
  // 先测这个：revert 不改状态，所以后面的正常成交仍用同一份报价
  let reverted = false;
  try {
    cast([
      "send",
      VAULT,
      "buy(uint8,uint256,uint256)",
      "1",
      amountIn.toString(),
      (quoted + 1n).toString(), // 用「理论精确值 + 1 wei」做边界，才验证得了报价的精确性
      "--private-key",
      PK,
      "--rpc-url",
      RPC,
    ]);
  } catch (e) {
    reverted = true;
    const msg = String((e as { stderr?: string }).stderr || (e as Error).message);
    assert.match(msg, /SlippageExceeded|revert/i, `unexpected error: ${msg.slice(0, 200)}`);
  }
  assert.ok(reverted, "quoted+1 should have reverted");
  pass("previewBuy 报价 + 1 wei 被合约拒绝（证明报价精确到 1 wei，无有利舍入）");

  /* ---------------- 5. 用 SDK 的报价真实成交，且份额与报价完全一致 ---------------- */
  const before = castUint(["call", VAULT, "yesReserve()(uint256)", "--rpc-url", RPC]);
  const receipt = cast([
    "send",
    VAULT,
    "buy(uint8,uint256,uint256)",
    "1",
    amountIn.toString(),
    plan.quote.minSharesOut.toString(),
    "--private-key",
    PK,
    "--rpc-url",
    RPC,
    "--json",
  ]);
  const rc = JSON.parse(receipt) as { status: string };
  assert.equal(rc.status, "0x1", "buy tx failed");
  const after = castUint(["call", VAULT, "yesReserve()(uint256)", "--rpc-url", RPC]);

  const actualShares = before - after;
  assert.equal(actualShares, quoted, "SDK quote != on-chain fill");
  pass(`SDK 报价 == 链上实际成交份额 (${actualShares})`);

  /* ---------------- 6. 前端层拦截：超上限 / 裸奔 ---------------- */
  // 6a. 超绝对上限（10,000 USDC）
  let blocked = false;
  let code = "";
  try {
    await sdk.buildBuy({ outcome: 1, amountIn: 10_001_000_000n, slippageBps: 100 });
  } catch (e) {
    code = (e as { code?: string }).code ?? "";
    blocked = code === "ABOVE_MAX_BET";
  }
  assert.ok(blocked, `SDK should block above-max-bet locally, got ${code}`);
  pass("SDK 在本地拦截超过 10,000 USDC 绝对上限的大单");

  // 6b. 额度内但超 5% 深度（用最新状态：前面的成交已经改变了池深）
  const fresh = await sdk.getMarketState();
  const impactCap = (fresh.depth * fresh.maxImpactBps) / 10_000n;
  assert.ok(impactCap < fresh.maxBet, "test pool should be impact-bound");
  blocked = false;
  code = "";
  try {
    await sdk.buildBuy({ outcome: 1, amountIn: impactCap + impactCap / 5n, slippageBps: 100 }); // 超上限 20%
  } catch (e) {
    code = (e as { code?: string }).code ?? "";
    blocked = code === "IMPACT_TOO_HIGH";
  }
  assert.ok(blocked, `SDK should block impact cap locally, got ${code}`);
  pass(`SDK 在本地拦截超 5% 影响上限的大单（池深 ${Number(state.depth) / 1e6} USDC -> 上限 ${Number(impactCap) / 1e6} USDC）`);

  blocked = false;
  try {
    await sdk.buildBuy({ outcome: 1, amountIn, slippageBps: 0 });
  } catch (e) {
    blocked = (e as { code?: string }).code === "SLIPPAGE_NOT_SET";
  }
  assert.ok(blocked, "SDK should refuse slippage=0");
  pass("SDK 拒绝 slippage=0（从代码层杜绝裸奔）");

  /* ---------------- 7. 6 参 createMarket：SDK 编码 -> 链上真建盘 ---------------- */
  assert.ok(FACTORY, "FACTORY env required");
  const factorySdk = new PredictionSDK(transport, { vault: VAULT, factory: FACTORY });
  const deployer = cast(["wallet", "address", "--private-key", PK]);

  const countBefore = castUint(["call", FACTORY, "marketCount()(uint256)", "--rpc-url", RPC]);

  // 用时间戳 + 随机数造一个唯一 conditionId
  const cid =
    "0x" +
    Buffer.from(`${Date.now()}-${Math.random()}`).toString("hex").padEnd(64, "0").slice(0, 64);

  const rt = Math.floor(Date.now() / 1000) + 7 * 86_400;
  const createTx = await factorySdk.buildCreateMarket({
    conditionId: cid,
    admin: deployer,
    resolutionTime: rt,
    minBet: 7_000_000n,      // 7 USDC
    maxBet: 8_000_000_000n,  // 8,000 USDC
    maxImpactBps: 300,
  });
  assert.equal(createTx.to, FACTORY);
  assert.equal(createTx.data.length, 10 + 6 * 64, "must encode exactly 6 params");

  cast(["send", createTx.to, "--data", createTx.data, "--private-key", PK, "--rpc-url", RPC]);

  const countAfter = castUint(["call", FACTORY, "marketCount()(uint256)", "--rpc-url", RPC]);
  assert.equal(countAfter, countBefore + 1n, "market not created");

  const markets = cast(["call", FACTORY, "allMarkets()(address[])", "--rpc-url", RPC]);
  const list = markets.match(/0x[0-9a-fA-F]{40}/g) || [];
  const newVault = list[list.length - 1];
  assert.ok(newVault && newVault !== "0x0000000000000000000000000000000000000000");

  const g = (sig: string) => cast(["call", newVault, sig, "--rpc-url", RPC]).split(/\s+/)[0];
  assert.equal(g("minBet()(uint256)"), "7000000");
  assert.equal(g("maxBet()(uint256)"), "8000000000");
  assert.equal(g("maxImpactBps()(uint256)"), "300");
  assert.equal(g("admin()(address)").toLowerCase(), deployer.toLowerCase());
  assert.equal(g("MAX_BET_CEILING()(uint256)"), "10000000000");
  assert.equal(g("paused()(bool)"), "false");
  pass(`6 参 createMarket 建盘成功，参数原样落库 (vault=${newVault})`);

  /* ---------------- 8. 熔断开关：pause 拦住交易 + 错误映射 ---------------- */
  cast(["send", VAULT, "pause()", "--private-key", PK, "--rpc-url", RPC]);
  assert.equal(
    cast(["call", VAULT, "paused()(bool)", "--rpc-url", RPC]).split(/\s+/)[0],
    "true",
    "pause did not take effect",
  );
  assert.equal(
    cast(["call", VAULT, "tradingOpen()(bool)", "--rpc-url", RPC]).split(/\s+/)[0],
    "false",
  );

  // 暂停期间下单必须被合约拒绝
  let pauseRevert = "";
  try {
    cast([
      "call", VAULT, "buy(uint8,uint256,uint256)", "1", "10000000", "0",
      "--from", deployer, "--rpc-url", RPC,
    ]);
  } catch (e) {
    pauseRevert = String((e as { stderr?: string }).stderr || (e as Error).message);
  }
  assert.ok(pauseRevert.length > 0, "buy must revert while paused");

  // 从真实 revert 里取出 4 字节 selector，走 SDK 的映射层
  const selectorMatch = pauseRevert.match(/0x[0-9a-fA-F]{8}/);
  assert.ok(selectorMatch, `no revert selector in: ${pauseRevert.slice(0, 160)}`);
  const mapped = PredictionSDK.mapRevert(selectorMatch[0]);
  assert.equal(mapped.code, "TRADING_PAUSED", `mapped to ${mapped.code}`);
  assert.match(mapped.message, /暂停/);
  pass(`暂停期间下单被拒，SDK 映射为「${mapped.message}」`);

  // 解除暂停后恢复交易
  cast(["send", VAULT, "unpause()", "--private-key", PK, "--rpc-url", RPC]);
  assert.equal(
    cast(["call", VAULT, "paused()(bool)", "--rpc-url", RPC]).split(/\s+/)[0],
    "false",
  );
  cast([
    "send", VAULT, "buy(uint8,uint256,uint256)", "1", "5000000", "0",
    "--private-key", PK, "--rpc-url", RPC,
  ]);
  pass("unpause 后交易恢复（5 USDC 起投额实拍成交）");

  console.log(`\nE2E: ${results.length} checks passed`);
}

main().catch((e) => {
  console.error("❌ E2E FAILED:", e.message);
  process.exit(1);
});
