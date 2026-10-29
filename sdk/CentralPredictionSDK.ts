/**
 * CentralPredictionSDK — 单合约多盘口引擎（CentralPredictionEngine）的前端安全封装
 *
 * 设计目标（与旧 PredictionSDK 的三条铁律一致，但换成新 ABI）：
 *   1. 任何写方法都**不返回裸 calldata**：先跑本地 preflight，链上状态/参数不对就在本地抛错，不浪费 gas。
 *   2. `minSharesOut` / `minAmountOut` 不许裸奔：传 0 直接拒；传得比报价还高直接拒；
 *      传得比「报价 × (1 - 5%)」还松也直接拒（防止前端随手写 1）。
 *   3. 零依赖：只要求调用方注入 `ethCall(to, data)`，可对接 viem / ethers / wagmi / 自建节点。
 *      所有 calldata 由本文件手工编码，测试里用 `cast`（Solidity 自己的编码器）逐字节对齐。
 *
 * 用法：
 *   const sdk = new CentralPredictionSDK(
 *     { ethCall: (to, data) => provider.call({ to, data }) },
 *     { engine: "0x...", chainId: 8453, account: "0x..." },
 *   );
 *   const plan = await sdk.buildBuyShares({ marketId, outcome: 1, amountIn: 100_000_000n, slippageBps: 100 });
 *   await wallet.sendTransaction({ to: plan.to, data: plan.data });
 *
 * 合约侧对应关系（docs/CENTRAL-SDK-GUIDE.md 有完整表）：
 *   createMarket(bytes32,string,uint256)                        ← buildCreateMarket（无分类）
 *   createMarketWithMeta(bytes32,string,string,uint256)          ← buildCreateMarket（带 meta.category）
 *   buyShares(bytes32,uint8,uint256,uint256)                     ← buildBuyShares
 *   sellShares(bytes32,uint8,uint256,uint256)                    ← buildSellShares
 *   redeem(bytes32)                                              ← buildRedeem
 *   resolveMarket(bytes32,uint8)                                 ← buildResolveMarket
 *   overrideResolution(bytes32,uint8)                            ← buildOverrideResolution
 */

/* ============================== 类型 ============================== */

export type Address = string;
export type Hex = string;

/** 调用方注入的最小读取接口（只读，不会发交易） */
export interface Transport {
  /** eth_call；失败时抛出的错误里可能带 revert data（下面 decodeRevert 会吃掉） */
  ethCall(to: Address, data: Hex): Promise<Hex>;
  /**
   * 可选：链上最新区块时间（秒）。合约里所有时间比较都用 block.timestamp，
   * 测试链快进或节点时钟漂移时，本地墙钟会判断错。不提供就退回系统时间。
   */
  now?: () => Promise<number | bigint>;
}

export interface SDKConfig {
  /** CentralPredictionEngine 地址 */
  engine: Address;
  /** 期望的 chainId（可选；给了就校验，防连错链） */
  chainId?: number;
  /** 当前用户地址（可选；给了就做角色/持仓预检） */
  account?: Address;
}

/** 本地算出来的交易计划（可直接丢给 wallet.sendTransaction） */
export interface TxPlan {
  to: Address;
  data: Hex;
  value: "0x0";
  /** 这次调用的方法名，便于埋点与日志 */
  method: string;
  /** 人类可读摘要（中文），可直接显示在确认弹窗 */
  summary: string;
  /** 关键参数快照，便于审计与回放 */
  meta: Record<string, string | number | bigint | boolean>;
  /**
   * 风险预警（不阻断交易）：
   *   impact_near_limit —— 本笔金额造成的价格冲击已达到 5% 硬上限的 80%（4%），
   *   再大一点就会被合约 revert，前端应提示用户「减小金额或分批」。
   */
  warning?: "impact_near_limit";
}

export type Outcome = 0 | 1 | 2;

export const OUTCOME_NO: Outcome = 0;
export const OUTCOME_YES: Outcome = 1;
export const OUTCOME_INVALID: Outcome = 2;

/** 滑点容差硬边界：1 bps ~ 500 bps（500 = 5%，与合约的 MAX_IMPACT_BPS_CAP 对齐） */
export const MIN_SLIPPAGE_BPS = 1n;
export const MAX_SLIPPAGE_BPS = 500n;

/** 滑点档位预设（直接传给 buildBuyShares/buildSellShares 的 slippageBps） */
export const SLIPPAGE_CONSERVATIVE = 50n; // 0.5% —— 大额/流动性薄，宁可失败也别被吃
export const SLIPPAGE_NORMAL = 100n; // 1%   —— 默认推荐
export const SLIPPAGE_DEGEN = 300n; // 3%   —— 抢热点盘口，接受较大滑点

/** 合约的价格影响硬上限（池深的 5%） */
export const MAX_IMPACT_BPS = 500n;
/** 冲击达到上限 80%（4%）就预警，而不是等到 revert */
export const IMPACT_WARN_BPS = 400n;

/* ============================== 错误体系 ============================== */

/**
 * 双层错误码：
 *   - `local/*`  ：preflight 在本地拦下来的（没花 gas）
 *   - `chain/*`  ：链上 revert，带 4 字节 selector
 * 每个错误都自带中文文案，前端可以直接 `err.message` 展示。
 */
export type SdkErrorCode =
  // —— 本地预检 ——
  | "local/TRANSPORT_ERROR"
  | "local/NOT_CONNECTED"
  | "local/CHAIN_MISMATCH"
  | "local/BAD_ADDRESS"
  | "local/BAD_BYTES32"
  | "local/BAD_OUTCOME"
  | "local/BAD_AMOUNT"
  | "local/SLIPPAGE_OUT_OF_RANGE"
  | "local/MIN_OUT_REQUIRED"
  | "local/MIN_OUT_ABOVE_QUOTE"
  | "local/SLIPPAGE_TOO_LOOSE"
  | "local/QUESTION_LENGTH"
  | "local/CATEGORY_LENGTH"
  | "local/RESOLUTION_TIME_RANGE"
  | "local/MARKET_NOT_FOUND"
  | "local/MARKET_EXISTS"
  | "local/MARKET_RESOLVED"
  | "local/MARKET_NOT_RESOLVED"
  | "local/TRADING_CLOSED"
  | "local/MARKET_PAUSED"
  | "local/QUOTE_MISMATCH"
  | "local/INSUFFICIENT_SHARES"
  | "local/ACCOUNT_REQUIRED"
  | "local/NOT_CREATOR"
  | "local/NOT_ORACLE"
  | "local/NOT_ADMIN"
  | "local/ALREADY_FINAL"
  | "local/NOT_DISPUTING"
  | "local/SAME_OUTCOME"
  // —— 链上 revert ——
  | "chain/UNKNOWN"
  | "chain/REVERT_STRING"
  | "chain/BELOW_MIN_BET"
  | "chain/ABOVE_MAX_BET"
  | "chain/IMPACT_TOO_HIGH"
  | "chain/DISPUTE_WINDOW_OPEN"
  | "chain/DISPUTE_WINDOW_CLOSED"
  | "chain/NOT_AUTHORIZED_ROLE"
  | "chain/MARKET_NOT_FOUND"
  | "chain/MARKET_EXISTS"
  | "chain/MARKET_RESOLVED"
  | "chain/NOT_RESOLVED"
  | "chain/INVALID_OUTCOME"
  | "chain/INVALID_QUESTION"
  | "chain/INVALID_RESOLUTION_TIME"
  | "chain/TRADING_CLOSED"
  | "chain/ENFORCED_PAUSE"
  | "chain/TOO_EARLY_TO_RESOLVE"
  | "chain/REFUND_WINDOW_NOT_REACHED"
  | "chain/NOTHING_TO_REDEEM"
  | "chain/NOTHING_TO_SWEEP"
  | "chain/BELOW_MIN_SEED"
  | "chain/ZERO_SHARES"
  | "chain/SLIPPAGE_EXCEEDED"
  | "chain/INSUFFICIENT_LIQUIDITY"
  | "chain/SAME_OUTCOME"
  | "chain/ZERO_ADDRESS"
  | "chain/NOT_CONTRACT"
  | "chain/SAFE_ERC20"
  | "chain/PANIC"
  | "chain/REENTRANCY";

export class SdkError extends Error {
  public readonly code: SdkErrorCode;
  /** 链上 revert 的 4 字节 selector（本地拦截时为 undefined） */
  public readonly selector?: Hex;
  /** 是否来自链上（用来区分"预检拦截"和"钱包被 revert"） */
  public readonly onchain: boolean;
  /** 原始 append 数据，排查用 */
  public readonly raw?: string;

  constructor(code: SdkErrorCode, message: string, opts: { selector?: Hex; raw?: string } = {}) {
    super(message);
    this.name = "SdkError";
    this.code = code;
    this.selector = opts.selector;
    this.onchain = code.startsWith("chain/");
    this.raw = opts.raw;
  }
}

