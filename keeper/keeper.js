#!/usr/bin/env node
/**
 * Prediction Market Keeper — 无人值守守护机器人
 *
 * 职责：
 *   1. 轮询工厂下所有 Vault 盘口状态
 *   2. 到点未结算 -> 立即预警，并生成 multisig（Safe）可直接执行的结算交易提案
 *   3. 超过 7 天退款窗口 -> 可自动触发 emergencyRefund()（无需权限）
 *   4. pendingFees 超过阈值 -> 自动调用 ProtocolFeeVault.autoDistributeFee()
 *
 * 设计原则：
 *   - 结算权在 admin 多签手里，keeper 只「提醒 + 生成提案」，绝不持有 admin 权限
 *   - 只有 permissionless 的动作（autoDistributeFee / emergencyRefund）才会自己签名发交易
 *   - 重复告警去重，避免每 30 秒刷一次屏
 *
 * 用法：
 *   node keeper.js --config config.json          # 常驻
 *   node keeper.js --config config.json --once   # 跑一轮就退出（用于 cron / 测试）
 *   node keeper.js --config config.json --dry-run
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

/* ---------------------------------- ABI ---------------------------------- */

const FACTORY_ABI = [
  "function allMarkets() view returns (address[])",
  "function marketCount() view returns (uint256)",
];

const VAULT_ABI = [
  "function resolutionTime() view returns (uint256)",
  "function resolved() view returns (bool)",
  "function outcome() view returns (uint8)",
  "function tradingOpen() view returns (bool)",
  "function admin() view returns (address)",
  "function conditionId() view returns (bytes32)",
  "function refundAvailableAt() view returns (uint256)",
  "function priceYes() view returns (uint256)",
  "function depth() view returns (uint256)",
  "function resolve(uint8 outcome)",
  "function emergencyRefund()",
];

const FEE_VAULT_ABI = [
  "function pendingFees() view returns (uint256)",
  "function treasury() view returns (address)",
  "function totalDistributed() view returns (uint256)",
  "function autoDistributeFee() returns (uint256)",
];

/* -------------------------------- 工具函数 -------------------------------- */

const OUTCOME_LABEL = { 0: "NO", 1: "YES", 2: "INVALID" };

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function fmtTs(ts) {
  if (!ts) return "-";
  return new Date(Number(ts) * 1000).toISOString().replace("T", " ").slice(0, 19) + "Z";
}

function fmtUsdc(v, decimals = 6) {
  return (Number(v) / 10 ** decimals).toFixed(2);
}

