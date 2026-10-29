/**
 * PredictionSDK — 前端安全交互辅助库
 *
 * ⚠️ 合约绑定的现状（2026-10-25 架构切换后）：
 *    本文件里的 calldata 编码器绑定的是**旧架构**（PredictionFactory + 每盘口一个 PredictionVault），
 *    那两个合约已经归档到 `../legacy/contracts/`，不再是主网要部署的东西。
 *    主网新架构是 `CentralPredictionEngine`（单合约多盘口），它的调用面在
 *    `../docs/CENTRAL-ENGINE.md` 里有完整签名表，前端接新引擎时**不能**直接复用这里的 vault 选择器。
 *    可以原样复用的是与合约无关的那一层：MEV 路由表、`submitProtected`、
 *    `assertPlanIntegrity`、`confirmQuoteStillValid`、`waitForReceipt`。
 *    基于新引擎的 SDK 已经写好：`./CentralPredictionSDK.ts`（44 条单测 + `script/e2e-sdk-central.sh` 真链联调）。
 *    新项目请直接用那一个，本文件只作为历史回归与 MEV 提交层的参考。
 *
 * 解决的问题：`minSharesOut` 如果前端传 0（或随手写个 1），用户的成交价就完全裸奔，
 * 任何人都能在同一区块里把你的单子夹成任何价格。
 *
 * 本库的设计约束（刻意为之）：
 *   1. **不暴露任何"直接传 minSharesOut"的接口**。唯一的入场是
 *      `buildBuy({ amountIn, slippageBps })`，minSharesOut 由 previewBuy 现算现用。
 *   2. `slippageBps` 必须在 [1, 500] 内。传 0 直接抛错 —— 从代码层禁止裸奔。
 *   3. 发交易前先做完整 preflight（最低下注 / 影响上限 / 已结算 / 暂停 / 深度），
 *      有问题在本地就抛错，不浪费用户 gas。
 *   4. 零依赖：只要求调用方传入一个 `ethCall(to, data)`，可对接 viem / ethers / wagmi。
 *
 * 用法：
 *   const sdk = new PredictionSDK(transport, { vault: "0x..." });
 *   const tx  = await sdk.buildBuy({ outcome: 1, amountIn: 100_000_000n, slippageBps: 100 });
 *   await wallet.sendTransaction(tx);
 */

/* ---------------------------------- 类型 ---------------------------------- */

export interface EthCallTransport {
  /** 发起 eth_call，返回 0x 开头的十六进制返回值 */
  ethCall(to: string, data: string): Promise<string>;
  /**
   * 可选：把已签名交易发给指定路由（eth_sendRawTransaction）。
   * 私有中继 / MEV 保护端点都走这个口子；不实现也能用 SDK 的报价与编码功能。
   */
  sendRawTransaction?(route: SubmissionRoute, rawTx: string): Promise<string>;
  /** 可选：查交易回执，用于确认"私有路由超时"到底上链了没有 */
  getTransactionReceipt?(hash: string): Promise<TransactionReceipt | null>;
}

export interface TransactionReceipt {
  status?: string;
  blockNumber?: string;
  transactionHash?: string;
}

/** 路由的隐私等级：决定超时后能不能安全地回退到下一个端点 */
export type RoutePrivacy =
  /** 私有中继（Flashbots Protect 一类）：对公网 mempool 不可见 */
  | "private-relay"
  /** 链本身没有公开 mempool，交易直塞排序器（Base / OP Stack 系） */
  | "sequencer-private"
  /** 普通公开 RPC：可见即可被抢 */
  | "public";

export interface SubmissionRoute {
  id: string;
  chainId: number;
  url: string;
  privacy: RoutePrivacy;
  /** 端点是否需要账号 / API key（SDK 不内置任何 key） */
  requiresAccount?: boolean;
  note: string;
}

export interface SubmissionOptions {
  /** 覆盖默认路由表（按优先级从上到下尝试） */
  routes?: SubmissionRoute[];
  /** 单次提交的超时，默认 4000ms */
  submitTimeoutMs?: number;
  /** 报价新鲜度上限，默认 2000ms（Base 出块 ~2s） */
  maxQuoteAgeMs?: number;
  /** 提交前允许的报价下滑，默认等于 buildBuy 的 slippageBps */
  maxDriftBps?: number;
}

/** 把 {to,data,value} 签名成 rawTx；由调用方接 viem/ethers 钱包 */
export type TxSigner = (tx: { to: string; data: string; value: "0x0" }) => Promise<string>;

export interface SdkOptions {
  /** PredictionVault 克隆地址 */
  vault: string;
  /** PredictionFactory 地址（只有调 buildCreateMarket 时才需要） */
  factory?: string;
  /** 单笔影响上限的安全余量，默认 0（严格按合约值） */
  impactSafetyMarginBps?: number;
  /** 链 id：决定默认路由表（1 = ETH 主网、8453 = Base 主网、84532 = Base Sepolia） */
  chainId?: number;
  /** 额外/覆盖的提交路由（例如自己买的 MEV 保护私有 RPC） */
  routes?: SubmissionRoute[];
  /** 默认单次提交超时，默认 4000ms */
  submitTimeoutMs?: number;
  /** 默认报价新鲜度上限，默认 2000ms */
  maxQuoteAgeMs?: number;
}

export type Outcome = 0 | 1; // 0 = NO, 1 = YES

export interface MarketState {
  resolved: boolean;
  outcome: number;
  tradingOpen: boolean;
  paused: boolean;
  resolutionTime: number;
  minBet: bigint;
  maxBet: bigint;
  maxImpactBps: bigint;
  yesReserve: bigint;
  noReserve: bigint;
  depth: bigint;
  priceYes: bigint;
  priceNo: bigint;
  totalLpShares: bigint;
  /** 链上交易费率（bps），不硬编码，避免合约升级后 SDK 静默算错 */
  tradeFeeBps: bigint;
}

export interface BuyRequest {
  outcome: Outcome;
  /** 支付金额（USDC 最小单位，6 位小数） */
  amountIn: bigint;
  /** 可接受滑点，单位 bps。允许 1..500（0 = 裸奔，禁止） */
  slippageBps: number;
}