const ZH: Record<SdkErrorCode, string> = {
  "local/TRANSPORT_ERROR": "读取链上状态失败，请检查 RPC 连接后重试",
  "local/NOT_CONNECTED": "SDK 未配置 engine 地址",
  "local/CHAIN_MISMATCH": "当前钱包网络与合约所在网络不一致，请切换网络",
  "local/BAD_ADDRESS": "地址格式不正确",
  "local/BAD_BYTES32": "marketId 必须是 32 字节十六进制（0x + 64 位）",
  "local/BAD_OUTCOME": "结果只能是 0(NO) / 1(YES) / 2(INVALID)",
  "local/BAD_AMOUNT": "金额必须是大于 0 的整数（USDC 6 位小数）",
  "local/SLIPPAGE_OUT_OF_RANGE": "滑点容差必须在 1~500 bps（0.01%~5%）之间",
  "local/MIN_OUT_REQUIRED": "minSharesOut/minAmountOut 不能为 0 —— 不设保护会被夹子按任意价格成交",
  "local/MIN_OUT_ABOVE_QUOTE": "minSharesOut 高于当前报价，这笔交易必然失败（价格已被别人推动？）",
  "local/SLIPPAGE_TOO_LOOSE": "滑点容差过松（超过 5%），等同于没有保护",
  "local/QUESTION_LENGTH": "题目长度必须是 8~280 字节（UTF-8）",
  "local/CATEGORY_LENGTH": "分类长度必须是 1~32 字节",
  "local/RESOLUTION_TIME_RANGE": "结算时间必须在「现在 + 1 小时」到「现在 + 365 天」之间",
  "local/MARKET_NOT_FOUND": "盘口不存在",
  "local/MARKET_EXISTS": "该盘口 ID 已存在，不能重复创建",
  "local/MARKET_RESOLVED": "盘口已结算，不能再交易",
  "local/MARKET_NOT_RESOLVED": "盘口尚未结算",
  "local/TRADING_CLOSED": "已过结算时间，交易关闭",
  "local/MARKET_PAUSED": "协议已暂停交易，请稍后再试",
  "local/QUOTE_MISMATCH": "本地报价与链上 preview 不一致（ABI 或版本不匹配），已中止",
  "local/INSUFFICIENT_SHARES": "持仓份额不足",
  "local/ACCOUNT_REQUIRED": "该操作需要知道当前用户地址（构造 SDK 时传 account）",
  "local/NOT_CREATOR": "当前地址没有建盘权限",
  "local/NOT_ORACLE": "当前地址没有裁决权限",
  "local/NOT_ADMIN": "只有 admin（Safe 多签）可以执行该操作",
  "local/ALREADY_FINAL": "裁决已过争议期并终结，不能再改判",
  "local/NOT_DISPUTING": "当前不在争议期内，不能改判",
  "local/SAME_OUTCOME": "新结果与当前结果相同",
  "chain/UNKNOWN": "交易被链上拒绝（未知错误）",
  "chain/REVERT_STRING": "交易被链上拒绝",
  "chain/BELOW_MIN_BET": "低于最低下注额（5 USDC）",
  "chain/ABOVE_MAX_BET": "高于单笔上限（10,000 USDC）",
  "chain/IMPACT_TOO_HIGH": "这笔下单对价格冲击过大（超过池子 5%），请减小金额或分批",
  "chain/DISPUTE_WINDOW_OPEN": "该盘口正处于 1 小时裁决争议期，暂不能提现",
  "chain/DISPUTE_WINDOW_CLOSED": "争议期已结束，结果已不可更改",
  "chain/NOT_AUTHORIZED_ROLE": "当前地址没有执行该操作的权限",
  "chain/MARKET_NOT_FOUND": "盘口不存在",
  "chain/MARKET_EXISTS": "盘口已存在",
  "chain/MARKET_RESOLVED": "盘口已结算",
  "chain/NOT_RESOLVED": "盘口尚未结算",
  "chain/INVALID_OUTCOME": "结果值非法",
  "chain/INVALID_QUESTION": "题目或分类不合法",
  "chain/INVALID_RESOLUTION_TIME": "结算时间不合法",
  "chain/TRADING_CLOSED": "交易已关闭",
  "chain/ENFORCED_PAUSE": "协议已暂停",
  "chain/TOO_EARLY_TO_RESOLVE": "还没到结算时间，不能裁定",
  "chain/REFUND_WINDOW_NOT_REACHED": "还没到 7 天退款窗口",
  "chain/NOTHING_TO_REDEEM": "没有可提取的份额",
  "chain/NOTHING_TO_SWEEP": "没有可扫走的残余",
  "chain/BELOW_MIN_SEED": "做市种子低于下限（10 USDC）",
  "chain/ZERO_SHARES": "份额计算结果为 0（金额太小）",
  "chain/SLIPPAGE_EXCEEDED": "成交价超出滑点保护范围，已回滚",
  "chain/INSUFFICIENT_LIQUIDITY": "流动性或余额不足",
  "chain/SAME_OUTCOME": "新结果与当前结果相同",
  "chain/ZERO_ADDRESS": "地址不能为 0",
  "chain/NOT_CONTRACT": "目标地址不是合约",
  "chain/SAFE_ERC20": "USDC 转账失败（余额或授权不足）",
  "chain/PANIC": "合约内部算术/断言失败",
  "chain/REENTRANCY": "重入保护触发",
};

/** 合约自定义错误 selector → (错误码, 是否"权限类") */
export const ERROR_SELECTORS: Record<string, { code: SdkErrorCode; name: string }> = {
  "0x5688ffb3": { code: "chain/BELOW_MIN_BET", name: "BelowMinBet" },
  "0xb8ab88d4": { code: "chain/ABOVE_MAX_BET", name: "AboveMaxBet" },
  "0x22410594": { code: "chain/IMPACT_TOO_HIGH", name: "ImpactTooHigh" },
  "0x87920b43": { code: "chain/DISPUTE_WINDOW_OPEN", name: "DisputeWindowOpen" },
  "0x435a3cfe": { code: "chain/DISPUTE_WINDOW_CLOSED", name: "DisputeWindowClosed" },
  "0x47bc7cc8": { code: "chain/NOT_AUTHORIZED_ROLE", name: "OnlyCreator" },
  "0x80fee105": { code: "chain/NOT_AUTHORIZED_ROLE", name: "OnlyOracle" },
  "0x47556579": { code: "chain/NOT_AUTHORIZED_ROLE", name: "OnlyAdmin" },
  "0x7db1be50": { code: "chain/MARKET_NOT_FOUND", name: "MarketNotFound" },
  "0x8fc6f59b": { code: "chain/MARKET_EXISTS", name: "MarketExists" },
  "0x1db9461a": { code: "chain/MARKET_RESOLVED", name: "MarketResolvedAlready" },
  "0x9f4a6489": { code: "chain/NOT_RESOLVED", name: "NotResolved" },
  "0xc74a206d": { code: "chain/INVALID_OUTCOME", name: "InvalidOutcome" },
  "0x81e1c048": { code: "chain/INVALID_QUESTION", name: "InvalidQuestion" },
  "0x10549aa0": { code: "chain/INVALID_RESOLUTION_TIME", name: "InvalidResolutionTime" },
  "0xe2c865df": { code: "chain/TRADING_CLOSED", name: "TradingClosed" },
  "0xd93c0665": { code: "chain/ENFORCED_PAUSE", name: "EnforcedPause" },
  "0x0fce133d": { code: "chain/TOO_EARLY_TO_RESOLVE", name: "TooEarlyToResolve" },
  "0xb5b6d675": { code: "chain/REFUND_WINDOW_NOT_REACHED", name: "RefundWindowNotReached" },
  "0x9890af60": { code: "chain/NOTHING_TO_REDEEM", name: "NothingToRedeem" },
  "0x351261fc": { code: "chain/NOTHING_TO_SWEEP", name: "NothingToSweep" },
  "0x03580407": { code: "chain/BELOW_MIN_SEED", name: "BelowMinSeed" },
  "0x9811e0c7": { code: "chain/ZERO_SHARES", name: "ZeroShares" },
  "0x8199f5f3": { code: "chain/SLIPPAGE_EXCEEDED", name: "SlippageExceeded" },
  "0xbb55fd27": { code: "chain/INSUFFICIENT_LIQUIDITY", name: "InsufficientLiquidity" },
  "0x3f8dadf7": { code: "chain/SAME_OUTCOME", name: "SameOutcome" },
  "0xd92e233d": { code: "chain/ZERO_ADDRESS", name: "ZeroAddress" },
  "0x6f7c43f1": { code: "chain/NOT_CONTRACT", name: "NotContract" },
  "0x5274afe7": { code: "chain/SAFE_ERC20", name: "SafeERC20FailedOperation" },
  "0xcd786059": { code: "chain/SAFE_ERC20", name: "AddressInsufficientBalance" },
  "0x9996b315": { code: "chain/SAFE_ERC20", name: "AddressEmptyCode" },
  "0x1425ea42": { code: "chain/SAFE_ERC20", name: "FailedInnerCall" },
  "0x227bc153": { code: "chain/PANIC", name: "MathOverflowedMulDiv" },
  "0x3ee5aeb5": { code: "chain/REENTRANCY", name: "ReentrancyGuardReentrantCall" },
};

/**
 * 把钱包/RPC 抛回来的 revert 数据翻译成中文 SdkError。
 * 支持：自定义错误（4 字节 selector）、Error(string)、Panic(uint256)、纯逻辑拦截。
 */
export function decodeRevert(err: unknown): SdkError {
  const raw = extractRevertData(err);
  if (!raw || raw === "0x") {
    const msg = err instanceof Error ? err.message : String(err);
    return new SdkError("chain/UNKNOWN", `${ZH["chain/UNKNOWN"]}：${msg}`, { raw: msg });
  }
  const data = raw.toLowerCase();
  const selector = data.slice(0, 10);

  if (selector === "0x08c379a0") {
    // Error(string)
    const text = decodeAbiString(data.slice(10));
    return new SdkError("chain/REVERT_STRING", text || ZH["chain/REVERT_STRING"], { selector, raw: data });
  }
  if (selector === "0x4e487b71") {
    // Panic(uint256)
    const code = word(data.slice(10), 0);
    return new SdkError("chain/PANIC", `${ZH["chain/PANIC"]}（panic code 0x${code.toString(16)}）`, {
      selector,
      raw: data,
    });
  }
  const hit = ERROR_SELECTORS[selector];
  if (hit) {
    return new SdkError(hit.code, ZH[hit.code], { selector, raw: `${hit.name} ${data}` });
  }
  return new SdkError("chain/UNKNOWN", `${ZH["chain/UNKNOWN"]}（selector ${selector}）`, { selector, raw: data });
}

function extractRevertData(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const o = err as Record<string, unknown>;
  for (const key of ["data", "revertData", "return", "result"]) {
    const v = o[key];
    if (typeof v === "string" && v.startsWith("0x")) return v;
    if (v && typeof v === "object") {
      const nested = extractRevertData(v);
      if (nested) return nested;
    }
  }
  if (typeof o.error === "object" && o.error) return extractRevertData(o.error);
  if (typeof o.info === "object" && o.info) return extractRevertData(o.info);
  if (typeof o.cause === "object" && o.cause) return extractRevertData(o.cause);
  return null;
}

/* ============================== ABI 基础工具 ============================== */

const ZERO32 = "0".repeat(64);
const HEX_RE = /^0x[0-9a-fA-F]*$/;

export function strip0x(hex: string): string {
  return hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
}

export function isAddress(v: unknown): v is Address {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
}

export function isBytes32(v: unknown): v is Hex {
  return typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
}

export function pad32(hexBody: string): string {
  const body = strip0x(hexBody);
  if (body.length > 64) throw new SdkError("local/BAD_BYTES32", ZH["local/BAD_BYTES32"]);
  return body.padStart(64, "0");
}