function humanDuration(sec) {
  const s = Math.abs(Number(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function log(level, msg, extra) {
  const line = `[${new Date().toISOString()}] ${level.padEnd(5)} ${msg}`;
  if (extra) console.log(line, JSON.stringify(extra));
  else console.log(line);
}

/* --------------------------------- 配置 ---------------------------------- */

function loadConfig(argv) {
  const args = new Set(argv.slice(2));
  const getArg = (name) => {
    const i = argv.indexOf(name);
    return i > -1 ? argv[i + 1] : undefined;
  };

  const cfgPath = getArg("--config") || path.join(__dirname, "config.json");
  let fileCfg = {};
  if (fs.existsSync(cfgPath)) {
    fileCfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } else if (getArg("--config")) {
    throw new Error(`config not found: ${cfgPath}`);
  }

  const cfg = {
    rpcUrl: process.env.KEEPER_RPC_URL || fileCfg.rpcUrl,
    factory: process.env.KEEPER_FACTORY || fileCfg.factory,
    feeVault: process.env.KEEPER_FEE_VAULT || fileCfg.feeVault,
    privateKey: process.env.KEEPER_PRIVATE_KEY || fileCfg.privateKey || "",
    intervalMs: Number(process.env.KEEPER_INTERVAL_MS || fileCfg.intervalMs || 30_000),
    // 手续费自动分发的触发阈值（USDC 6 位）
    feeThreshold: BigInt(process.env.KEEPER_FEE_THRESHOLD || fileCfg.feeThreshold || "1000000"), // 1 USDC
    // 是否自动执行 permissionless 的 emergencyRefund
    autoRefund: process.env.KEEPER_AUTO_REFUND === "1" || fileCfg.autoRefund === true,
    // 告警 webhook（钉钉/飞书/Slack 通用 JSON POST）
    webhookUrl: process.env.KEEPER_WEBHOOK || fileCfg.webhookUrl || "",
    proposalDir: fileCfg.proposalDir || path.join(__dirname, "proposals"),
    dryRun: args.has("--dry-run"),
    once: args.has("--once"),
    maxFeePerGasGwei: fileCfg.maxFeePerGasGwei || 10,
  };

  if (!cfg.rpcUrl) throw new Error("rpcUrl missing (config or KEEPER_RPC_URL)");
  if (!cfg.factory) throw new Error("factory missing (config or KEEPER_FACTORY)");
  if (!ethers.isAddress(cfg.factory)) throw new Error(`bad factory address: ${cfg.factory}`);
  if (cfg.feeVault && !ethers.isAddress(cfg.feeVault)) throw new Error("bad feeVault address");
  return cfg;
}

/* --------------------------------- Keeper -------------------------------- */

class Keeper {
  constructor(cfg) {
    this.cfg = cfg;
    this.provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
    this.wallet = cfg.privateKey ? new ethers.Wallet(cfg.privateKey, this.provider) : null;
    this.factory = new ethers.Contract(cfg.factory, FACTORY_ABI, this.provider);
    this.feeVault = cfg.feeVault ? new ethers.Contract(cfg.feeVault, FEE_VAULT_ABI, this.provider) : null;

    this.alerted = new Set(); // 去重
    this.stats = { polls: 0, alerts: 0, refunds: 0, feeDistributions: 0, errors: 0 };
  }

  /* ------------------------------ 单轮扫描 ------------------------------ */

  async tick() {
    this.stats.polls++;
    const chainNow = await this._chainNow();
    const markets = await this.factory.allMarkets();
    log("INFO", `poll #${this.stats.polls} | markets=${markets.length} | chainTime=${fmtTs(chainNow)}`);

    const expired = [];
    const refundable = [];

    const states = await Promise.all(markets.map((addr) => this._vaultState(addr, chainNow)));

    for (const st of states) {
      if (st.resolved) {
        log("OK  ", `${st.address} resolved=${OUTCOME_LABEL[st.outcome] || st.outcome} — nothing to do`);
        continue;
      }

      if (st.now >= st.refundAvailableAt) {
        refundable.push(st);
        expired.push(st);
        log("WARN", `${st.address} 已过退款窗口 (${humanDuration(st.now - st.refundAvailableAt)} ago) 仍未结算`);
      } else if (st.now >= st.resolutionTime) {
        expired.push(st);
        log("WARN", `${st.address} 已到结算时间 ${humanDuration(st.now - st.resolutionTime)} 仍未结算`);
      } else {
        log("INFO", `${st.address} trading | resolve in ${humanDuration(st.resolutionTime - st.now)}`);
      }
    }

    for (const st of expired) await this._alertExpired(st);
    for (const st of refundable) await this._maybeRefund(st);

    await this._maybeDistributeFees();

    return { markets: markets.length, expired: expired.length, refundable: refundable.length };
  }

  async _chainNow() {
    const b = await this.provider.getBlock("latest");
    return b ? b.timestamp : nowSec();
  }

  async _vaultState(address, chainNow) {
    const v = new ethers.Contract(address, VAULT_ABI, this.provider);
    const [resolutionTime, resolved, outcome, admin, conditionId, refundAvailableAt, priceYes, depth] =
      await Promise.all([
        v.resolutionTime(),
        v.resolved(),
        v.outcome(),
        v.admin(),
        v.conditionId(),
        v.refundAvailableAt(),
        v.priceYes(),
        v.depth(),
      ]);

    return {
      address,
      resolutionTime: Number(resolutionTime),
      refundAvailableAt: Number(refundAvailableAt),
      resolved,
      outcome: Number(outcome),
      admin,
      conditionId,
      priceYes: Number(priceYes) / 1e18,
      depthUsdc: Number(depth) / 1e6,
      now: chainNow,
    };
  }

  /* ------------------------------ 到点告警 ------------------------------ */

  async _alertExpired(st) {
    const inRefundWindow = st.now >= st.refundAvailableAt;
    const key = inRefundWindow ? `${st.address}:refund` : `${st.address}:expired`;
    if (this.alerted.has(key)) return; // 已告警过，不刷屏
    this.alerted.add(key);
    this.stats.alerts++;

    // 生成 multisig 可直接执行的结算提案（admin 是多签地址）
    const vault = new ethers.Contract(st.address, VAULT_ABI, this.provider);
    const proposals = [0, 1, 2].map((o) => ({
      safe: st.admin,
      to: st.address,
      value: "0",
      operation: 0,
      data: vault.interface.encodeFunctionData("resolve", [o]),
      description: `Resolve ${st.address} (condition ${st.conditionId}) as ${OUTCOME_LABEL[o]}`,
    }));

    const urgent = inRefundWindow;
    const payload = {
      type: urgent ? "REFUND_WINDOW_OPEN" : "RESOLUTION_OVERDUE",
      vault: st.address,
      conditionId: st.conditionId,
      adminMultisig: st.admin,
      resolutionTime: fmtTs(st.resolutionTime),
      overdue: humanDuration(st.now - st.resolutionTime),
      feeRefundAvailableAt: fmtTs(st.refundAvailableAt),
      priceYes: st.priceYes.toFixed(4),
      depthUsdc: fmtUsdc(BigInt(Math.round(st.depthUsdc * 1e6))),
      action: urgent
        ? "任何人可调用 emergencyRefund()；或由多签立即 resolve()"
        : "由 admin 多签调用 resolve(uint8 outcome)",
      proposals,
    };

    this._writeProposal(st, payload);
    await this._notify(payload);

    log(urgent ? "ALERT" : "WARN", `proposal written for ${st.address}`, {
      admin: st.admin,
      overdue: payload.overdue,
    });
  }

  _writeProposal(st, payload) {
    fs.mkdirSync(this.cfg.proposalDir, { recursive: true });
    const file = path.join(this.cfg.proposalDir, `${st.address}-${payload.type}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    log("INFO", `proposal -> ${file}`);
  }

  async _notify(payload) {
    if (!this.cfg.webhookUrl) return;
    const text =
      `[PredictionKeeper] ${payload.type}\n` +
      `vault: ${payload.vault}\n` +
      `admin(multisig): ${payload.adminMultisig}\n` +
      `resolutionTime: ${payload.resolutionTime} (overdue ${payload.overdue})\n` +
      `priceYes: ${payload.priceYes} | depth: ${payload.depthUsdc} USDC\n` +
      `action: ${payload.action}`;
    try {
      const res = await fetch(this.cfg.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, ...payload }),
      });
      log(res.ok ? "INFO" : "ERROR", `webhook ${res.status}`);
    } catch (e) {
      this.stats.errors++;
      log("ERROR", `webhook failed: ${e.message}`);
    }
  }

  /* --------------------------- 超时自动退款 --------------------------- */

  async _maybeRefund(st) {
    if (!this.cfg.autoRefund) {
      log("INFO", `autoRefund disabled — skipping ${st.address}`);
      return;
    }
    if (!this.wallet) {
      log("WARN", `no privateKey — cannot auto-refund ${st.address}`);
      return;
    }
    const vault = new ethers.Contract(st.address, VAULT_ABI, this.wallet);
    try {
      const tx = await vault.emergencyRefund(await this._gasOverrides());
      log("INFO", `emergencyRefund sent ${tx.hash}`);
      const rc = await tx.wait();
      this.stats.refunds++;
      log("OK  ", `emergencyRefund confirmed in block ${rc.blockNumber}`);
    } catch (e) {
      this.stats.errors++;
      log("ERROR", `emergencyRefund failed: ${e.shortMessage || e.message}`);
    }
  }

  /* ------------------------- 手续费自动分发 ------------------------- */

  async _maybeDistributeFees() {
    if (!this.feeVault) return;

    const pending = await this.feeVault.pendingFees();
    if (pending < this.cfg.feeThreshold) {
      log("INFO", `feeVault pending=${fmtUsdc(pending)} USDC (below threshold ${fmtUsdc(this.cfg.feeThreshold)})`);
      return;
    }

    log("INFO", `feeVault pending=${fmtUsdc(pending)} USDC — distributing`);
    if (this.cfg.dryRun || !this.wallet) {
      log("DRY ", this.wallet ? "dryRun enabled" : "no privateKey", { wouldDistribute: pending.toString() });
      return;
    }

    try {
      const connected = this.feeVault.connect(this.wallet);
      const tx = await connected.autoDistributeFee(await this._gasOverrides());
      const rc = await tx.wait();
      this.stats.feeDistributions++;
      const treasury = await this.feeVault.treasury();
      log("OK  ", `autoDistributeFee confirmed block=${rc.blockNumber} -> ${treasury} (${fmtUsdc(pending)} USDC)`);
    } catch (e) {
      this.stats.errors++;
      log("ERROR", `autoDistributeFee failed: ${e.shortMessage || e.message}`);
    }
  }

  /**
   * Gas 策略：用网络建议价，但绝不超过上限。
   * 超过上限时直接放弃这一轮（宁可晚一点分账，也不要在高费时被打爆）。
   */
  async _gasOverrides() {
    const fee = await this.provider.getFeeData();
    const cap = ethers.parseUnits(String(this.cfg.maxFeePerGasGwei), "gwei");
    const suggested = fee.maxFeePerGas ?? fee.gasPrice ?? cap;
    if (suggested > cap) {
      throw new Error(`network gas ${ethers.formatUnits(suggested, "gwei")} gwei > cap ${this.cfg.maxFeePerGasGwei} gwei`);
    }
    return {
      maxFeePerGas: suggested,
      maxPriorityFeePerGas: suggested / 10n > 0n ? suggested / 10n : 1n,
    };
  }

  /* -------------------------------- 主循环 -------------------------------- */

  async run() {
    log("INFO", "=== Prediction Keeper started ===");
    log("INFO", `rpc=${this.cfg.rpcUrl}`);
    log("INFO", `factory=${this.cfg.factory}`);
    log("INFO", `feeVault=${this.cfg.feeVault || "(disabled)"}`);
    log("INFO", `signer=${this.wallet ? this.wallet.address : "(read-only)"} dryRun=${this.cfg.dryRun}`);

    const loop = async () => {
      try {
        await this.tick();
      } catch (e) {
        this.stats.errors++;
        log("ERROR", `tick failed: ${e.shortMessage || e.message}`);
      }
    };

    await loop();
    if (this.cfg.once) {
      log("INFO", "=== single run finished ===", this.stats);
      return;
    }

    setInterval(loop, this.cfg.intervalMs);

    for (const sig of ["SIGINT", "SIGTERM"]) {
      process.on(sig, () => {
        log("INFO", `received ${sig}, shutting down`, this.stats);
        process.exit(0);
      });
    }
  }
}

/* --------------------------------- 入口 ---------------------------------- */

async function main() {
  let cfg;
  try {
    cfg = loadConfig(process.argv);
  } catch (e) {
    console.error(`config error: ${e.message}`);
    console.error("see config.example.json, or pass --config <file>");
    process.exit(2);
  }

  const keeper = new Keeper(cfg);
  await keeper.run();
}

if (require.main === module) {
  main().catch((e) => {
    console.error("fatal:", e);
    process.exit(1);
  });
}

module.exports = { Keeper, loadConfig };