export interface TradePlan {
  to: string;
  data: string;
  value: "0x0";
  /** 便于 UI 展示 */
  quote: {
    amountIn: bigint;
    expectedSharesOut: bigint;
    minSharesOut: bigint;
    slippageBps: number;
    priceImpactBps: number;
    effectivePrice: number;
    /** 报价生成时间（ms），用于提交前的新鲜度校验 */
    quotedAt: number;
  };
}

export class SdkError extends Error {
  constructor(
    public readonly code: SdkErrorCode,
    message: string,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SdkError";
  }
}

export type SdkErrorCode =
  | "SLIPPAGE_NOT_SET"
  | "SLIPPAGE_TOO_HIGH"
  | "BELOW_MIN_BET"
  | "ABOVE_MAX_BET"
  | "IMPACT_TOO_HIGH"
  | "MARKET_RESOLVED"
  | "TRADING_PAUSED"
  | "ZERO_SHARES"
  | "INSUFFICIENT_DEPTH"
  | "BAD_OUTCOME"
  | "BAD_RESPONSE"
  | "MARKET_NOT_RESOLVED"
  | "NOTHING_TO_REDEEM"
  | "NOT_ADMIN"
  | "NOT_PENDING_ADMIN"
  | "BAD_CONFIG"
  // ---- MEV / 提交路由 / 报价新鲜度 ----
  | "NO_ROUTE"
  | "ROUTE_UNAVAILABLE"
  | "SUBMIT_AMBIGUOUS"
  | "NETWORK_TIMEOUT"
  | "QUOTE_STALE"
  | "BAD_PLAN"
  | "RECEIPT_TIMEOUT";

/* -------------------------------- ABI 常量 -------------------------------- */

/** cast sig "previewBuy(uint8,uint256)" */
const SEL_PREVIEW_BUY = "0x5e573804";
/** cast sig "buy(uint8,uint256,uint256)" */
const SEL_BUY = "0xf6d956df";
/** cast sig "sell(uint8,uint256,uint256)" */
const SEL_SELL = "0x46280a80";

/** cast sig "transferAdmin(address)" */
const SEL_TRANSFER_ADMIN = "0x75829def";
/** cast sig "acceptAdmin()" */
const SEL_ACCEPT_ADMIN = "0x0e18b681";
/** cast sig "createMarket(bytes32,address,uint256,uint256,uint256,uint256)" */
const SEL_CREATE_MARKET = "0x0ca07ff7";

const SEL = {
  resolved: "0x3f6fa655",
  outcome: "0x27793f87",
  tradingOpen: "0xffb54a99",
  paused: "0x5c975abb",
  resolutionTime: "0xf3e41e90",
  minBet: "0x9619367d",
  maxBet: "0x2e5b2168",
  maxImpactBps: "0x3bcb3259",
  yesReserve: "0xb2670d74",
  noReserve: "0x72a9fa6e",
  depth: "0x631c56ef",
  priceYes: "0x089ef5e8",
  priceNo: "0xbe0bfb9c",
  tradeFeeBps: "0x9185f598",
  buy: SEL_BUY,
  sell: SEL_SELL,
  totalLpShares: "0x0fd4f78d",
  admin: "0xf851a440",
  pendingAdmin: "0x26782247",
} as const;

/**
 * 合约自定义错误 -> 前端错误码。
 * 自定义错误只有 4 字节，理论上有碰撞可能；因此这张表只用于「把链上 revert 翻译成人话」，
 * 真正的拦截仍以本地 preflight 为准。
 */
const REVERT_MAP: Record<string, SdkErrorCode> = {
  "0xb8ab88d4": "ABOVE_MAX_BET", // AboveMaxBet()
  "0x5688ffb3": "BELOW_MIN_BET", // BelowMinBet()
  "0x22410594": "IMPACT_TOO_HIGH", // ImpactTooHigh()
  "0x8199f5f3": "ZERO_SHARES", // SlippageExceeded()（成交不足）
  "0xd93c0665": "TRADING_PAUSED", // EnforcedPause()
  "0x1db9461a": "MARKET_RESOLVED", // MarketResolvedAlready()
  "0xe2c865df": "TRADING_PAUSED", // TradingClosed()
  "0x9f4a6489": "MARKET_NOT_RESOLVED", // NotResolved()
  "0x9890af60": "NOTHING_TO_REDEEM", // NothingToRedeem()
  "0x9811e0c7": "ZERO_SHARES", // ZeroShares()
  "0xbb55fd27": "INSUFFICIENT_DEPTH", // InsufficientLiquidity()
  "0x47556579": "NOT_ADMIN", // OnlyAdmin()
  "0x058d9a1b": "NOT_PENDING_ADMIN", // NotPendingAdmin()
  "0xf98175ba": "BAD_CONFIG", // InvalidMinBet()
  "0x03235eab": "BAD_CONFIG", // InvalidMaxBet()
  "0xc865b21a": "BAD_CONFIG", // InvalidMaxImpact()
  "0x10549aa0": "BAD_CONFIG", // InvalidResolutionTime()
};