export function uintWord(v: bigint | number): string {
  const n = typeof v === "bigint" ? v : BigInt(Math.trunc(v));
  if (n < 0n) throw new SdkError("local/BAD_AMOUNT", ZH["local/BAD_AMOUNT"]);
  return n.toString(16).padStart(64, "0");
}

export function addressWord(addr: Address): string {
  if (!isAddress(addr)) throw new SdkError("local/BAD_ADDRESS", ZH["local/BAD_ADDRESS"]);
  return strip0x(addr).toLowerCase().padStart(64, "0");
}

export function bytes32Word(v: Hex): string {
  if (!isBytes32(v)) throw new SdkError("local/BAD_BYTES32", ZH["local/BAD_BYTES32"]);
  return strip0x(v).toLowerCase();
}

/* -------------------- UTF-8 编解码（浏览器/Node 通用，不依赖 Buffer） -------------------- */

const HEX_TO_BYTES: Record<string, number> = {};
for (let i = 0; i < 256; i += 1) HEX_TO_BYTES[i.toString(16).padStart(2, "0")] = i;

function utf8Bytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function utf8Length(str: string): number {
  return utf8Bytes(str).length;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** 纯 hex → UTF-8 字符串（不依赖 Buffer，浏览器里也能跑） */
export function hexToUtf8(hex: string): string {
  const clean = strip0x(hex);
  const bytes = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = HEX_TO_BYTES[clean.slice(i * 2, i * 2 + 2).toLowerCase()] ?? 0;
  }
  return new TextDecoder().decode(bytes);
}

/** 动态 string 的 ABI 编码（UTF-8，尾部按 32 字节补齐） */
export function encodeString(str: string): { body: string; words: number } {
  const bytes = utf8Bytes(str);
  const hex = bytesToHex(bytes);
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64 || 0, "0");
  const words = 1 + (padded.length ? padded.length / 64 : 0);
  return { body: uintWord(BigInt(bytes.length)) + padded, words };
}

/** 解 ABI 编码的 string（offset 指向长度字，之后是 UTF-8 字节） */
export function decodeString(raw: string): string {
  const body = strip0x(raw);
  if (body.length < 64) return "";
  const off = Number(BigInt("0x" + body.slice(0, 64))) * 2;
  if (body.length < off + 64) return "";
  const len = Number(BigInt("0x" + body.slice(off, off + 64)));
  return hexToUtf8(body.slice(off + 64, off + 64 + len * 2));
}

function word(data: string, index: number): bigint {
  const body = strip0x(data);
  const chunk = body.slice(index * 64, (index + 1) * 64);
  if (chunk.length !== 64) return 0n;
  return BigInt("0x" + chunk);
}

export function decodeAbiString(data: string): string {
  const body = strip0x(data);
  if (body.length < 128) return "";
  const len = Number(BigInt("0x" + body.slice(64, 128)));
  return hexToUtf8(body.slice(128, 128 + len * 2));
}

/* ============================== 选择器表 ============================== */

/** 全部由 `cast sig` 生成，测试里会逐条与编译器 ABI 对齐 */
export const SEL = {
  createMarket: "0xfeeece8b",
  createMarketWithMeta: "0x1e9b6b02",
  buyShares: "0xbbd4f854",
  sellShares: "0xdb833e3a",
  redeem: "0xeda1122c",
  resolveMarket: "0x5e382837",
  overrideResolution: "0xc0b9795d",
  previewBuy: "0xf0729712",
  previewSell: "0x29aec689",
  marketCore: "0xfbfab8f9",
  resolutionState: "0x8e092a39",
  yesOf: "0xca652c50",
  noOf: "0x081d260b",
  paused: "0x5c975abb",
  admin: "0xf851a440",
  creators: "0x933166e1",
  oracles: "0xaddd5099",
  minBet: "0x6540742f",
  maxBet: "0x7e95b523",
  minTradingWindow: "0x2f6488dc",
  maxTradingWindow: "0x96b6273d",
  disputeWindow: "0xf585dc57",
  refundDelay: "0x190da595",
  depth: "0x9e77a298",
  priceYes: "0x20c7e5ff",
  marketCount: "0xec979082",
  marketIds: "0x779a9683",
  marketQuestion: "0xe59fab92",
  marketCategory: "0x93eaaf09",
  isFinal: "0xda3686de",
  tradingOpen: "0x7142f5d6",
  tradeFeeBps: "0x9185f598",
  settleFeeBps: "0xb648acb4",
} as const;

/* ============================== 离线定价（与合约同公式） ============================== */

export interface PoolSnapshot {
  yesReserve: bigint;
  noReserve: bigint;
  cash?: bigint;
  owed?: bigint;
  totalVolume?: bigint;
  resolutionTime?: bigint;
  createdAt?: bigint;
  creator?: Address;
  outcome?: number;
  resolved?: boolean;
  exists?: boolean;
}

export interface MarketState extends Required<Omit<PoolSnapshot, "creator">> {
  creator: Address;
}

const BPS = 10_000n;
const WAD = 10n ** 18n;

function mulDivDown(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) return 0n;
  return (a * b) / d;
}

function mulDivUp(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) return 0n;
  const p = a * b;
  return p === 0n ? 0n : (p - 1n) / d + 1n;
}

/** 与合约 TRADE_FEE_BPS = 150 对齐 */
export const TRADE_FEE_BPS = 150n;

/** 与合约 previewBuy 完全同构的离线计算（不联网就能给用户看价） */
export function previewBuyOffline(
  pool: { yesReserve: bigint; noReserve: bigint },
  outcome: Outcome,
  amountIn: bigint,
  tradeFeeBps: bigint = TRADE_FEE_BPS,
): bigint {
  if (pool.yesReserve === 0n || pool.noReserve === 0n) return 0n;
  if (outcome > 1) return 0n;
  const fee = mulDivUp(amountIn, tradeFeeBps, BPS);
  const net = amountIn - fee;
  if (net <= 0n) return 0n;
  if (outcome === OUTCOME_YES) {
    return net + (pool.yesReserve - mulDivUp(pool.yesReserve, pool.noReserve, pool.noReserve + net));
  }
  return net + (pool.noReserve - mulDivUp(pool.noReserve, pool.yesReserve, pool.yesReserve + net));
}

/** 与合约 previewSell 完全同构（前后价中点，扣 1.5%） */
export function previewSellOffline(
  pool: { yesReserve: bigint; noReserve: bigint },
  outcome: Outcome,
  sharesIn: bigint,
  tradeFeeBps: bigint = TRADE_FEE_BPS,
): bigint {
  const d = pool.yesReserve + pool.noReserve;
  if (d === 0n || outcome > 1) return 0n;
  let pBefore: bigint;
  let pAfter: bigint;
  if (outcome === OUTCOME_YES) {
    if (sharesIn > pool.noReserve) return 0n;
    pBefore = mulDivDown(pool.noReserve, WAD, d);
    pAfter = mulDivDown(pool.noReserve - sharesIn, WAD, d - sharesIn);
  } else {
    if (sharesIn > pool.yesReserve) return 0n;
    pBefore = mulDivDown(pool.yesReserve, WAD, d);
    pAfter = mulDivDown(pool.yesReserve - sharesIn, WAD, d - sharesIn);
  }
  const gross = mulDivDown(sharesIn, pBefore + pAfter, 2n * WAD);
  return gross - mulDivUp(gross, tradeFeeBps, BPS);
}

/** YES 价格（1e18） */
export function priceYesOffline(pool: { yesReserve: bigint; noReserve: bigint }): bigint {
  const d = pool.yesReserve + pool.noReserve;
  if (d === 0n) return 0n;
  return mulDivDown(pool.noReserve, WAD, d);
}

/* ============================== 主体 ============================== */

export class CentralPredictionSDK {
  private readonly transport: Transport;
  private readonly engine: Address;
  private readonly chainId?: number;
  private account?: Address;

  constructor(transport: Transport, config: SDKConfig) {
    if (!isAddress(config.engine)) throw new SdkError("local/NOT_CONNECTED", ZH["local/NOT_CONNECTED"]);
    this.transport = transport;
    this.engine = config.engine;
    this.chainId = config.chainId;
    this.account = config.account;
  }

  /* ---------------------------- 内部读取 ---------------------------- */

  private async call(data: Hex, to: Address = this.engine): Promise<string> {
    try {
      const out = await this.transport.ethCall(to, data);
      if (typeof out !== "string" || !HEX_RE.test(out)) {
        throw new SdkError("local/TRANSPORT_ERROR", `${ZH["local/TRANSPORT_ERROR"]}（返回非法 hex）`);
      }
      return out;
    } catch (err) {
      if (err instanceof SdkError) throw err;
      // 链上 revert（例如 marketCore 对不存在的盘口照样返回 0，但 role 查询可能 revert）
      if (extractRevertData(err)) throw decodeRevert(err);
      const msg = err instanceof Error ? err.message : String(err);
      throw new SdkError("local/TRANSPORT_ERROR", `${ZH["local/TRANSPORT_ERROR"]}：${msg}`);
    }
  }

  private async boolCall(sig: string, argsHex: string): Promise<boolean> {
    const out = await this.call(sig + argsHex);
    return word(out, 0) !== 0n;
  }

  private async uintCall(sig: string, argsHex: string): Promise<bigint> {
    const out = await this.call(sig + argsHex);
    return word(out, 0);
  }

  private requireAccount(): Address {
    if (!this.account) throw new SdkError("local/ACCOUNT_REQUIRED", ZH["local/ACCOUNT_REQUIRED"]);
    return this.account;
  }

  /* ---------------------------- 只读视图 ---------------------------- */

  async marketCore(marketId: Hex): Promise<MarketState> {
    const out = await this.call(SEL.marketCore + bytes32Word(marketId));
    return {
      yesReserve: word(out, 0),
      noReserve: word(out, 1),
      cash: word(out, 2),
      owed: word(out, 3),
      totalVolume: word(out, 4),
      resolutionTime: word(out, 5),
      createdAt: word(out, 6),
      creator: "0x" + strip0x(out).slice(7 * 64 + 24, 8 * 64),
      outcome: Number(word(out, 8)),
      resolved: word(out, 9) !== 0n,
      exists: word(out, 10) !== 0n,
    };
  }

