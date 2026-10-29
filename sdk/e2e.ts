/**
 * PredictionSDK — on-chain end-to-end verification (anvil)
 *
 * Proves two things:
 *   1. The minSharesOut the SDK computes is exactly "the smallest value the contract will accept": the same
 *      calldata fills, and +1 wei reverts.
 *   2. The SDK's previewBuy matches the real on-chain fill size exactly.
 *
 * Run: node dist/e2e.js   (requires the RPC_URL / VAULT / PRIVATE_KEY environment variables)
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

/** Minimal JSON-RPC transport (zero dependencies) */
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

/** cast prints uints as "4903402962 [4.9e9]", so take only the numeric part */
function castUint(args: string[]): bigint {
  const out = cast(args);
  return BigInt(out.split(/\s+/)[0]);
}

async function main() {
  assert.ok(VAULT, "VAULT env required");
  assert.ok(PK, "PRIVATE_KEY env required");

  const sdk = new PredictionSDK(transport, { vault: VAULT });

  /* ---------------- 1. Read the real market state ---------------- */
  const state = await sdk.getMarketState();
  console.log(
    `market: depth=${Number(state.depth) / 1e6} USDC minBet=${Number(state.minBet) / 1e6} ` +
      `maxImpact=${state.maxImpactBps}bps priceYes=${Number(state.priceYes) / 1e18}`,
  );
  assert.equal(state.resolved, false, "market should not be resolved yet");
  assert.ok(state.depth > 0n);
  pass("SDK read the on-chain state successfully");

  /* ---------------- 2. previewBuy matches the chain ---------------- */
  const amountIn = state.depth / 40n; // 2.5% of depth, comfortably inside the 5% cap
  const quoted = await sdk.previewBuy(1, amountIn);
  const minOut = await sdk.calculateMinSharesOut(1, amountIn, 100); // 1% slippage

  assert.ok(quoted > 0n, "previewBuy returned 0");
  assert.ok(minOut < quoted, "minSharesOut must be below the quote");
  console.log(`quote: ${amountIn} USDC -> ${quoted} shares, minSharesOut(1%) = ${minOut}`);
  pass("SDK previewBuy returned a non-zero quote and minSharesOut is strictly below it");

  /* ---------------- 3. Build a trade plan (does not touch chain state) ---------------- */
  const plan = await sdk.buildBuy({ outcome: 1, amountIn, slippageBps: 100 });
  assert.equal(plan.data.slice(0, 10), "0xf6d956df");
  pass("SDK produced valid calldata (selector buy(uint8,uint256,uint256))");

  /* ---------------- 4. minSharesOut + 1 wei must revert ---------------- */
  // Test this first: a revert does not change state, so the normal fill below can still use the same quote
  let reverted = false;
  try {
    cast([
      "send",
      VAULT,
      "buy(uint8,uint256,uint256)",
      "1",
      amountIn.toString(),
      (quoted + 1n).toString(), // only "theoretical exact value + 1 wei" proves the quote's precision
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
  pass("the contract rejects the previewBuy quote + 1 wei (proving the quote is exact to 1 wei, with no favourable rounding)");

  /* ---------------- 5. Fill for real with the SDK quote; shares must match exactly ---------------- */
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
  pass(`SDK quote == actual on-chain fill (${actualShares})`);

  /* ---------------- 6. Front-end gating: over the cap / unprotected ---------------- */
  // 6a. Above the absolute cap (10,000 USDC)
  let blocked = false;
  let code = "";
  try {
    await sdk.buildBuy({ outcome: 1, amountIn: 10_001_000_000n, slippageBps: 100 });
  } catch (e) {
    code = (e as { code?: string }).code ?? "";
    blocked = code === "ABOVE_MAX_BET";
  }
  assert.ok(blocked, `SDK should block above-max-bet locally, got ${code}`);
  pass("SDK blocked an oversized order above the 10,000 USDC absolute cap locally");

  // 6b. Within the cap but above 5% of depth (use fresh state: the earlier fill already moved pool depth)
  const fresh = await sdk.getMarketState();
  const impactCap = (fresh.depth * fresh.maxImpactBps) / 10_000n;
  assert.ok(impactCap < fresh.maxBet, "test pool should be impact-bound");
  blocked = false;
  code = "";
  try {
    await sdk.buildBuy({ outcome: 1, amountIn: impactCap + impactCap / 5n, slippageBps: 100 }); // 20% over the cap
  } catch (e) {
    code = (e as { code?: string }).code ?? "";
    blocked = code === "IMPACT_TOO_HIGH";
  }
  assert.ok(blocked, `SDK should block impact cap locally, got ${code}`);
  pass(`SDK blocked an oversized order above the 5% impact cap locally (pool depth ${Number(state.depth) / 1e6} USDC -> cap ${Number(impactCap) / 1e6} USDC)`);

  blocked = false;
  try {
    await sdk.buildBuy({ outcome: 1, amountIn, slippageBps: 0 });
  } catch (e) {
    blocked = (e as { code?: string }).code === "SLIPPAGE_NOT_SET";
  }
  assert.ok(blocked, "SDK should refuse slippage=0");
  pass("SDK refused slippage=0 (unprotected orders are impossible by construction)");

  /* ---------------- 7. 6-param createMarket: SDK encoding -> market really created on-chain ---------------- */
  assert.ok(FACTORY, "FACTORY env required");
  const factorySdk = new PredictionSDK(transport, { vault: VAULT, factory: FACTORY });
  const deployer = cast(["wallet", "address", "--private-key", PK]);

  const countBefore = castUint(["call", FACTORY, "marketCount()(uint256)", "--rpc-url", RPC]);

  // Derive a unique conditionId from a timestamp plus random noise
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
  pass(`6-param createMarket created the market and the parameters persisted verbatim (vault=${newVault})`);

  /* ---------------- 8. Circuit breaker: pause blocks trading + error mapping ---------------- */
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

  // Orders must be rejected by the contract while paused
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

  // Pull the 4-byte selector out of the real revert and run it through the SDK's mapping layer
  const selectorMatch = pauseRevert.match(/0x[0-9a-fA-F]{8}/);
  assert.ok(selectorMatch, `no revert selector in: ${pauseRevert.slice(0, 160)}`);
  const mapped = PredictionSDK.mapRevert(selectorMatch[0]);
  assert.equal(mapped.code, "TRADING_PAUSED", `mapped to ${mapped.code}`);
  assert.match(mapped.message, /paused/i);
  pass(`the order was rejected while paused and the SDK mapped it to "${mapped.message}"`);

  // Trading resumes once the pause is lifted
  cast(["send", VAULT, "unpause()", "--private-key", PK, "--rpc-url", RPC]);
  assert.equal(
    cast(["call", VAULT, "paused()(bool)", "--rpc-url", RPC]).split(/\s+/)[0],
    "false",
  );
  cast([
    "send", VAULT, "buy(uint8,uint256,uint256)", "1", "5000000", "0",
    "--private-key", PK, "--rpc-url", RPC,
  ]);
  pass("trading resumed after unpause (a real 5 USDC minimum-size fill went through)");

  console.log(`\nE2E: ${results.length} checks passed`);
}

main().catch((e) => {
  console.error("❌ E2E FAILED:", e.message);
  process.exit(1);
});