/** 给前端直接弹 toast 的中文文案 */
export const ERROR_MESSAGES: Record<SdkErrorCode, string> = {
  SLIPPAGE_NOT_SET: "请先设置滑点保护（不能为 0），否则成交价可能被抢跑",
  SLIPPAGE_TOO_HIGH: "滑点容忍度不能超过 5%",
  BELOW_MIN_BET: "单笔下注不能低于 5 USDC",
  ABOVE_MAX_BET: "单笔下注不能超过 10,000 USDC",
  IMPACT_TOO_HIGH: "该笔金额占池子比例过大，请减少下单金额",
  MARKET_RESOLVED: "该盘口已结算，无法继续交易",
  TRADING_PAUSED: "该盘口已暂停交易，请稍后再试",
  ZERO_SHARES: "下单金额过小，成交份额为 0，请加大金额",
  INSUFFICIENT_DEPTH: "池子流动性不足，无法承接该笔交易",
  BAD_OUTCOME: "只支持 YES(1) 或 NO(0)",
  BAD_RESPONSE: "链上返回数据异常，请刷新重试",
  MARKET_NOT_RESOLVED: "盘口尚未结算",
  NOTHING_TO_REDEEM: "你没有可赎回的份额",
  NOT_ADMIN: "只有管理员可以执行该操作",
  NOT_PENDING_ADMIN: "只有被指定的待接收管理员才能完成交接（acceptAdmin）",
  NO_ROUTE: "当前链没有可用的交易提交路由，请配置私有 RPC 或改用钱包默认网络",
  ROUTE_UNAVAILABLE: "私有交易路由不可用（缺 key / 端点异常），交易未发出",
  SUBMIT_AMBIGUOUS: "私有路由超时，无法确认交易是否已被接收：请先用交易哈希查回执，禁止直接重发",
  NETWORK_TIMEOUT: "节点响应超时，报价已失效，请重试",
  QUOTE_STALE: "价格在你确认期间已经跑出滑点容忍范围，已拦截，未发交易",
  BAD_PLAN: "交易数据被改动或与报价不一致，已拦截",
  RECEIPT_TIMEOUT: "等待回执超时，交易可能仍在打包，请稍后在浏览器确认",
  BAD_CONFIG: "盘口参数不合法（请检查起投额 / 单笔上限 / 影响上限）",
};

const BPS = 10_000n;
const MAX_SLIPPAGE_BPS = 500; // 5%
const MIN_SLIPPAGE_BPS = 1;
const DEFAULT_SUBMIT_TIMEOUT_MS = 4_000;
const DEFAULT_QUOTE_MAX_AGE_MS = 2_000;

/* ------------------------------ 提交路由表 ------------------------------ */

/**
 * 已知可用的提交路由（截至本版本实测/官方文档确认）：
 *  - Flashbots Protect 官方只支持以太坊主网(1) 与 Sepolia(11155111)，**不支持 Base**；
 *    把 Base 交易往 rpc.flashbots.net 发会被直接拒绝，所以这里不骗人。
 *  - Base 是 OP Stack 单排序器，**没有公开 pending mempool**：交易直塞 sequencer 队列，
 *    传统"监听 mempool 抢跑"不成立；残余风险是 RPC 层可见性、Flashblocks 预确认可观测性、
 *    以及把交易转卖给搜索者的中间商。要更硬的隐私，用下面的 mevProtectedRoute() 接自己的私有端点。
 */
export const KNOWN_ROUTES: readonly SubmissionRoute[] = [
  {
    id: "flashbots-protect",
    chainId: 1,
    url: "https://rpc.flashbots.net/fast",
    privacy: "private-relay",
    requiresAccount: false,
    note: "Flashbots Protect（以太坊主网）：隐藏于公开 mempool，失败交易不上链不收费",
  },
  {
    id: "flashbots-protect-sepolia",
    chainId: 11155111,
    url: "https://rpc-sepolia.flashbots.net",
    privacy: "private-relay",
    requiresAccount: false,
    note: "Flashbots Protect（Sepolia 测试网）",
  },
  {
    id: "base-mainnet-sequencer",
    chainId: 8453,
    url: "https://mainnet.base.org",
    privacy: "sequencer-private",
    note: "Base 主网官方 RPC：无私聊 mempool，交易直达 sequencer 队列（非隐私中继）",
  },
  {
    id: "base-sepolia-sequencer",
    chainId: 84532,
    url: "https://sepolia.base.org",
    privacy: "sequencer-private",
    note: "Base Sepolia 官方 RPC：同上，仅作灰度验证",
  },
];

/**
 * 构造一个外部 MEV 保护 / 私有路由（如按量付费的 provider 私有 RPC）。
 * SDK 不内置任何 URL 与 API key —— 端点必须由调用方提供，避免"看起来受保护其实没配"。
 */
export function mevProtectedRoute(params: {
  id?: string;
  chainId: number;
  url: string;
  requiresAccount?: boolean;
  note?: string;
}): SubmissionRoute {
  if (!/^https?:\/\//.test(params.url)) {
    throw new SdkError("BAD_CONFIG", `invalid route url: ${params.url}`);
  }
  return {
    id: params.id ?? `private-${params.chainId}`,
    chainId: params.chainId,
    url: params.url,
    privacy: "private-relay",
    requiresAccount: params.requiresAccount ?? true,
    note: params.note ?? "自定义私有路由（MEV 保护 / 私有 mempool），凭据由调用方管理",
  };
}

const PRIVACY_RANK: Record<RoutePrivacy, number> = {
  "private-relay": 0,
  "sequencer-private": 1,
  public: 2,
};

/**
 * 按链筛路由并排优先级（私有中继 > 排序器私有 > 公开），自定义路由永远排在最前。
 * 未知链返回空数组 —— 宁可抛 NO_ROUTE，也不静默降级到公开 RPC。
 */
export function routesForChain(chainId: number, extra: SubmissionRoute[] = []): SubmissionRoute[] {
  const promoted = extra.filter((r) => r.chainId === chainId);
  const known = KNOWN_ROUTES.filter((r) => r.chainId === chainId);
  const seen = new Set<string>();
  const merged: SubmissionRoute[] = [];
  for (const r of [...promoted, ...known]) {
    const key = r.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
  }
  return merged.sort((a, b) => PRIVACY_RANK[a.privacy] - PRIVACY_RANK[b.privacy]);
}