  async resolutionState(marketId: Hex): Promise<{
    resolved: boolean;
    finalized: boolean;
    disputing: boolean;
    outcome: Outcome;
    disputeEndsAt: bigint;
    owed: bigint;
  }> {
    const out = await this.call(SEL.resolutionState + bytes32Word(marketId));
    return {
      resolved: word(out, 0) !== 0n,
      finalized: word(out, 1) !== 0n,
      disputing: word(out, 2) !== 0n,
      outcome: Number(word(out, 3)) as Outcome,
      disputeEndsAt: word(out, 4),
      owed: word(out, 5),
    };
  }

  /* ---------------------------- 列表页读取 ---------------------------- */

  /** 盘口总数（列表页分页的起点） */
  async marketCount(): Promise<number> {
    return Number(await this.uintCall(SEL.marketCount, ""));
  }

  /** 第 index 个盘口 id（0-based，配合 marketCount 翻页） */
  async marketId(index: number): Promise<Hex> {
    const out = await this.call(SEL.marketIds + uintWord(BigInt(index)));
    return ("0x" + strip0x(out).slice(0, 64)) as Hex;
  }

  /** 盘口题目（字符串，单独一个 view，避免列表页结构体过大） */
  async marketQuestion(marketId: Hex): Promise<string> {
    return decodeString(await this.call(SEL.marketQuestion + bytes32Word(marketId)));
  }

  /** 盘口分类 */
  async marketCategory(marketId: Hex): Promise<string> {
    return decodeString(await this.call(SEL.marketCategory + bytes32Word(marketId)));
  }

  /** YES 价格（1e18，即概率） */
  async priceYes(marketId: Hex): Promise<bigint> {
    return this.uintCall(SEL.priceYes, bytes32Word(marketId));
  }

  /** 池深 = yesReserve + noReserve */
  async depthOf(marketId: Hex): Promise<bigint> {
    return this.uintCall(SEL.depth, bytes32Word(marketId));
  }

  /** 争议期是否已结束（可提现） */
  async isFinal(marketId: Hex): Promise<boolean> {
    return this.boolCall(SEL.isFinal, bytes32Word(marketId));
  }

  /** 当前是否可交易（存在 && 未结算 && 未暂停） */
  async tradingOpen(marketId: Hex): Promise<boolean> {
    return this.boolCall(SEL.tradingOpen, bytes32Word(marketId));
  }

  async sharesOf(marketId: Hex, who?: Address): Promise<{ yes: bigint; no: bigint }> {
    const account = who ?? this.requireAccount();
    const base = bytes32Word(marketId) + addressWord(account);
    return {
      yes: await this.uintCall(SEL.yesOf, base),
      no: await this.uintCall(SEL.noOf, base),
    };
  }

  /* ---------------------------- 批量快照（Multicall3） ---------------------------- */

  /**
   * 一次 RPC 拉多个盘口的「价格 / 池深 / 状态」。
   *
   * 实现走 Base 上的 **Multicall3**（`0xcA11bde05977b3631167028862bE2a173976CA11`，
   * Base 主网与所有主流链都是同一地址），把 4N 个 view 调用压成 1 个 `eth_call`；
   * 需要额外字段（题面、持仓）再按需补 `ethCall`，不要为了省事把 30 个盘口串行 await。
   *
   * 任何一步失败都能降级：Multicall 不可用 / 单条子调用失败 → 逐条补齐，绝不整体报错。
   *
   * @param ids        盘口 id 列表（建议一次 ≤ 100 个，响应体大小限制）
   * @param opts.multicall  传 `false` 强制逐条查；传地址则用自定义 Multicall
   */
  async marketSnapshots(
    ids: Hex[],
    opts: { multicall?: Address | false; withMeta?: boolean } = {},
  ): Promise<MarketSnapshot[]> {
    if (ids.length === 0) return [];
    const target = opts.multicall === false ? null : (opts.multicall ?? MULTICALL3);
    if (target) {
      try {
        const snaps = await this.snapshotsViaMulticall(ids, target, opts.withMeta === true);
        // 个别子调用失败（盘口被删/节点异常）→ 只补那几条
        const missing = snaps.map((s, i) => (s.failed ? i : -1)).filter((i) => i >= 0);
        if (missing.length === 0) return snaps.map(({ failed, ...rest }) => rest as MarketSnapshot);
        await Promise.all(
          missing.map(async (i) => {
            snaps[i] = { ...(await this.snapshotOne(ids[i], opts.withMeta === true)), failed: false };
          }),
        );
        return snaps.map(({ failed, ...rest }) => rest as MarketSnapshot);
      } catch {
        /* 没有 Multicall / 编码不兼容 → 静默降级 */
      }
    }
    return Promise.all(ids.map((id) => this.snapshotOne(id, opts.withMeta === true)));
  }

  /** 单个盘口快照（4 个 view 并行） */
  async snapshotOne(marketId: Hex, withMeta = false): Promise<MarketSnapshot> {
    const [core, state, priceYes, depth, question, category] = await Promise.all([
      this.marketCore(marketId),
      this.resolutionState(marketId),
      this.uintCall(SEL.priceYes, bytes32Word(marketId)),
      this.uintCall(SEL.depth, bytes32Word(marketId)),
      withMeta ? this.marketQuestion(marketId) : Promise.resolve(undefined),
      withMeta ? this.marketCategory(marketId) : Promise.resolve(undefined),
    ]);
    return {
      marketId,
      exists: core.exists,
      priceYes,
      priceNo: WAD - priceYes,
      depth,
      yesReserve: core.yesReserve,
      noReserve: core.noReserve,
      resolved: core.resolved,
      finalized: state.finalized,
      disputing: state.disputing,
      outcome: state.outcome,
      disputeEndsAt: state.disputeEndsAt,
      resolutionTime: core.resolutionTime,
      cash: core.cash,
      owed: core.owed,
      totalVolume: core.totalVolume,
      tradingOpen: core.exists && !core.resolved && !(await this.paused()),
      ...(withMeta ? { question, category } : {}),
    };
  }

  private async snapshotsViaMulticall(
    ids: Hex[],
    multicall: Address,
    withMeta: boolean,
  ): Promise<Array<MarketSnapshot & { failed: boolean }>> {
    const stride = withMeta ? 6 : 4;
    const calls: MulticallCall[] = [];
    for (const id of ids) {
      const arg = bytes32Word(id);
      calls.push({ target: this.engine, allowFailure: true, data: (SEL.marketCore + arg) as Hex });
      calls.push({ target: this.engine, allowFailure: true, data: (SEL.resolutionState + arg) as Hex });
      calls.push({ target: this.engine, allowFailure: true, data: (SEL.priceYes + arg) as Hex });
      calls.push({ target: this.engine, allowFailure: true, data: (SEL.depth + arg) as Hex });
      if (withMeta) {
        calls.push({ target: this.engine, allowFailure: true, data: (SEL.marketQuestion + arg) as Hex });
        calls.push({ target: this.engine, allowFailure: true, data: (SEL.marketCategory + arg) as Hex });
      }
    }
    calls.push({ target: this.engine, allowFailure: true, data: SEL.paused as Hex });

    const raw = await this.call(encodeAggregate3(calls), multicall);
    const results = decodeAggregate3Result(raw);
    const pausedIdx = ids.length * stride;
    const pausedNow = results[pausedIdx]?.success ? word(results[pausedIdx].data, 0) !== 0n : false;

    const out: Array<MarketSnapshot & { failed: boolean }> = [];
    for (let i = 0; i < ids.length; i += 1) {
      const base = i * stride;
      const coreRes = results[base];
      const stateRes = results[base + 1];
      const priceRes = results[base + 2];
      const depthRes = results[base + 3];
      const qRes = withMeta ? results[base + 4] : undefined;
      const catRes = withMeta ? results[base + 5] : undefined;
      const ok =
        coreRes?.success &&
        stateRes?.success &&
        priceRes?.success &&
        depthRes?.success &&
        (!withMeta || (qRes?.success && catRes?.success));
      if (!ok) {
        out.push({ ...blankSnapshot(ids[i]), failed: true });
        continue;
      }
      const core = decodeCore(coreRes.data);
      const state = decodeResolution(stateRes.data);
      const priceYes = word(priceRes.data, 0);
      out.push({
        marketId: ids[i],
        exists: core.exists,
        priceYes,
        priceNo: WAD - priceYes,
        depth: word(depthRes.data, 0),
        yesReserve: core.yesReserve,
        noReserve: core.noReserve,
        resolved: core.resolved,
        finalized: state.finalized,
        disputing: state.disputing,
        outcome: state.outcome,
        disputeEndsAt: state.disputeEndsAt,
        resolutionTime: core.resolutionTime,
        cash: core.cash,
        owed: core.owed,
        totalVolume: core.totalVolume,
        tradingOpen: core.exists && !core.resolved && !pausedNow,
        ...(withMeta ? { question: decodeString(qRes!.data), category: decodeString(catRes!.data) } : {}),
        failed: false,
      });
    }
    return out;
  }

  /* ---------------------------- 事件日志 ---------------------------- */

  /** 本引擎地址（前端过滤日志时用） */
  get engineAddress(): Address {
    return this.engine;
  }

  /**
   * 从一笔交易的 receipt.logs 里筛出本引擎事件并解码。
   * 前端拿到 hash 后直接：`const evs = sdk.decodeReceiptLogs(receipt.logs)`。
   */
  decodeReceiptLogs(logs: RawLog[]): DecodedEvent[] {
    const mine = logs.filter((l) => strip0x(l.address ?? "").toLowerCase() === strip0x(this.engine).toLowerCase());
    return decodeLogs(mine);
  }

  async previewBuy(marketId: Hex, outcome: Outcome, amountIn: bigint): Promise<bigint> {
    const arg = bytes32Word(marketId) + uintWord(BigInt(outcome)) + uintWord(amountIn);
    return this.uintCall(SEL.previewBuy, arg);
  }

  async previewSell(marketId: Hex, outcome: Outcome, sharesIn: bigint): Promise<bigint> {
    const arg = bytes32Word(marketId) + uintWord(BigInt(outcome)) + uintWord(sharesIn);
    return this.uintCall(SEL.previewSell, arg);
  }

  async paused(): Promise<boolean> {
    return this.boolCall(SEL.paused, "");
  }

  async isCreator(addr?: Address): Promise<boolean> {
    const who = addr ?? this.requireAccount();
    return this.boolCall(SEL.creators, addressWord(who));
  }

  async isOracle(addr?: Address): Promise<boolean> {
    const who = addr ?? this.requireAccount();
    return this.boolCall(SEL.oracles, addressWord(who));
  }

  /**
   * 与合约 `onlyCreator` 完全一致的权限判断：admin 本身也拥有建盘权
   * （合约是 `msg.sender != admin && !creators[msg.sender]`，SDK 不能只看 creators 映射）
   */
  async canCreate(addr?: Address): Promise<boolean> {
    const who = addr ?? this.requireAccount();
    const [role, adminAddr] = await Promise.all([this.isCreator(who), this.admin()]);
    return role || who.toLowerCase() === adminAddr.toLowerCase();
  }

  /** 与合约 `onlyOracle` 一致：admin 本身也拥有裁决权 */
  async canOracle(addr?: Address): Promise<boolean> {
    const who = addr ?? this.requireAccount();
    const [role, adminAddr] = await Promise.all([this.isOracle(who), this.admin()]);
    return role || who.toLowerCase() === adminAddr.toLowerCase();
  }

  async admin(): Promise<Address> {
    const out = await this.call(SEL.admin);
    return "0x" + strip0x(out).slice(24);
  }

  async constants(): Promise<{
    minBet: bigint;
    maxBet: bigint;
    minTradingWindow: bigint;
    maxTradingWindow: bigint;
    disputeWindow: bigint;
    refundDelay: bigint;
    tradeFeeBps: bigint;
    settleFeeBps: bigint;
  }> {
    return {
      minBet: await this.uintCall(SEL.minBet, ""),
      maxBet: await this.uintCall(SEL.maxBet, ""),
      minTradingWindow: await this.uintCall(SEL.minTradingWindow, ""),
      maxTradingWindow: await this.uintCall(SEL.maxTradingWindow, ""),
      disputeWindow: await this.uintCall(SEL.disputeWindow, ""),
      refundDelay: await this.uintCall(SEL.refundDelay, ""),
      tradeFeeBps: await this.uintCall(SEL.tradeFeeBps, ""),
      settleFeeBps: await this.uintCall(SEL.settleFeeBps, ""),
    };
  }

  /* ---------------------------- 通用校验 ---------------------------- */

  private assertOutcome(outcome: number): asserts outcome is Outcome {
    if (![0, 1, 2].includes(outcome)) throw new SdkError("local/BAD_OUTCOME", ZH["local/BAD_OUTCOME"]);
  }

  private assertAmount(v: bigint | number, label = "amount"): bigint {
    const n = typeof v === "bigint" ? v : BigInt(Math.trunc(v));
    if (n <= 0n) throw new SdkError("local/BAD_AMOUNT", `${label} 必须大于 0`);
    return n;
  }

  /**
   * minSharesOut / minAmountOut 强校验 —— 这是本 SDK 的核心防线：
   *   0            → 直接拒（禁止裸奔）
   *   > 报价        → 直接拒（这笔交易必然失败）
   *   < 报价×95%    → 直接拒（容差超过 5%，等于没保护）
   */
  private assertMinOut(minOut: bigint | number, quote: bigint, label: string): bigint {
    const n = typeof minOut === "bigint" ? minOut : BigInt(Math.trunc(minOut));
    if (n <= 0n) throw new SdkError("local/MIN_OUT_REQUIRED", `${label}：${ZH["local/MIN_OUT_REQUIRED"]}`);
    if (quote === 0n) throw new SdkError("local/BAD_AMOUNT", "报价为 0，无法设定保护价");
    if (n > quote) {
      throw new SdkError(
        "local/MIN_OUT_ABOVE_QUOTE",
        `${label}：${ZH["local/MIN_OUT_ABOVE_QUOTE"]}（min=${n} / quote=${quote}）`,
      );
    }
    const floor = (quote * (BPS - MAX_SLIPPAGE_BPS)) / BPS;
    if (n < floor) {
      throw new SdkError(
        "local/SLIPPAGE_TOO_LOOSE",
        `${label}：${ZH["local/SLIPPAGE_TOO_LOOSE"]}（min=${n} < 报价×95%=${floor}）`,
      );
    }
    return n;
  }

  /** 由报价 + 滑点算出保护价（四舍五入向下，永远对用户更保守的那一侧） */
  static minOutFromQuote(quote: bigint, slippageBps: bigint | number): bigint {
    const bps = typeof slippageBps === "bigint" ? slippageBps : BigInt(Math.trunc(slippageBps));
    if (bps < MIN_SLIPPAGE_BPS || bps > MAX_SLIPPAGE_BPS) {
      throw new SdkError("local/SLIPPAGE_OUT_OF_RANGE", ZH["local/SLIPPAGE_OUT_OF_RANGE"]);
    }
    return (quote * (BPS - bps)) / BPS;
  }

  /* ---------------------------- 建盘 ---------------------------- */

  /**
   * 建盘。`meta.category` 存在 → 走 createMarketWithMeta（4 参），否则走 createMarket（3 参）。
   * 新引擎没有「6 参 createMarket」（那是旧工厂），签名对照见 docs/CENTRAL-SDK-GUIDE.md。
   */
  async buildCreateMarket(input: {
    marketId: Hex;
    question: string;
    resolutionTime: bigint | number;
    meta?: { category?: string };
  }): Promise<TxPlan> {
    if (!isBytes32(input.marketId)) throw new SdkError("local/BAD_BYTES32", ZH["local/BAD_BYTES32"]);
    const qBytes = utf8Length(input.question);
    if (qBytes < 8 || qBytes > 280) {
      throw new SdkError("local/QUESTION_LENGTH", `${ZH["local/QUESTION_LENGTH"]}（当前 ${qBytes} 字节）`);
    }
    const category = input.meta?.category;
    if (category !== undefined) {
      const cBytes = utf8Length(category);
      if (cBytes < 1 || cBytes > 32) {
        throw new SdkError("local/CATEGORY_LENGTH", `${ZH["local/CATEGORY_LENGTH"]}（当前 ${cBytes} 字节）`);
      }
    }

    const account = this.requireAccount();
    const [core, canCreate, k] = await Promise.all([
      this.marketCore(input.marketId),
      this.canCreate(account),
      this.constants(),
    ]);
    if (core.exists) throw new SdkError("local/MARKET_EXISTS", ZH["local/MARKET_EXISTS"]);
    if (!canCreate) throw new SdkError("local/NOT_CREATOR", ZH["local/NOT_CREATOR"]);

    const resolutionTime = BigInt(input.resolutionTime);
    const now = await this.chainNow();
    if (resolutionTime <= now + k.minTradingWindow || resolutionTime > now + k.maxTradingWindow) {
      throw new SdkError("local/RESOLUTION_TIME_RANGE", ZH["local/RESOLUTION_TIME_RANGE"]);
    }

    let data: Hex;
    let method: string;
    if (category === undefined) {
      // head: marketId, offset(=0x60), resolutionTime ; tail: len + bytes
      const tail = encodeString(input.question);
      data =
        SEL.createMarket +
        bytes32Word(input.marketId) +
        uintWord(0x60n) +
        uintWord(resolutionTime) +
        tail.body;
      method = "createMarket";
    } else {
      // head: marketId, offQ(=0x80), offCat, resolutionTime ; tail: q, cat
      const q = encodeString(input.question);
      const cat = encodeString(category);
      const offCat = 0x80n + BigInt(q.words * 32);
      data =
        SEL.createMarketWithMeta +
        bytes32Word(input.marketId) +
        uintWord(0x80n) +
        uintWord(offCat) +
        uintWord(resolutionTime) +
        q.body +
        cat.body;
      method = "createMarketWithMeta";
    }

    return {
      to: this.engine,
      data,
      value: "0x0",
      method,
      summary: `创建盘口「${input.question}」，结算时间 ${new Date(Number(resolutionTime) * 1000).toISOString()}`,
      meta: {
        marketId: input.marketId,
        question: input.question,
        category: category ?? "general",
        resolutionTime: resolutionTime.toString(),
        questionBytes: qBytes,
      },
    };
  }

  /* ---------------------------- 买入 ---------------------------- */

  /**
   * 买入份额。
   *  - `slippageBps`：推荐用法，保护价由报价现算（1~500 bps）
   *  - `minSharesOut`：显式传入时也必须落在 [报价×95%, 报价] 内，否则直接拒
   *  两者都给时，取更严格的那个（更大的 minSharesOut）。
   */
  async buildBuyShares(input: {
    marketId: Hex;
    outcome: Outcome;
    amountIn: bigint | number;
    minSharesOut?: bigint | number;
    slippageBps?: bigint | number;
  }): Promise<TxPlan> {
    this.assertOutcome(input.outcome);
    const amountIn = this.assertAmount(input.amountIn, "amountIn");
    if (input.minSharesOut === undefined && input.slippageBps === undefined) {
      throw new SdkError(
        "local/MIN_OUT_REQUIRED",
        "必须提供 minSharesOut 或 slippageBps —— 不设保护会被夹子按任意价格成交",
      );
    }

    const account = this.requireAccount();
    const [core, paused, k, onchainQuote] = await Promise.all([
      this.marketCore(input.marketId),
      this.paused(),
      this.constants(),
      this.previewBuy(input.marketId, input.outcome, amountIn),
    ]);
    if (!core.exists) throw new SdkError("local/MARKET_NOT_FOUND", ZH["local/MARKET_NOT_FOUND"]);
    if (core.resolved) throw new SdkError("local/MARKET_RESOLVED", ZH["local/MARKET_RESOLVED"]);
    const now = await this.chainNow();
    if (now >= core.resolutionTime) throw new SdkError("local/TRADING_CLOSED", ZH["local/TRADING_CLOSED"]);
    if (paused) throw new SdkError("local/MARKET_PAUSED", ZH["local/MARKET_PAUSED"]);
    if (amountIn < k.minBet) throw new SdkError("chain/BELOW_MIN_BET", `低于最低下注额（${k.minBet} 个最小单位）`);
    if (amountIn > k.maxBet) throw new SdkError("chain/ABOVE_MAX_BET", `高于单笔上限（${k.maxBet} 个最小单位）`);

    const depth = core.yesReserve + core.noReserve;
    const impactCap = mulDivDown(depth, MAX_IMPACT_BPS, BPS);
    if (amountIn > impactCap) {
      throw new SdkError(
        "chain/IMPACT_TOO_HIGH",
        `${ZH["chain/IMPACT_TOO_HIGH"]}（本笔 ${amountIn} > 上限 ${impactCap}）`,
      );
    }
    const impactBps = depth === 0n ? 0n : (amountIn * BPS) / depth;

    // 本地同公式复算，抓 ABI/模型漂移
    const localQuote = previewBuyOffline({ yesReserve: core.yesReserve, noReserve: core.noReserve }, input.outcome, amountIn, k.tradeFeeBps);
    if (localQuote !== onchainQuote) {
      throw new SdkError(
        "local/QUOTE_MISMATCH",
        `${ZH["local/QUOTE_MISMATCH"]}（本地 ${localQuote} / 链上 ${onchainQuote}）`,
      );
    }
    if (onchainQuote === 0n) throw new SdkError("chain/ZERO_SHARES", ZH["chain/ZERO_SHARES"]);

    const candidates: bigint[] = [];
    if (input.slippageBps !== undefined) {
      candidates.push(CentralPredictionSDK.minOutFromQuote(onchainQuote, input.slippageBps));
    }
    if (input.minSharesOut !== undefined) {
      candidates.push(this.assertMinOut(input.minSharesOut, onchainQuote, "minSharesOut"));
    }
    const minSharesOut = candidates.reduce((a, b) => (a > b ? a : b));

    return {
      to: this.engine,
      data:
        SEL.buyShares +
        bytes32Word(input.marketId) +
        uintWord(BigInt(input.outcome)) +
        uintWord(amountIn) +
        uintWord(minSharesOut),
      value: "0x0",
      method: "buyShares",
      summary: `买入 ${input.outcome === OUTCOME_YES ? "YES" : "NO"}，支付 ${formatUsdc(amountIn)} USDC，最少拿到 ${minSharesOut.toString()} 份（报价 ${onchainQuote.toString()}）`,
      meta: {
        marketId: input.marketId,
        outcome: input.outcome === OUTCOME_YES ? "YES" : "NO",
        amountIn: amountIn.toString(),
        quote: onchainQuote.toString(),
        minSharesOut: minSharesOut.toString(),
        quotedAt: Date.now(),
        priceYes: priceYesOffline(core).toString(),
        impactBps: impactBps.toString(),
        account,
      },
      ...(impactBps >= IMPACT_WARN_BPS ? { warning: "impact_near_limit" as const } : {}),
    };
  }