/** 超时包装：网络抖动时不让前端无限挂起，统一抛带 code 的 SdkError */
function withTimeout<T>(p: Promise<T>, ms: number, code: SdkErrorCode, what = "rpc"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SdkError(code, `${what} timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/* ------------------------------ ABI 编解码 ------------------------------ */

function padAddress(a: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new SdkError("BAD_CONFIG", `invalid address: ${a}`);
  return a.slice(2).toLowerCase().padStart(64, "0");
}

function padBytes32(h: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(h)) throw new SdkError("BAD_CONFIG", `invalid bytes32: ${h}`);
  return h.slice(2).toLowerCase();
}

function padWord(v: bigint): string {
  if (v < 0n) throw new Error("negative uint");
  return v.toString(16).padStart(64, "0");
}

function word(data: string, index = 0): bigint {
  const clean = data.startsWith("0x") ? data.slice(2) : data;
  const chunk = clean.slice(index * 64, index * 64 + 64);
  if (chunk.length !== 64) {
    throw new SdkError("BAD_RESPONSE", `malformed return data (len=${clean.length})`);
  }
  return BigInt("0x" + chunk);
}

function ceilDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("div by zero");
  return (a + b - 1n) / b;
}

function bool(data: string): boolean {
  return word(data) !== 0n;
}

/** 把 32 字节 ABI word 还原成小写 0x 地址（低 20 字节） */
function addr(data: string): string {
  return "0x" + word(data).toString(16).padStart(40, "0").slice(-40);
}

/* --------------------------------- 主类 ---------------------------------- */

export class PredictionSDK {
  private readonly vault: string;
  private readonly factory?: string;
  private readonly impactMarginBps: number;
  private readonly chainId?: number;
  private readonly routes: SubmissionRoute[];
  private readonly submitTimeoutMs: number;
  private readonly maxQuoteAgeMs: number;

  constructor(
    private readonly transport: EthCallTransport,
    opts: SdkOptions,
  ) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(opts.vault)) {
      throw new Error(`invalid vault address: ${opts.vault}`);
    }
    this.vault = opts.vault;
    this.factory = opts.factory;
    if (opts.factory && !/^0x[0-9a-fA-F]{40}$/.test(opts.factory)) {
      throw new Error(`invalid factory address: ${opts.factory}`);
    }
    this.impactMarginBps = opts.impactSafetyMarginBps ?? 0;
    this.chainId = opts.chainId;
    this.routes = opts.routes ?? (opts.chainId === undefined ? [] : routesForChain(opts.chainId));
    this.submitTimeoutMs = opts.submitTimeoutMs ?? DEFAULT_SUBMIT_TIMEOUT_MS;
    this.maxQuoteAgeMs = opts.maxQuoteAgeMs ?? DEFAULT_QUOTE_MAX_AGE_MS;
  }

  /* ----------------------------- 行情读取 ----------------------------- */

  async getMarketState(): Promise<MarketState> {
    const [resolved, outcome, tradingOpen, paused, resolutionTime, minBet, maxBet, maxImpactBps, yesReserve, noReserve, depth, priceYes, priceNo, totalLpShares, tradeFeeBps] =
      await Promise.all([
        this.call(SEL.resolved).then(bool),
        this.call(SEL.outcome).then((d) => Number(word(d))),
        this.call(SEL.tradingOpen).then(bool),
        this.call(SEL.paused).then(bool),
        this.call(SEL.resolutionTime).then((d) => Number(word(d))),
        this.call(SEL.minBet).then(word),
        this.call(SEL.maxBet).then(word),
        this.call(SEL.maxImpactBps).then(word),
        this.call(SEL.yesReserve).then(word),
        this.call(SEL.noReserve).then(word),
        this.call(SEL.depth).then(word),
        this.call(SEL.priceYes).then(word),
        this.call(SEL.priceNo).then(word),
        this.call(SEL.totalLpShares).then(word),
        this.call(SEL.tradeFeeBps).then(word),
      ]);

    return { resolved, outcome, tradingOpen, paused, resolutionTime, minBet, maxBet, maxImpactBps, yesReserve, noReserve, depth, priceYes, priceNo, totalLpShares, tradeFeeBps };
  }

  /* --------------------------- 核心：滑点计算 --------------------------- */

  /**
   * 调 previewBuy() 拿理论份额，再按滑点容忍度下折，得到 minSharesOut。
   * 这是唯一会产生 minSharesOut 的地方。
   */
  async calculateMinSharesOut(
    outcome: Outcome,
    amountIn: bigint,
    slippageToleranceBps: number,
  ): Promise<bigint> {
    this.assertSlippage(slippageToleranceBps);
    this.assertOutcome(outcome);
    if (amountIn <= 0n) {
      throw new SdkError("BELOW_MIN_BET", "amountIn must be > 0", { amountIn: amountIn.toString() });
    }

    const expected = await this.previewBuy(outcome, amountIn);
    if (expected === 0n) {
      throw new SdkError("ZERO_SHARES", "previewBuy returned 0 shares — trade would revert", {
        amountIn: amountIn.toString(),
      });
    }

    // minSharesOut = expected * (10000 - slippage) / 10000，向下取整
    const minOut = (expected * (BPS - BigInt(slippageToleranceBps))) / BPS;
    if (minOut === 0n) {
      throw new SdkError("ZERO_SHARES", "computed minSharesOut == 0", {
        expected: expected.toString(),
        slippageBps: slippageToleranceBps,
      });
    }
    return minOut;
  }

  /** 透传合约的 previewBuy，纯读取 */
  async previewBuy(outcome: Outcome, amountIn: bigint): Promise<bigint> {
    const data = SEL_PREVIEW_BUY + padWord(BigInt(outcome)) + padWord(amountIn);
    return word(await this.transport.ethCall(this.vault, data));
  }

  /* --------------------------- 构造可签名交易 --------------------------- */

  /**
   * 构造买入交易。调用方无法指定 minSharesOut —— 只能给滑点容忍度。
   */
  async buildBuy(req: BuyRequest): Promise<TradePlan> {
    this.assertSlippage(req.slippageBps);
    this.assertOutcome(req.outcome);

    const state = await this.getMarketState();
    this.assertTradable(state, req.amountIn);

    const expectedSharesOut = await this.previewBuy(req.outcome, req.amountIn);
    if (expectedSharesOut === 0n) {
      throw new SdkError("ZERO_SHARES", "previewBuy returned 0");
    }
    const minSharesOut = await this.calculateMinSharesOut(req.outcome, req.amountIn, req.slippageBps);

    const data =
      SEL_BUY +
      padWord(BigInt(req.outcome)) +
      padWord(req.amountIn) +
      padWord(minSharesOut);

    return {
      to: this.vault,
      data,
      value: "0x0",
      quote: {
        amountIn: req.amountIn,
        expectedSharesOut,
        minSharesOut,
        slippageBps: req.slippageBps,
        priceImpactBps: this.priceImpactBps(state, req.outcome, req.amountIn, expectedSharesOut),
        effectivePrice: this.effectivePrice(req.amountIn, expectedSharesOut),
        quotedAt: Date.now(),
      },
    };
  }

  /**
   * 构造卖出交易。同样不给传 minAmountOut，用现有份额乘以 (1 - 滑点)。
   */
  async buildSell(params: {
    outcome: Outcome;
    sharesIn: bigint;
    slippageBps: number;
  }): Promise<TradePlan> {
    this.assertSlippage(params.slippageBps);
    this.assertOutcome(params.outcome);
    if (params.sharesIn <= 0n) throw new SdkError("ZERO_SHARES", "sharesIn must be > 0");

    const state = await this.getMarketState();
    if (state.resolved) throw new SdkError("MARKET_RESOLVED", "market already resolved");

    // 与合约 sell() 完全一致的储备推导
    const y = state.yesReserve;
    const n = state.noReserve;
    let grossOut: bigint;
    if (params.outcome === 1) {
      const newYes = y + params.sharesIn;
      grossOut = n - ceilDiv(n * y, newYes);
    } else {
      const newNo = n + params.sharesIn;
      grossOut = y - ceilDiv(y * n, newNo);
    }
    if (grossOut === 0n) {
      throw new SdkError("ZERO_SHARES", "selling this size returns 0 — pool liquidity too thin", {
        sharesIn: params.sharesIn.toString(),
      });
    }
    const fee = ceilDiv(grossOut * state.tradeFeeBps, BPS);
    const netOut = grossOut - fee;

    const minAmountOut = (netOut * (BPS - BigInt(params.slippageBps))) / BPS;
    if (minAmountOut === 0n) {
      throw new SdkError("ZERO_SHARES", "computed minAmountOut == 0", {
        netOut: netOut.toString(),
        slippageBps: params.slippageBps,
      });
    }

    const data =
      SEL_SELL + padWord(BigInt(params.outcome)) + padWord(params.sharesIn) + padWord(minAmountOut);

    const price = params.outcome === 1 ? state.priceYes : state.priceNo;

    return {
      to: this.vault,
      data,
      value: "0x0",
      quote: {
        amountIn: params.sharesIn,
        expectedSharesOut: netOut,
        minSharesOut: minAmountOut,
        slippageBps: params.slippageBps,
        priceImpactBps: Number((((price * params.sharesIn) / 10n ** 18n - netOut) * BPS) / (price * params.sharesIn / 10n ** 18n || 1n)),
        effectivePrice: Number(price) / 1e18,
        quotedAt: Date.now(),
      },
    };
  }

  /* --------------------------- 盘口创建（6 参） --------------------------- */

  /**
   * 构造 createMarket 交易。**6 个参数一个都不能少**，
   * 少传或多传在编码阶段就会抛 BAD_CONFIG，不会到链上才炸。
   */
  async buildCreateMarket(params: {
    conditionId: string;
    admin: string;
    resolutionTime: number | bigint;
    minBet: bigint;
    maxBet: bigint;
    maxImpactBps: number;
  }): Promise<{ to: string; data: string; value: "0x0" }> {
    if (!this.factory) {
      throw new SdkError("BAD_CONFIG", "factory address not configured in SdkOptions");
    }

    const now = Math.floor(Date.now() / 1000);
    const rt = BigInt(params.resolutionTime);
    if (rt <= BigInt(now + 60)) {
      throw new SdkError("BAD_CONFIG", "resolutionTime must be at least 60s in the future", {
        resolutionTime: rt.toString(),
        now,
      });
    }
    if (params.minBet < 5_000_000n) {
      throw new SdkError("BAD_CONFIG", "minBet must be >= 5 USDC", {
        minBet: params.minBet.toString(),
      });
    }
    if (params.maxBet < params.minBet || params.maxBet > 10_000_000_000n) {
      throw new SdkError("BAD_CONFIG", "maxBet must be in [minBet, 10,000 USDC]", {
        maxBet: params.maxBet.toString(),
        minBet: params.minBet.toString(),
      });
    }
    if (!Number.isInteger(params.maxImpactBps) || params.maxImpactBps < 1 || params.maxImpactBps > 500) {
      throw new SdkError("BAD_CONFIG", "maxImpactBps must be an integer in [1, 500]", {
        maxImpactBps: params.maxImpactBps,
      });
    }

    const data =
      SEL_CREATE_MARKET +
      padBytes32(params.conditionId) +
      padAddress(params.admin) +
      padWord(rt) +
      padWord(params.minBet) +
      padWord(params.maxBet) +
      padWord(BigInt(params.maxImpactBps));

    return { to: this.factory, data, value: "0x0" };
  }

  /* ----------------------------- 熔断开关 ----------------------------- */

  /** 构造 pause()（仅 admin 可用；SDK 只负责编码，不校验权限） */
  buildPause(): { to: string; data: string; value: "0x0" } {
    return { to: this.vault, data: "0x8456cb59", value: "0x0" };
  }

  /** 构造 unpause() */
  buildUnpause(): { to: string; data: string; value: "0x0" } {
    return { to: this.vault, data: "0x3f4ba83a", value: "0x0" };
  }

  /* --------------------------- 两步 Admin 移交 --------------------------- */

  /**
   * 构造 transferAdmin(address)：**只登记 pendingAdmin，admin 不会立即改变**。
   * 前端必须把这一步和下一步分开确认，绝不能把两者塞进同一个"确认接管"按钮。
   */
  buildTransferAdmin(newAdmin: string): { to: string; data: string; value: "0x0" } {
    return { to: this.vault, data: SEL_TRANSFER_ADMIN + padAddress(newAdmin), value: "0x0" };
  }

  /** 构造 acceptAdmin()：必须由 pendingAdmin 本人签名发出，否则链上 revert */
  buildAcceptAdmin(): { to: string; data: string; value: "0x0" } {
    return { to: this.vault, data: SEL_ACCEPT_ADMIN, value: "0x0" };
  }

  /** 构造工厂侧的 transferAdmin(address)（工厂与盘口同一套两步 ABI） */
  buildFactoryTransferAdmin(newAdmin: string): { to: string; data: string; value: "0x0" } {
    if (!this.factory) throw new SdkError("BAD_CONFIG", "factory address not configured in SdkOptions");
    return { to: this.factory, data: SEL_TRANSFER_ADMIN + padAddress(newAdmin), value: "0x0" };
  }

  /** 构造工厂侧的 acceptAdmin() */
  buildFactoryAcceptAdmin(): { to: string; data: string; value: "0x0" } {
    if (!this.factory) throw new SdkError("BAD_CONFIG", "factory address not configured in SdkOptions");
    return { to: this.factory, data: SEL_ACCEPT_ADMIN, value: "0x0" };
  }

  /** 读当前 admin */
  async getAdmin(): Promise<string> {
    return addr(await this.call(SEL.admin));
  }

  /** 读 pendingAdmin；返回 0x000...000 表示当前没有进行中的移交 */
  async getPendingAdmin(): Promise<string> {
    return addr(await this.call(SEL.pendingAdmin));
  }

  /* ----------------------- MEV 保护 / 抗夹子提交 ----------------------- */

  /**
   * 当前可用的提交路由（已按隐私等级排序，私有在前）。
   * 传 chainId 可查别的链；返回空数组意味着"该链没有兜底路由"，调用方必须显式配置。
   */
  availableRoutes(chainId: number = this.chainId ?? 0): SubmissionRoute[] {
    const extra = this.routes.filter((r) => r.chainId === chainId);
    return routesForChain(chainId, extra);
  }

  /**
   * 交易数据完整性自检：防止调用方（或中间层）篡改已签名的 calldata。
   * 任何一项不符直接抛 BAD_PLAN，绝不把可疑交易签名发出去。
   */
  assertPlanIntegrity(plan: TradePlan): void {
    if (plan.to.toLowerCase() !== this.vault.toLowerCase()) {
      throw new SdkError("BAD_PLAN", `plan.to ${plan.to} is not the configured vault`);
    }
    const d = plan.data.toLowerCase();
    if (d.slice(0, 10) !== SEL_BUY) {
      throw new SdkError("BAD_PLAN", `unexpected selector ${d.slice(0, 10)} (expected buy)`);
    }
    if (d.length !== 10 + 3 * 64) {
      throw new SdkError("BAD_PLAN", `malformed calldata length ${d.length}`);
    }
    const outcome = BigInt("0x" + d.slice(10, 74));
    const amountIn = BigInt("0x" + d.slice(74, 138));
    const minOut = BigInt("0x" + d.slice(138, 202));

    if (outcome !== 0n && outcome !== 1n) {
      throw new SdkError("BAD_PLAN", `outcome word must be 0 or 1, got ${outcome}`);
    }
    if (amountIn !== plan.quote.amountIn) {
      throw new SdkError("BAD_PLAN", "calldata amountIn differs from quote", {
        calldata: amountIn.toString(),
        quote: plan.quote.amountIn.toString(),
      });
    }
    if (minOut !== plan.quote.minSharesOut) {
      throw new SdkError("BAD_PLAN", "calldata minSharesOut differs from quote", {
        calldata: minOut.toString(),
        quote: plan.quote.minSharesOut.toString(),
      });
    }
    if (minOut === 0n) {
      throw new SdkError("SLIPPAGE_NOT_SET", "minSharesOut is 0 in calldata — refusing to sign");
    }
    if (minOut > plan.quote.expectedSharesOut) {
      throw new SdkError("BAD_PLAN", "minSharesOut exceeds expected shares — would always revert");
    }
  }

  /**
   * 提交前的"报价新鲜度"闸门：网络抖动/价格跑动时在本地就把单子拦下来。
   *
   * 三道判定：
   *   1. 报价年龄 > maxQuoteAgeMs        → QUOTE_STALE（默认 2s，Base 一个区块的量级）
   *   2. 重新 previewBuy 后份额下滑 > 允许漂移 → QUOTE_STALE
   *   3. 按新价重算的 minSharesOut 已高于旧值 → QUOTE_STALE（链上必 revert，不必浪费 gas）
   */
  async confirmQuoteStillValid(
    plan: TradePlan,
    req: BuyRequest,
    maxDriftBps?: number,
    maxQuoteAgeMs: number = this.maxQuoteAgeMs,
  ): Promise<bigint> {
    const age = Date.now() - plan.quote.quotedAt;
    if (!Number.isFinite(age) || age < 0) {
      throw new SdkError("BAD_PLAN", "quote has no valid timestamp");
    }
    if (age > maxQuoteAgeMs) {
      throw new SdkError("QUOTE_STALE", `quote is ${age}ms old (limit ${maxQuoteAgeMs}ms)`, { ageMs: age });
    }

    const fresh = await withTimeout(
      this.previewBuy(req.outcome, req.amountIn),
      this.submitTimeoutMs,
      "NETWORK_TIMEOUT",
      "previewBuy",
    );
    if (fresh === 0n) throw new SdkError("ZERO_SHARES", "re-quote returned 0 shares");

    const expected = plan.quote.expectedSharesOut;
    if (fresh < expected) {
      const driftBps = Number(((expected - fresh) * BPS) / expected);
      const limit = maxDriftBps ?? req.slippageBps;
      if (driftBps > limit) {
        throw new SdkError("QUOTE_STALE", `quote drifted ${driftBps}bps > ${limit}bps`, {
          quoted: expected.toString(),
          fresh: fresh.toString(),
          driftBps,
          limit,
        });
      }
      // 即使漂移在容忍度内，也要保证旧 minSharesOut 仍然成交得了
      const minOutNow = (fresh * (BPS - BigInt(req.slippageBps))) / BPS;
      if (minOutNow < plan.quote.minSharesOut) {
        throw new SdkError("QUOTE_STALE", "price moved: minSharesOut would revert on-chain", {
          recommendedMinSharesOut: minOutNow.toString(),
          currentMinSharesOut: plan.quote.minSharesOut.toString(),
        });
      }
    }
    return fresh;
  }

  /**
   * 把已签名交易通过路由链提交。
   *
   * 安全规则（比"多试几个端点"重要得多）：
   *   - 私有路由超时 = **结果未知**（可能已被收下），抛 SUBMIT_AMBIGUOUS，绝不自动改投公开池
   *     —— 否则同一 nonce 会同时曝光到公开 mempool，或造成重复提交。
   *   - 私有路由返回明确 JSON-RPC 拒绝 = 没上链，可以继续试下一条。
   *   - 公开路由失败 = 继续试下一条；全部失败抛 NO_ROUTE。
   */
  async submitProtected(
    rawTx: string,
    opts: SubmissionOptions = {},
  ): Promise<{ hash: string; route: SubmissionRoute }> {
    if (!this.transport.sendRawTransaction) {
      throw new SdkError("BAD_CONFIG", "transport.sendRawTransaction is not implemented");
    }
    if (!/^0x[0-9a-fA-F]+$/.test(rawTx)) {
      throw new SdkError("BAD_CONFIG", "rawTx must be 0x-prefixed hex");
    }
    const routes = opts.routes ?? this.availableRoutes();
    if (routes.length === 0) {
      throw new SdkError("NO_ROUTE", "no submission route configured for this chain");
    }
    const timeout = opts.submitTimeoutMs ?? this.submitTimeoutMs;
    const failures: string[] = [];

    for (const route of routes) {
      try {
        const hash = await withTimeout(
          this.transport.sendRawTransaction(route, rawTx),
          timeout,
          "NETWORK_TIMEOUT",
          `send via ${route.id}`,
        );
        if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
          throw new SdkError("BAD_RESPONSE", `route ${route.id} returned malformed hash: ${hash}`);
        }
        return { hash, route };
      } catch (e) {
        const isTimeout = e instanceof SdkError && e.code === "NETWORK_TIMEOUT";
        const isMalformed = e instanceof SdkError && e.code === "BAD_RESPONSE";
        if ((isTimeout || isMalformed) && route.privacy !== "public") {
          throw new SdkError(
            "SUBMIT_AMBIGUOUS",
            `no usable response from ${route.id} — tx may already be accepted; check the receipt before any retry`,
            { route: route.id, submittedTo: route.url },
          );
        }
        failures.push(`${route.id}: ${(e as Error)?.message ?? String(e)}`);
      }
    }

    throw new SdkError("NO_ROUTE", `all submission routes failed: ${failures.join(" | ")}`);
  }

  /**
   * 一步到位：报价 → 完整性自检 → 新鲜度闸门 → 签名 → 私有路由提交。
   *
   * 关键点：**签名之前**就把所有能本地判定的风险拦掉（价格跑了 / 数据被改 / 网络超时），
   * 用户不会因为网络抖动签出一个必被夹或必 revert 的交易。
   */
  async signAndSubmitBuy(
    req: BuyRequest,
    signer: TxSigner,
    opts: SubmissionOptions = {},
  ): Promise<{ hash: string; route: SubmissionRoute; quote: TradePlan["quote"] }> {
    const plan = await this.buildBuy(req);
    this.assertPlanIntegrity(plan);
    await this.confirmQuoteStillValid(plan, req, opts.maxDriftBps, opts.maxQuoteAgeMs);

    const rawTx = await withTimeout(
      signer({ to: plan.to, data: plan.data, value: plan.value }),
      opts.submitTimeoutMs ?? this.submitTimeoutMs,
      "NETWORK_TIMEOUT",
      "signer",
    );

    const { hash, route } = await this.submitProtected(rawTx, opts);
    return { hash, route, quote: plan.quote };
  }

  /**
   * 轮询回执。私有路由超时（SUBMIT_AMBIGUOUS）后用它来判断到底上没上链，
   * 避免"以为失败又发一遍"造成的双花风险。
   */
  async waitForReceipt(
    hash: string,
    opts: { timeoutMs?: number; pollMs?: number } = {},
  ): Promise<TransactionReceipt> {
    if (!this.transport.getTransactionReceipt) {
      throw new SdkError("BAD_CONFIG", "transport.getTransactionReceipt is not implemented");
    }
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const pollMs = opts.pollMs ?? 500;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const rcpt = await withTimeout(
        this.transport.getTransactionReceipt(hash),
        this.submitTimeoutMs,
        "NETWORK_TIMEOUT",
        "getTransactionReceipt",
      );
      if (rcpt) return rcpt;
      if (Date.now() + pollMs > deadline) {
        throw new SdkError("RECEIPT_TIMEOUT", `no receipt for ${hash} within ${timeoutMs}ms`, { hash });
      }
      await new Promise((r) => setTimeout(r, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
    }
  }

  /* --------------------------- 错误映射 --------------------------- */

  /** 把错误码翻成可直接上屏的中文 */
  static message(code: SdkErrorCode | "UNKNOWN"): string {
    return ERROR_MESSAGES[code as SdkErrorCode] ?? "交易失败，请稍后重试";
  }

  /**
   * 把链上 revert（或 ethers/viem 抛出的错误对象）翻译成 { code, message }。
   * 兼容：裸 hex、{ data }、{ error: { data } }、{ info: { error: { data } } }
   */
  static mapRevert(err: unknown): { code: SdkErrorCode | "UNKNOWN"; message: string; detail?: string } {
    const data = PredictionSDK.extractRevertData(err);
    if (!data) return { code: "UNKNOWN", message: PredictionSDK.message("UNKNOWN") };

    const selector = data.slice(0, 10).toLowerCase();
    const code = REVERT_MAP[selector];
    if (code) return { code, message: PredictionSDK.message(code), detail: data };

    // Error(string) —— require 的兜底路径
    if (selector === "0x08c379a0" && data.length > 138) {
      const len = Number(BigInt("0x" + data.slice(74, 138)));
      const hex = data.slice(138, 138 + len * 2);
      let text = "";
      for (let i = 0; i < hex.length; i += 2) text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      return { code: "UNKNOWN", message: `链上拒绝：${text}`, detail: data };
    }

    return { code: "UNKNOWN", message: PredictionSDK.message("UNKNOWN"), detail: data };
  }

  private static extractRevertData(err: unknown): string | undefined {
    if (typeof err === "string") return err.startsWith("0x") ? err : undefined;
    const e = err as Record<string, any>;
    return (
      e?.data ??
      e?.error?.data ??
      e?.info?.error?.data ??
      e?.cause?.data ??
      (typeof e?.revert?.data === "string" ? e.revert.data : undefined)
    );
  }

  /* ------------------------------- 断言层 ------------------------------- */

  /** 滑点是硬门禁：0（裸奔）和 >5% 都直接拒绝 */
  private assertSlippage(bps: number): void {
    if (!Number.isInteger(bps) || bps < MIN_SLIPPAGE_BPS) {
      throw new SdkError(
        "SLIPPAGE_NOT_SET",
        `slippageBps must be an integer in [${MIN_SLIPPAGE_BPS}, ${MAX_SLIPPAGE_BPS}]; ` +
          `0 means "no protection" and is refused by design`,
        { slippageBps: bps },
      );
    }
    if (bps > MAX_SLIPPAGE_BPS) {
      throw new SdkError("SLIPPAGE_TOO_HIGH", `slippageBps must be <= ${MAX_SLIPPAGE_BPS}`, {
        slippageBps: bps,
      });
    }
  }

  private assertOutcome(outcome: number): void {
    if (outcome !== 0 && outcome !== 1) {
      throw new SdkError("BAD_OUTCOME", "outcome must be 0 (NO) or 1 (YES)", { outcome });
    }
  }

  private assertTradable(state: MarketState, amountIn: bigint): void {
    if (state.resolved) {
      throw new SdkError("MARKET_RESOLVED", "market already resolved", { outcome: state.outcome });
    }
    if (state.paused) throw new SdkError("TRADING_PAUSED", "trading is paused");
    if (!state.tradingOpen) {
      throw new SdkError("TRADING_PAUSED", "trading window closed", {
        resolutionTime: state.resolutionTime,
      });
    }
    if (amountIn < state.minBet) {
      throw new SdkError("BELOW_MIN_BET", `amountIn below minBet`, {
        amountIn: amountIn.toString(),
        minBet: state.minBet.toString(),
      });
    }

    if (amountIn > state.maxBet) {
      throw new SdkError("ABOVE_MAX_BET", "amountIn exceeds the absolute per-trade cap", {
        amountIn: amountIn.toString(),
        maxBet: state.maxBet.toString(),
      });
    }

    const cap = (state.depth * (state.maxImpactBps - BigInt(this.impactMarginBps))) / BPS;
    if (amountIn > cap) {
      throw new SdkError("IMPACT_TOO_HIGH", "amountIn exceeds max impact cap — would revert", {
        amountIn: amountIn.toString(),
        cap: cap.toString(),
        maxImpactBps: state.maxImpactBps.toString(),
      });
    }
    if (state.depth === 0n) {
      throw new SdkError("INSUFFICIENT_DEPTH", "pool has no liquidity");
    }
  }

  /* ------------------------------- 辅助计算 ------------------------------- */

  /**
   * 价格冲击 = 成交后价格相对成交前的变动（bps）。
   * 用与合约完全一致的储备变化计算：买入 outcome 后，该侧的"对手盘"储备增加 net。
   */
  private priceImpactBps(
    state: MarketState,
    outcome: Outcome,
    amountIn: bigint,
    sharesOut: bigint,
  ): number {
    const WAD = 10n ** 18n;
    const fee = ceilDiv(amountIn * state.tradeFeeBps, BPS);
    const net = amountIn - fee;

    let before: bigint;
    let after: bigint;
    if (outcome === 1) {
      before = (state.noReserve * WAD) / state.depth;
      const newNo = state.noReserve + net;
      const newYes = state.yesReserve - sharesOut;
      after = newNo + newYes === 0n ? 0n : (newNo * WAD) / (newNo + newYes);
    } else {
      before = (state.yesReserve * WAD) / state.depth;
      const newYes = state.yesReserve + net;
      const newNo = state.noReserve - sharesOut;
      after = newNo + newYes === 0n ? 0n : (newYes * WAD) / (newNo + newYes);
    }
    if (before === 0n) return 0;
    return Number(((after - before) * BPS) / before);
  }

  private effectivePrice(amountIn: bigint, sharesOut: bigint): number {
    if (sharesOut === 0n) return 0;
    return Number(amountIn) / 1e6 / (Number(sharesOut) / 1e6);
  }

  private async call(selector: string): Promise<string> {
    return this.transport.ethCall(this.vault, selector);
  }
}

/* ------------------------------- 适配器 ------------------------------- */

/** viem PublicClient 适配（client.call 返回 { data }） */
export function viemTransport(client: {
  call(args: { to: string; data: string }): Promise<{ data?: string }>;
}): EthCallTransport {
  return {
    async ethCall(to, data) {
      const res = await client.call({ to: to as `0x${string}`, data: data as `0x${string}` });
      if (!res.data) throw new Error("viem returned empty data");
      return res.data;
    },
  };
}

/** ethers v6 Provider 适配 */
export function ethersTransport(provider: {
  call(tx: { to: string; data: string }): Promise<string>;
}): EthCallTransport {
  return {
    ethCall: (to, data) => provider.call({ to, data }),
  };
}

export const __internals = {
  padWord,
  padAddress,
  padBytes32,
  word,
  addr,
  withTimeout,
  routesForChain,
  mevProtectedRoute,
  KNOWN_ROUTES,
  SEL,
  SEL_CREATE_MARKET,
  SEL_TRANSFER_ADMIN,
  SEL_ACCEPT_ADMIN,
  SEL_PREVIEW_BUY,
  SEL_BUY,
  BPS,
  REVERT_MAP,
};