  /* ---------------------------- 卖出 ---------------------------- */

  async buildSellShares(input: {
    marketId: Hex;
    outcome: Outcome;
    sharesIn: bigint | number;
    minAmountOut?: bigint | number;
    slippageBps?: bigint | number;
  }): Promise<TxPlan> {
    this.assertOutcome(input.outcome);
    const sharesIn = this.assertAmount(input.sharesIn, "sharesIn");
    if (input.minAmountOut === undefined && input.slippageBps === undefined) {
      throw new SdkError(
        "local/MIN_OUT_REQUIRED",
        "必须提供 minAmountOut 或 slippageBps —— 不设保护会被夹子按任意价格成交",
      );
    }

    const account = this.requireAccount();
    const [core, paused, k, holdings, onchainQuote] = await Promise.all([
      this.marketCore(input.marketId),
      this.paused(),
      this.constants(),
      this.sharesOf(input.marketId, account),
      this.previewSell(input.marketId, input.outcome, sharesIn),
    ]);
    if (!core.exists) throw new SdkError("local/MARKET_NOT_FOUND", ZH["local/MARKET_NOT_FOUND"]);
    if (core.resolved) throw new SdkError("local/MARKET_RESOLVED", ZH["local/MARKET_RESOLVED"]);
    const now = await this.chainNow();
    if (now >= core.resolutionTime) throw new SdkError("local/TRADING_CLOSED", ZH["local/TRADING_CLOSED"]);
    if (paused) throw new SdkError("local/MARKET_PAUSED", ZH["local/MARKET_PAUSED"]);

    const held = input.outcome === OUTCOME_YES ? holdings.yes : holdings.no;
    if (sharesIn > held) {
      throw new SdkError(
        "local/INSUFFICIENT_SHARES",
        `${ZH["local/INSUFFICIENT_SHARES"]}（持仓 ${held}，想卖 ${sharesIn}）`,
      );
    }
    const depth = core.yesReserve + core.noReserve;
    const impactCap = mulDivDown(depth, MAX_IMPACT_BPS, BPS);
    const impactBps = depth === 0n ? 0n : (sharesIn * BPS) / depth;
    if (sharesIn > impactCap) {
      throw new SdkError(
        "chain/IMPACT_TOO_HIGH",
        `${ZH["chain/IMPACT_TOO_HIGH"]}（本笔 ${sharesIn} > 上限 ${impactCap}）`,
      );
    }

    const localQuote = previewSellOffline({ yesReserve: core.yesReserve, noReserve: core.noReserve }, input.outcome, sharesIn, k.tradeFeeBps);
    if (localQuote !== onchainQuote) {
      throw new SdkError(
        "local/QUOTE_MISMATCH",
        `${ZH["local/QUOTE_MISMATCH"]}（本地 ${localQuote} / 链上 ${onchainQuote}）`,
      );
    }
    if (onchainQuote === 0n) throw new SdkError("chain/ZERO_SHARES", ZH["chain/ZERO_SHARES"]);

    const candidates: bigint[] = [];
    if (input.slippageBps !== undefined) {
      candidates.push(CentralPredictionSDK.minOutFromQuote(onchainQuote, input.slippageBps));
    }
    if (input.minAmountOut !== undefined) {
      candidates.push(this.assertMinOut(input.minAmountOut, onchainQuote, "minAmountOut"));
    }
    const minAmountOut = candidates.reduce((a, b) => (a > b ? a : b));

    return {
      to: this.engine,
      data:
        SEL.sellShares +
        bytes32Word(input.marketId) +
        uintWord(BigInt(input.outcome)) +
        uintWord(sharesIn) +
        uintWord(minAmountOut),
      value: "0x0",
      method: "sellShares",
      summary: `卖出 ${sharesIn.toString()} 份 ${input.outcome === OUTCOME_YES ? "YES" : "NO"}，最少换回 ${formatUsdc(minAmountOut)} USDC（报价 ${formatUsdc(onchainQuote)}）`,
      meta: {
        marketId: input.marketId,
        outcome: input.outcome === OUTCOME_YES ? "YES" : "NO",
        sharesIn: sharesIn.toString(),
        quote: onchainQuote.toString(),
        minAmountOut: minAmountOut.toString(),
        quotedAt: Date.now(),
        held: held.toString(),
        impactBps: impactBps.toString(),
        account,
      },
      ...(impactBps >= IMPACT_WARN_BPS ? { warning: "impact_near_limit" as const } : {}),
    };
  }

  /* ---------------------------- 提现 ---------------------------- */

  async buildRedeem(input: { marketId: Hex }): Promise<TxPlan> {
    const account = this.requireAccount();
    const [core, state, holdings, paused, k] = await Promise.all([
      this.marketCore(input.marketId),
      this.resolutionState(input.marketId),
      this.sharesOf(input.marketId, account),
      this.paused(),
      this.constants(),
    ]);
    if (!core.exists) throw new SdkError("local/MARKET_NOT_FOUND", ZH["local/MARKET_NOT_FOUND"]);
    if (!state.resolved) throw new SdkError("local/MARKET_NOT_RESOLVED", ZH["local/MARKET_NOT_RESOLVED"]);
    if (!state.finalized) {
      const endsAt = new Date(Number(state.disputeEndsAt) * 1000).toISOString();
      throw new SdkError(
        "chain/DISPUTE_WINDOW_OPEN",
        `${ZH["chain/DISPUTE_WINDOW_OPEN"]}（争议期至 ${endsAt}，Safe 仍可改判）`,
      );
    }
    if (holdings.yes === 0n && holdings.no === 0n) {
      throw new SdkError("chain/NOTHING_TO_REDEEM", ZH["chain/NOTHING_TO_REDEEM"]);
    }
    if (paused) {
      const now = await this.chainNow();
      // 与合约 redeemGuard 一致：结算 + 7 天后无视暂停
      if (now < core.resolutionTime + k.refundDelay) throw new SdkError("local/MARKET_PAUSED", ZH["local/MARKET_PAUSED"]);
    }

    const label = state.outcome === OUTCOME_INVALID ? "无效盘口（各赔 0.5）" : state.outcome === OUTCOME_YES ? "YES 赢家" : "NO 赢家";
    return {
      to: this.engine,
      data: SEL.redeem + bytes32Word(input.marketId),
      value: "0x0",
      method: "redeem",
      summary: `提取 ${label}：YES ${holdings.yes.toString()} / NO ${holdings.no.toString()} 份`,
      meta: {
        marketId: input.marketId,
        outcome: state.outcome,
        yesShares: holdings.yes.toString(),
        noShares: holdings.no.toString(),
        account,
      },
    };
  }

  /* ---------------------------- 裁决 ---------------------------- */

  async buildResolveMarket(input: { marketId: Hex; outcome: Outcome }): Promise<TxPlan> {
    this.assertOutcome(input.outcome);
    const account = this.requireAccount();
    const [core, state, canOracle, now] = await Promise.all([
      this.marketCore(input.marketId),
      this.resolutionState(input.marketId),
      this.canOracle(account),
      this.chainNow(),
    ]);
    if (!core.exists) throw new SdkError("local/MARKET_NOT_FOUND", ZH["local/MARKET_NOT_FOUND"]);
    if (!canOracle) throw new SdkError("local/NOT_ORACLE", ZH["local/NOT_ORACLE"]);
    if (state.resolved) throw new SdkError("local/MARKET_RESOLVED", ZH["local/MARKET_RESOLVED"]);
    if (now < core.resolutionTime) {
      throw new SdkError(
        "chain/TOO_EARLY_TO_RESOLVE",
        `${ZH["chain/TOO_EARLY_TO_RESOLVE"]}（结算时间 ${new Date(Number(core.resolutionTime) * 1000).toISOString()}）`,
      );
    }

    const k = await this.constants();
    return {
      to: this.engine,
      data: SEL.resolveMarket + bytes32Word(input.marketId) + uintWord(BigInt(input.outcome)),
      value: "0x0",
      method: "resolveMarket",
      summary: `裁定结果 ${outcomeLabel(input.outcome)}；提交后进入 ${k.disputeWindow / 3600n} 小时争议期，期间不可提现`,
      meta: {
        marketId: input.marketId,
        outcome: input.outcome,
        disputeWindow: k.disputeWindow.toString(),
        account,
      },
    };
  }

  async buildOverrideResolution(input: { marketId: Hex; newOutcome: Outcome }): Promise<TxPlan> {
    this.assertOutcome(input.newOutcome);
    const account = this.requireAccount();
    const [core, state, admin] = await Promise.all([
      this.marketCore(input.marketId),
      this.resolutionState(input.marketId),
      this.admin(),
    ]);
    if (!core.exists) throw new SdkError("local/MARKET_NOT_FOUND", ZH["local/MARKET_NOT_FOUND"]);
    if (account.toLowerCase() !== admin.toLowerCase()) {
      throw new SdkError("local/NOT_ADMIN", `${ZH["local/NOT_ADMIN"]}（admin=${admin}）`);
    }
    if (!state.resolved) throw new SdkError("local/MARKET_NOT_RESOLVED", ZH["local/MARKET_NOT_RESOLVED"]);
    if (state.finalized) throw new SdkError("local/ALREADY_FINAL", ZH["local/ALREADY_FINAL"]);
    if (!state.disputing) throw new SdkError("local/NOT_DISPUTING", ZH["local/NOT_DISPUTING"]);
    if (state.outcome === input.newOutcome) throw new SdkError("local/SAME_OUTCOME", ZH["local/SAME_OUTCOME"]);

    return {
      to: this.engine,
      data: SEL.overrideResolution + bytes32Word(input.marketId) + uintWord(BigInt(input.newOutcome)),
      value: "0x0",
      method: "overrideResolution",
      summary: `争议期改判：${outcomeLabel(state.outcome)} → ${outcomeLabel(input.newOutcome)}（窗口不会被延长）`,
      meta: {
        marketId: input.marketId,
        fromOutcome: state.outcome,
        toOutcome: input.newOutcome,
        disputeEndsAt: state.disputeEndsAt.toString(),
        account,
      },
    };
  }

  /* ---------------------------- 报价新鲜度 ---------------------------- */

  /**
   * 二次确认：签名/发送前重新拉一次报价，若价格已经跑到保护价之外，直接中止（不发交易）。
   * 这是防夹子的第二道闸 —— 第一道是 minSharesOut 本身。
   */
  async confirmQuoteStillValid(plan: TxPlan, maxAgeMs = 2_000): Promise<void> {
    if (plan.method !== "buyShares" && plan.method !== "sellShares") return;
    const marketId = String(plan.meta.marketId) as Hex;
    const outcome = plan.meta.outcome === "YES" ? OUTCOME_YES : OUTCOME_NO;
    const stamped = Number(plan.meta.quotedAt ?? 0);
    if (stamped && Date.now() - stamped > maxAgeMs) {
      throw new SdkError(
        "local/SLIPPAGE_TOO_LOOSE",
        `报价已过期（${Date.now() - stamped}ms > ${maxAgeMs}ms），请重新报价后再签名`,
      );
    }
    if (plan.method === "buyShares") {
      const amountIn = BigInt(String(plan.meta.amountIn));
      const minSharesOut = BigInt(String(plan.meta.minSharesOut));
      const fresh = await this.previewBuy(marketId, outcome, amountIn);
      if (fresh < minSharesOut) {
        throw new SdkError(
          "chain/SLIPPAGE_EXCEEDED",
          `价格已变动：当前只能拿到 ${fresh} 份，低于保护价 ${minSharesOut}，已中止`,
        );
      }
    } else {
      const sharesIn = BigInt(String(plan.meta.sharesIn));
      const minAmountOut = BigInt(String(plan.meta.minAmountOut));
      const fresh = await this.previewSell(marketId, outcome, sharesIn);
      if (fresh < minAmountOut) {
        throw new SdkError(
          "chain/SLIPPAGE_EXCEEDED",
          `价格已变动：当前只能换回 ${fresh}，低于保护价 ${minAmountOut}，已中止`,
        );
      }
    }
  }

  /* ---------------------------- 时间 ---------------------------- */

  /**
   * 链上时间。合约里所有时间比较都用 block.timestamp，本地墙钟可能与链上不一致
   * （测试链快进、节点时钟漂移），因此这里优先问链。
   */
  private async chainNow(): Promise<bigint> {
    if (this.transport.now) {
      try {
        const v = await this.transport.now();
        return BigInt(v);
      } catch {
        /* 落到墙钟 */
      }
    }
    return BigInt(Math.floor(Date.now() / 1000));
  }
}

/* ============================== 小工具 ============================== */

export function outcomeLabel(o: number): string {
  return o === OUTCOME_YES ? "YES" : o === OUTCOME_NO ? "NO" : "INVALID";
}

/** 6 位小数 USDC → 人类可读 */
export function formatUsdc(v: bigint, decimals = 6): string {
  const s = v.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

/** 人类可读 USDC → 最小单位（拒绝小数超过 6 位） */
export function parseUsdc(v: string | number, decimals = 6): bigint {
  const str = typeof v === "number" ? v.toFixed(decimals) : v.trim();
  if (!/^\d+(\.\d+)?$/.test(str)) throw new SdkError("local/BAD_AMOUNT", `无法解析的 USDC 金额：${str}`);
  const [int, frac = ""] = str.split(".");
  if (frac.length > decimals) throw new SdkError("local/BAD_AMOUNT", `USDC 最多 ${decimals} 位小数`);
  return BigInt(int + frac.padEnd(decimals, "0"));
}


/* ============================== Multicall3 ============================== */

/** Base / 所有主流链同一个地址的 Multicall3 */
export const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";
/** aggregate3((address,bool,bytes)[]) */
export const SEL_AGGREGATE3: Hex = "0x82ad56cb";

export interface MulticallCall {
  target: Address;
  allowFailure: boolean;
  data: Hex;
}

export interface MulticallResult {
  success: boolean;
  data: Hex;
}

/** 一个盘口的全部「列表页需要」字段，一次 RPC 拿齐 */
export interface MarketSnapshot {
  marketId: Hex;
  exists: boolean;
  /** 1e18 精度，直接 ×100 就是百分比 */
  priceYes: bigint;
  priceNo: bigint;
  /** yesReserve + noReserve（6 位 USDC 最小单位） */
  depth: bigint;
  /** 池子两侧储备，前端做离线报价要用 */
  yesReserve: bigint;
  noReserve: bigint;
  resolved: boolean;
  finalized: boolean;
  disputing: boolean;
  outcome: Outcome;
  disputeEndsAt: bigint;
  resolutionTime: bigint;
  cash: bigint;
  owed: bigint;
  totalVolume: bigint;
  tradingOpen: boolean;
  /** withMeta: true 时才有 */
  question?: string;
  category?: string;
}

/** 编码 `aggregate3([(address,bool,bytes)...])` —— 数组元素是动态 tuple，注意两级偏移 */
export function encodeAggregate3(calls: MulticallCall[]): Hex {
  const head: string[] = [];
  const bodies: string[] = [];
  for (const c of calls) {
    const bytesHex = strip0x(c.data);
    const len = bytesHex.length / 2;
    const padded = bytesHex.padEnd(Math.ceil(bytesHex.length / 64) * 64, "0");
    // tuple 内部：address, bool, offset-to-bytes(=0x60)
    bodies.push(addressWord(c.target) + uintWord(c.allowFailure ? 1n : 0n) + uintWord(96n) + uintWord(BigInt(len)) + padded);
  }
  // 数组元素的偏移是相对「长度字之后」起算
  let cursor = 32 * calls.length;
  for (const b of bodies) {
    head.push(uintWord(BigInt(cursor)));
    cursor += b.length / 2;
  }
  return (SEL_AGGREGATE3 + uintWord(32n) + uintWord(BigInt(calls.length)) + head.join("") + bodies.join("")) as Hex;
}

/** 解码 aggregate3 的返回值 `(bool,bytes)[]` */
export function decodeAggregate3Result(raw: string): MulticallResult[] {
  const body = strip0x(raw);
  if (body.length < 64) return [];
  const arrOff = Number(BigInt("0x" + body.slice(0, 64))) * 2;
  const n = Number(BigInt("0x" + body.slice(arrOff, arrOff + 64)));
  const offsetsBase = arrOff + 64; // 元素偏移相对这里起算
  const out: MulticallResult[] = [];
  for (let i = 0; i < n; i += 1) {
    const rel = Number(BigInt("0x" + body.slice(offsetsBase + i * 64, offsetsBase + (i + 1) * 64))) * 2;
    const elem = offsetsBase + rel;
    const success = BigInt("0x" + body.slice(elem, elem + 64)) !== 0n;
    const bytesRel = Number(BigInt("0x" + body.slice(elem + 64, elem + 128))) * 2;
    if (!success) {
      out.push({ success: false, data: "0x" });
      continue;
    }
    const lenPos = elem + bytesRel;
    const len = Number(BigInt("0x" + body.slice(lenPos, lenPos + 64)));
    out.push({ success: true, data: ("0x" + body.slice(lenPos + 64, lenPos + 64 + len * 2)) as Hex });
  }
  return out;
}

function blankSnapshot(marketId: Hex): MarketSnapshot {
  return {
    marketId,
    exists: false,
    priceYes: 0n,
    priceNo: 0n,
    depth: 0n,
    yesReserve: 0n,
    noReserve: 0n,
    resolved: false,
    finalized: false,
    disputing: false,
    outcome: 0 as Outcome,
    disputeEndsAt: 0n,
    resolutionTime: 0n,
    cash: 0n,
    owed: 0n,
    totalVolume: 0n,
    tradingOpen: false,
  };
}

function decodeCore(raw: string): MarketState {
  return {
    yesReserve: word(raw, 0),
    noReserve: word(raw, 1),
    cash: word(raw, 2),
    owed: word(raw, 3),
    totalVolume: word(raw, 4),
    resolutionTime: word(raw, 5),
    createdAt: word(raw, 6),
    creator: "0x" + strip0x(raw).slice(7 * 64 + 24, 8 * 64),
    outcome: Number(word(raw, 8)),
    resolved: word(raw, 9) !== 0n,
    exists: word(raw, 10) !== 0n,
  };
}

function decodeResolution(raw: string): {
  resolved: boolean;
  finalized: boolean;
  disputing: boolean;
  outcome: Outcome;
  disputeEndsAt: bigint;
  owed: bigint;
} {
  return {
    resolved: word(raw, 0) !== 0n,
    finalized: word(raw, 1) !== 0n,
    disputing: word(raw, 2) !== 0n,
    outcome: Number(word(raw, 3)) as Outcome,
    disputeEndsAt: word(raw, 4),
    owed: word(raw, 5),
  };
}

/* ============================== 事件解码 ============================== */

/**
 * 引擎全部 19 个事件的 topic0 —— 全部由 `cast keccak "<signature>"` 实算，
 * 测试里逐条重算比对（不手抄）。
 */
export const EVENT_TOPICS = {
  MarketCreated: "0x3d0c3bb1f9482c4ad3a5509d3d6d54de6d32d5a1b985684b26c87f30397a1444",
  MarketCategoryUpdated: "0x4b7bc008a5a283c9e7ae3cb79b48e3bff45e0342c20bcd256bddc0d86235ff58",
  LiquiditySeeded: "0x7f2255e9a045f5c484fedb7a134714970baf201bf2fc91137b57c9cea9107abf",
  SharesBought: "0xf21c4ac9a2ac6238a9a299dec03abcc164b74fa85e7d949380f9d657a08f5fa9",
  SharesSold: "0xbd3359e97cfa42d22e4990274c9d107f729226723ce88917de14e1b1d6eab510",
  MarketResolved: "0xdc6b74a8565b9b4f27a28d1db787d3642a813a7c95076b6852565d1f20f97dd4",
  DisputeWindowOpened: "0xcaa830a2de04c83ebc48cb202b8975002881745aaf7d4ff0f8bf598fbb178582",
  ResolutionOverridden: "0xb6da6c9439220c2f1d5c953a57d5ae11c04911a2fd99466c0acb24ef4791275d",
  ResolutionFinalized: "0xc1b5f003dd9f01f287f7e67954b5104c2edb995fb6944923625f17aede11d557",
  Redeemed: "0xce1753e289e102c9616153276d541a05a0cb177b21ebeb8f60b5a877ac9a332f",
  ResidualSwept: "0x00b30742a93ffbccc887d87b2b5b201e2361bc0fab8cf019da636127d31bc41b",
  FeeVaultUpdated: "0x47ffc4777a9849fd88ac272225845f7bbcfa9920f222b459c2e6b28156ce7249",
  TreasuryUpdated: "0x4ab5be82436d353e61ca18726e984e561f5c1cc7c6d38b29d2553c790434705a",
  CreatorUpdated: "0x410c2ab87e0e64123dd9801d714205b45a1c84823591e05076b37449379427fc",
  OracleUpdated: "0x94c9cbe1d9aa7af08484f82ab0179d6db973a391236668c34192d954ff32c06c",
  Paused: "0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258",
  Unpaused: "0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa",
  AdminTransferStarted: "0xe5cd1c804f1c9cc6d7009e4c0fb532f0e2d8863524c3323a6b3790c3f80bf25c",
  AdminTransferred: "0xf8ccb027dfcd135e000e9d45e6cc2d662578a8825d4c45b5e32e0adf67e79ec6",
} as const;

export type EventName = keyof typeof EVENT_TOPICS;
type FieldType = "bytes32" | "address" | "uint256" | "uint8" | "bool" | "string";

interface FieldSpec {
  name: string;
  type: FieldType;
  indexed: boolean;
}

const EVENT_FIELDS: Record<EventName, FieldSpec[]> = {
  MarketCreated: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "creator", type: "address", indexed: true },
    { name: "question", type: "string", indexed: false },
    { name: "category", type: "string", indexed: false },
    { name: "resolutionTime", type: "uint256", indexed: false },
  ],
  MarketCategoryUpdated: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "category", type: "string", indexed: false },
  ],
  LiquiditySeeded: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "provider", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ],
  SharesBought: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "buyer", type: "address", indexed: true },
    { name: "outcome", type: "uint8", indexed: false },
    { name: "amountIn", type: "uint256", indexed: false },
    { name: "fee", type: "uint256", indexed: false },
    { name: "sharesOut", type: "uint256", indexed: false },
    { name: "priceYes", type: "uint256", indexed: false },
  ],
  SharesSold: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "seller", type: "address", indexed: true },
    { name: "outcome", type: "uint8", indexed: false },
    { name: "sharesIn", type: "uint256", indexed: false },
    { name: "fee", type: "uint256", indexed: false },
    { name: "amountOut", type: "uint256", indexed: false },
    { name: "priceYes", type: "uint256", indexed: false },
  ],
  MarketResolved: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "outcome", type: "uint8", indexed: false },
    { name: "resolvedAt", type: "uint256", indexed: false },
    { name: "emergency", type: "bool", indexed: false },
    { name: "owed", type: "uint256", indexed: false },
  ],
  DisputeWindowOpened: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "outcome", type: "uint8", indexed: false },
    { name: "disputeEndsAt", type: "uint256", indexed: false },
    { name: "owed", type: "uint256", indexed: false },
  ],
  ResolutionOverridden: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "oldOutcome", type: "uint8", indexed: false },
    { name: "newOutcome", type: "uint8", indexed: false },
    { name: "newOwed", type: "uint256", indexed: false },
    { name: "disputes", type: "uint8", indexed: false },
  ],
  ResolutionFinalized: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "outcome", type: "uint8", indexed: false },
    { name: "finalizedAt", type: "uint256", indexed: false },
  ],
  Redeemed: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "account", type: "address", indexed: true },
    { name: "yesBurned", type: "uint256", indexed: false },
    { name: "noBurned", type: "uint256", indexed: false },
    { name: "payout", type: "uint256", indexed: false },
    { name: "fee", type: "uint256", indexed: false },
  ],
  ResidualSwept: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ],
  FeeVaultUpdated: [
    { name: "oldVault", type: "address", indexed: true },
    { name: "newVault", type: "address", indexed: true },
  ],
  TreasuryUpdated: [
    { name: "oldTreasury", type: "address", indexed: true },
    { name: "newTreasury", type: "address", indexed: true },
  ],
  CreatorUpdated: [
    { name: "creator", type: "address", indexed: true },
    { name: "allowed", type: "bool", indexed: false },
  ],
  OracleUpdated: [
    { name: "oracle", type: "address", indexed: true },
    { name: "allowed", type: "bool", indexed: false },
  ],
  Paused: [{ name: "account", type: "address", indexed: false }],
  Unpaused: [{ name: "account", type: "address", indexed: false }],
  AdminTransferStarted: [
    { name: "oldAdmin", type: "address", indexed: true },
    { name: "newAdmin", type: "address", indexed: true },
  ],
  AdminTransferred: [
    { name: "oldAdmin", type: "address", indexed: true },
    { name: "newAdmin", type: "address", indexed: true },
  ],
};

export type EventArg = string | bigint | boolean | number;

export interface DecodedEvent {
  name: EventName;
  topic: Hex;
  args: Record<string, EventArg>;
  /** 原日志里的 logIndex，便于排序/去重 */
  logIndex?: number;
  blockNumber?: number;
  transactionHash?: string;
}

/** 已知事件名 → topic0 */
export function eventTopic(name: EventName): Hex {
  return EVENT_TOPICS[name];
}

/** 反查：topic0 → 事件名（不区分大小写） */
export function eventNameOf(topic: string): EventName | null {
  const t = topic.toLowerCase();
  for (const [name, tp] of Object.entries(EVENT_TOPICS)) {
    if (tp.toLowerCase() === t) return name as EventName;
  }
  return null;
}

export interface RawLog {
  address?: string;
  topics: string[];
  data: string;
  logIndex?: string | number;
  blockNumber?: string | number;
  transactionHash?: string;
}

/**
 * 解一条日志。不是本引擎的事件（或未知 topic）返回 null —— 不抛错，
 * 因为前端拿到的 receipt 里本来就混着别的合约的日志（USDC Transfer 等）。
 */
export function decodeLog(log: RawLog): DecodedEvent | null {
  const name = log.topics[0] ? eventNameOf(log.topics[0]) : null;
  if (!name) return null;
  const specs = EVENT_FIELDS[name];
  const body = strip0x(log.data ?? "0x");
  const headWords: bigint[] = [];
  const headCount = specs.filter((f) => !f.indexed).length;
  for (let i = 0; i < headCount; i += 1) {
    headWords.push(BigInt("0x" + (body.slice(i * 64, (i + 1) * 64) || "0")));
  }

  const args: Record<string, EventArg> = {};
  let topicIdx = 1;
  let headIdx = 0;
  for (const f of specs) {
    if (f.indexed) {
      const t = log.topics[topicIdx] ?? "0x";
      topicIdx += 1;
      args[f.name] = decodeSingleWord(t, f.type);
      continue;
    }
    if (f.type === "string") {
      const off = Number(headWords[headIdx]) * 2;
      headIdx += 1;
      const len = Number(BigInt("0x" + body.slice(off, off + 64)));
      const hex = body.slice(off + 64, off + 64 + len * 2);
      args[f.name] = hexToUtf8(hex);
      continue;
    }
    args[f.name] = decodeSingleWord("0x" + headWords[headIdx].toString(16).padStart(64, "0"), f.type);
    headIdx += 1;
  }
  return {
    name,
    topic: log.topics[0] as Hex,
    args,
    ...(log.logIndex !== undefined ? { logIndex: Number(log.logIndex) } : {}),
    ...(log.blockNumber !== undefined ? { blockNumber: Number(log.blockNumber) } : {}),
    ...(log.transactionHash !== undefined ? { transactionHash: log.transactionHash } : {}),
  };
}

/** 批量解日志：自动丢掉不认识的（USDC Transfer、别的合约的事件） */
export function decodeLogs(logs: RawLog[]): DecodedEvent[] {
  const out: DecodedEvent[] = [];
  for (const log of logs) {
    const ev = decodeLog(log);
    if (ev) out.push(ev);
  }
  return out;
}

function decodeSingleWord(wordHex: string, type: FieldType): EventArg {
  const body = strip0x(wordHex).padStart(64, "0");
  switch (type) {
    case "address":
      return "0x" + body.slice(24, 64);
    case "bool":
      return BigInt("0x" + body) !== 0n;
    case "uint8":
      return Number(BigInt("0x" + body));
    case "uint256":
      return BigInt("0x" + body);
    case "bytes32":
      return "0x" + body;
    default:
      return "0x" + body;
  }
}
