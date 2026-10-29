# 新引擎前端对接指引（CentralPredictionEngine + CentralPredictionSDK）

适用版本：`src/CentralPredictionEngine.sol`（单合约多盘口，含 1 小时裁决争议期）
SDK 文件：`sdk/CentralPredictionSDK.ts`（零依赖，手工编码 calldata）

---

## 1. 30 秒上手

```ts
import { CentralPredictionSDK, parseUsdc, OUTCOME_YES } from "@prediction/sdk/dist/CentralPredictionSDK";

const sdk = new CentralPredictionSDK(
  {
    // 任何能发 eth_call 的客户端都行，SDK 不绑定库
    ethCall: (to, data) => provider.call({ to, data }),
    // 强烈建议提供：合约所有时间比较都用 block.timestamp，链上时间和本地墙钟可能不一致
    now: async () => BigInt(await provider.getBlockNumber().then((n) => provider.getBlock(n).then((b) => b!.timestamp))),
  },
  {
    engine: "0x…",        // CentralPredictionEngine 地址
    chainId: 8453,        // Base 主网
    account: await signer.getAddress(),
  },
);

const plan = await sdk.buildBuyShares({
  marketId: "0x…",
  outcome: OUTCOME_YES,
  amountIn: parseUsdc("100"),
  slippageBps: 100,       // 1%
});

await signer.sendTransaction({ to: plan.to, data: plan.data });   // value 恒为 0（USDC 走 ERC20）
```

`plan` 里除 `to/data` 还有：`method`（埋点用）、`summary`（可直接显示在确认弹窗的中文摘要）、
`meta`（参数快照，含 `quote` 与 `minSharesOut`，便于审计和客服排查）。

---

## 2. ABI 对照表

| 业务动作 | SDK 方法 | 合约签名 | selector |
|---|---|---|---|
| 建盘（无分类） | `buildCreateMarket` | `createMarket(bytes32,string,uint256)` | `0xfeeece8b` |
| 建盘（带分类） | `buildCreateMarket({meta:{category}})` | `createMarketWithMeta(bytes32,string,string,uint256)` | `0x1e9b6b02` |
| 买入 | `buildBuyShares` | `buyShares(bytes32,uint8,uint256,uint256)` | `0xbbd4f854` |
| 卖出 | `buildSellShares` | `sellShares(bytes32,uint8,uint256,uint256)` | `0xdb833e3a` |
| 提现 | `buildRedeem` | `redeem(bytes32)` | `0xeda1122c` |
| 裁决 | `buildResolveMarket` | `resolveMarket(bytes32,uint8)` | `0x5e382837` |
| 争议期改判 | `buildOverrideResolution` | `overrideResolution(bytes32,uint8)` | `0xc0b9795d` |

> 说明：新引擎**没有 6 参的 `createMarket`**（那是旧工厂的签名，已归档到 `legacy/`）。
> 建盘只有 3 参 `createMarket` 与 4 参 `createMarketWithMeta`；买卖是 4 参。

只读方法：`marketCore` / `resolutionState` / `sharesOf` / `previewBuy` / `previewSell` /
`paused` / `admin` / `isCreator` / `isOracle` / `canCreate` / `canOracle` / `constants`。

---

## 3. 六个 builder 的预检清单

所有 builder 都是「先读链，再决定发不发」。任何一条不满足都会抛 `SdkError`，**不会**返回一个注定失败的 calldata。

### `buildCreateMarket({ marketId, question, resolutionTime, meta? })`
- `marketId` 必须是 32 字节 hex（通常 `keccak256(question)`）
- 题目 UTF-8 字节数 **8~280**（中文一个字 3 字节，别按字符数算）
- `meta.category` 给定时：1~32 字节；不给就走 3 参 `createMarket`（分类写 `general`）
- `resolutionTime` 必须落在 `[now+1h, now+365d]`
- 盘口不能已存在；调用者必须有建盘权（`creators[addr] == true` **或** `addr == admin`）

### `buildBuyShares({ marketId, outcome, amountIn, minSharesOut | slippageBps })`
- 盘口存在、未结算、未过结算时间、协议未暂停
- `amountIn` ∈ `[5 USDC, 10,000 USDC]`
- 价格冲击 ≤ 池深 5%（`amountIn <= (yesReserve+noReserve) * 5%`）
- **必须**给 `minSharesOut` 或 `slippageBps`，否则直接拒（见第 4 节）
- 链上 `previewBuy` 与 SDK 本地同公式复算必须逐位相等，否则抛 `local/QUOTE_MISMATCH`（防 ABI/版本漂移）

### `buildSellShares({ marketId, outcome, sharesIn, minAmountOut | slippageBps })`
- 同上，外加：`sharesIn` 不得超过持仓（`yesOf`/`noOf`）

### `buildRedeem({ marketId })`
- 已裁决、**已过争议期**（`finalized`）、有持仓
- 暂停期间：只有「结算时间 + 7 天」之后才放行（与合约 `redeemGuard` 完全一致）

### `buildResolveMarket({ marketId, outcome })`
- 调用者是 oracle（或 admin）、已到 `resolutionTime`、尚未裁决
- `summary` 会提示「提交后进入 1 小时争议期，期间不可提现」

### `buildOverrideResolution({ marketId, newOutcome })`
- 调用者必须是 `admin()`（主网是 Safe 多签）
- 必须处于争议期（`disputing`）、未终结、新结果 ≠ 当前结果

---

## 4. 保护价的三道闸（防夹子核心）

```
① 报价：previewBuy / previewSell（链上）+ previewBuyOffline / previewSellOffline（本地同公式）
② 保护价：minSharesOut = quote × (1 - slippageBps)，slippageBps 只允许 1~500
③ 发送前二次确认：confirmQuoteStillValid(plan) —— 重新拉报价，跌穿保护价就中止不发
```

强校验规则（违反任意一条直接抛错，不给"裸奔"留口子）：

| 传入 | 结果 |
|---|---|
| `minSharesOut = 0` | `local/MIN_OUT_REQUIRED` |
| 不给 `minSharesOut` 也不给 `slippageBps` | `local/MIN_OUT_REQUIRED` |
| `minSharesOut > 当前报价` | `local/MIN_OUT_ABOVE_QUOTE`（这笔必然失败） |
| `minSharesOut < 报价 × 95%` | `local/SLIPPAGE_TOO_LOOSE`（等于没保护） |
| `slippageBps = 0` 或 `> 500` | `local/SLIPPAGE_OUT_OF_RANGE` |
| 两者都给 | 取**更严格**的那个 |

推荐写法：

```ts
const plan = await sdk.buildBuyShares({ marketId, outcome, amountIn, slippageBps: 100 });
// 用户点"确认"到钱包真正签名之间，可能已经过了几秒 —— 再确认一次
await sdk.confirmQuoteStillValid(plan, 2_000); // 超过 2 秒或价格跌穿保护价都会抛错
await signer.sendTransaction({ to: plan.to, data: plan.data });
```

---

## 5. 错误码与文案

所有错误都是 `SdkError`，带 `code` / `message`（中文，可直接展示）/ `selector`（链上错误才有）/ `onchain`。

### 本地预检（`local/*`，没花 gas）

| code | 文案 |
|---|---|
| `local/MIN_OUT_REQUIRED` | minSharesOut/minAmountOut 不能为 0 —— 不设保护会被夹子按任意价格成交 |
| `local/MIN_OUT_ABOVE_QUOTE` | minSharesOut 高于当前报价，这笔交易必然失败 |
| `local/SLIPPAGE_TOO_LOOSE` | 滑点容差过松（超过 5%），等同于没有保护 |
| `local/SLIPPAGE_OUT_OF_RANGE` | 滑点容差必须在 1~500 bps |
| `local/QUESTION_LENGTH` | 题目长度必须是 8~280 字节（UTF-8） |
| `local/CATEGORY_LENGTH` | 分类长度必须是 1~32 字节 |
| `local/RESOLUTION_TIME_RANGE` | 结算时间必须在「现在 + 1 小时」到「现在 + 365 天」之间 |
| `local/MARKET_NOT_FOUND` / `MARKET_EXISTS` / `MARKET_RESOLVED` | 盘口不存在 / 已存在 / 已结算 |
| `local/TRADING_CLOSED` / `MARKET_PAUSED` | 已过结算时间 / 协议暂停 |
| `local/INSUFFICIENT_SHARES` | 持仓份额不足 |
| `local/NOT_CREATOR` / `NOT_ORACLE` / `NOT_ADMIN` | 没有建盘 / 裁决 / 管理权限 |
| `local/NOT_DISPUTING` / `ALREADY_FINAL` / `SAME_OUTCOME` | 不在争议期 / 已终结 / 结果相同 |
| `local/QUOTE_MISMATCH` | 本地报价与链上 preview 不一致（ABI 或版本不匹配），已中止 |
| `local/ACCOUNT_REQUIRED` / `TRANSPORT_ERROR` | 未配置 account / 读链失败 |

### 链上 revert（`chain/*`，含 4 字节 selector 反查）

| selector | 合约错误 | code | 文案 |
|---|---|---|---|
| `0x5688ffb3` | `BelowMinBet()` | `chain/BELOW_MIN_BET` | 低于最低下注额（5 USDC） |
| `0xb8ab88d4` | `AboveMaxBet()` | `chain/ABOVE_MAX_BET` | 高于单笔上限（10,000 USDC） |
| `0x22410594` | `ImpactTooHigh()` | `chain/IMPACT_TOO_HIGH` | 价格冲击过大（超过池子 5%），请减小金额或分批 |
| `0x87920b43` | `DisputeWindowOpen()` | `chain/DISPUTE_WINDOW_OPEN` | 处于 1 小时争议期，暂不能提现 |
| `0x435a3cfe` | `DisputeWindowClosed()` | `chain/DISPUTE_WINDOW_CLOSED` | 争议期已结束，结果不可更改 |
| `0x47bc7cc8` / `0x80fee105` / `0x47556579` | `OnlyCreator/OnlyOracle/OnlyAdmin` | `chain/NOT_AUTHORIZED_ROLE` | 当前地址没有执行该操作的权限 |
| `0x8199f5f3` | `SlippageExceeded()` | `chain/SLIPPAGE_EXCEEDED` | 成交价超出滑点保护范围，已回滚 |
| `0x1db9461a` | `MarketResolvedAlready()` | `chain/MARKET_RESOLVED` | 盘口已结算 |
| `0x9f4a6489` | `NotResolved()` | `chain/NOT_RESOLVED` | 盘口尚未结算 |
| `0xd93c0665` | `EnforcedPause()` | `chain/ENFORCED_PAUSE` | 协议已暂停 |
| `0x0fce133d` | `TooEarlyToResolve()` | `chain/TOO_EARLY_TO_RESOLVE` | 还没到结算时间 |
| 其余 20 余个 | `MarketNotFound` / `SameOutcome` / `ZeroShares` / `SafeERC20FailedOperation(address)` … | 见 `ERROR_SELECTORS` | 36 个自定义错误全部收录，测试里逐条与 `cast sig` 对齐 |

还有 `chain/REVERT_STRING`（`Error(string)` 原样透出）、`chain/PANIC`（带 panic code）、
`chain/UNKNOWN`（未知 selector，文案里带 selector 便于排查）。

接入建议：

```ts
try {
  const plan = await sdk.buildBuyShares(...);
  await signer.sendTransaction({ to: plan.to, data: plan.data });
} catch (err) {
  if (err instanceof SdkError) {
    if (err.onchain) toast.warn(err.message);       // 链上拒绝，提示可重试
    else toast.info(err.message);                    // 本地拦下，引导用户改参数
    track(err.code, err.selector);
  }
}
```

---

## 6. 典型前端流程

```
列表页   marketCount() → marketIds(i) → marketCore(id) + marketQuestion(id)
详情页   marketCore(id) + resolutionState(id) + previewBuy(id, side, amount)
         价格条：priceYes(id)（1e18，直接当概率百分比用）
下单     buildBuyShares → 确认弹窗（plan.summary）→ confirmQuoteStillValid → 签名
到期前   resolutionState(id).resolved == false 且 now >= resolutionTime → 显示「待裁决」
争议期   disputing == true → 显示倒计时（disputeEndsAt）＋「结果复核中」，隐藏提现按钮
可提现   finalized == true 且有持仓 → buildRedeem
超时兜底 now >= resolutionTime + 7d 且仍未裁决 → 前端可引导任何人 emergencyRefund（任何人可调）
```

---

## 7. 前端的坑（都是实测踩过的）

1. **`since`/倒计时必须用链上时间**。合约所有判断都用 `block.timestamp`；测试链快进时墙钟会落后。
   给 `Transport` 传 `now`，或每次用 `previewBuy` 之前先确认最新区块时间。
2. **争议期是"能看见但不能提"**。`resolved=true` 不代表能提现，必须看 `finalized`。
   直接把「已结束」和「可提现」画成两种状态，否则用户会点出 `DisputeWindowOpen`。
3. **金额是 6 位小数的整数字符串**。用 `parseUsdc`/`formatUsdc`，不要用 JS `number` 传金额。
4. **`minSharesOut` 的单位是"份"不是 USDC**。50% 赔率下 1 USDC ≈ 2 份，别拿 USDC 金额当保护价。
5. **改判入口只对 admin 显示**。主网上 admin 是 Safe，前端最多做一个「生成 Safe 交易」的按钮。
6. **不要在前端硬编码 5 USDC / 10,000 USDC / 1.5%**。用 `sdk.constants()` 读链上常量，
   否则哪天参数调整前端就撒谎了。

---

## 9. 事件日志解码

不用自己算 topic、不用自己处理 head/tail —— 19 个事件全部内置。

```ts
import { EVENT_TOPICS, decodeLogs, decodeLog } from "./CentralPredictionSDK";

const receipt = await provider.getTransactionReceipt(hash);
const events = sdk.decodeReceiptLogs(receipt.logs);   // 自动按引擎地址过滤

for (const ev of events) {
  if (ev.name === "SharesBought") {
    console.log(ev.args.amountIn, ev.args.sharesOut, ev.args.fee, ev.args.priceYes);
  }
}
```

| 事件 | 参数 |
|---|---|
| `MarketCreated` | marketId*, creator*, question, category, resolutionTime |
| `MarketCategoryUpdated` | marketId*, category |
| `LiquiditySeeded` | marketId*, provider*, amount |
| `SharesBought` | marketId*, buyer*, outcome, amountIn, fee, sharesOut, priceYes |
| `SharesSold` | marketId*, seller*, outcome, sharesIn, fee, amountOut, priceYes |
| `MarketResolved` | marketId*, outcome, resolvedAt, emergency, owed |
| `DisputeWindowOpened` | marketId*, outcome, disputeEndsAt, owed |
| `ResolutionOverridden` | marketId*, oldOutcome, newOutcome, newOwed, disputes |
| `ResolutionFinalized` | marketId*, outcome, finalizedAt |
| `Redeemed` | marketId*, account*, yesBurned, noBurned, payout, fee |
| `ResidualSwept` | marketId*, to*, amount |
| `FeeVaultUpdated` / `TreasuryUpdated` | old*, new* |
| `CreatorUpdated` / `OracleUpdated` | address*, allowed |
| `Paused` / `Unpaused` | account |
| `AdminTransferStarted` / `AdminTransferred` | old*, new* |

（`*` = indexed，走 topics；其余走 data。动态 `string` 也是自动解）

要点：
- `decodeLogs` / `decodeReceiptLogs` **不会抛错**：USDC 的 `Transfer`、别的合约的日志直接跳过。
- `EVENT_TOPICS` 是 `cast keccak` 实算的，测试里逐条重算校验；`eventNameOf(topic)` 可反查。
- 同一笔交易里可能同时有 `MarketResolved` + `DisputeWindowOpened`（裁决即开争议期），别只看第一个。

---

## 10. Multicall 批量查询

列表页别 30 个盘口发 120 次 `eth_call`。`marketSnapshots` 走 Base 上的 **Multicall3**
（`0xcA11bde05977b3631167028862bE2a173976CA11`，全链同址），把 4N+1 个调用压成 **1 次 RPC**。

```ts
const snaps = await sdk.marketSnapshots(ids);        // 一次 RPC
// 或 sdk.marketSnapshots(ids, { multicall: false }) —— 强制逐条
// 或 sdk.marketSnapshots(ids, { multicall: "0x自建多签" })

for (const s of snaps) {
  s.priceYes;      // 1e18，×100 = 百分比
  s.priceNo;       // 1e18 互补
  s.depth;         // yesReserve+noReserve（6 位 USDC）
  s.tradingOpen;   // 存在 && 未结算 && 未暂停
  s.disputing;     // 争议期
  s.disputeEndsAt; // 倒计时终点
  s.owed;          // 待兑付
}
```

- 返回 `MarketSnapshot[]`，顺序与入参 `ids` 一致。
- 单条子调用失败（盘口刚被删/节点抽风）→ 只补那几条，不整体失败。
- 链上没有 Multicall3（比如裸 anvil）→ **自动降级**为逐条查，调用方无感。
- 建议单批 ≤ 100 个盘口（响应体大小限制）。

---

## 11. 滑点档位与 5% 冲击预警

```ts
import { SLIPPAGE_CONSERVATIVE, SLIPPAGE_NORMAL, SLIPPAGE_DEGEN } from "./CentralPredictionSDK";

await sdk.buildBuyShares({ marketId, outcome, amountIn, slippageBps: SLIPPAGE_CONSERVATIVE }); // 0.5%
await sdk.buildBuyShares({ marketId, outcome, amountIn, slippageBps: SLIPPAGE_NORMAL });       // 1%
await sdk.buildBuyShares({ marketId, outcome, amountIn, slippageBps: SLIPPAGE_DEGEN });        // 3%
```

| 常量 | 值 | 用在哪 |
|---|---|---|
| `SLIPPAGE_CONSERVATIVE` | `50n`（0.5%） | 大额、池子薄，宁可失败也别被吃 |
| `SLIPPAGE_NORMAL` | `100n`（1%） | 默认 |
| `SLIPPAGE_DEGEN` | `300n`（3%） | 抢热点，接受较大滑点（上限 500） |

**冲击预警**：合约的价格影响硬上限是池深的 5%。当本笔金额达到 **4%（上限的 80%）** 时，
`plan` 会多一个 `warning` 字段，`meta.impactBps` 里是精确冲击值：

```ts
const plan = await sdk.buildBuyShares({ marketId, outcome, amountIn, slippageBps: SLIPPAGE_NORMAL });
if (plan.warning === "impact_near_limit") {
  showTip(`本笔吃掉池子 ${Number(plan.meta.impactBps) / 100}%，再大就会被合约拒绝，建议拆单`);
}
```

- `warning` **不阻断**交易，只是提示；超过 5% 仍然是 `chain/IMPACT_TOO_HIGH` 硬拒。
- 买入按 `amountIn / (yesReserve+noReserve)`，卖出按 `sharesIn / (yesReserve+noReserve)` 计算。

---

## 8. 验证与联调

```bash
cd sdk
npm test                 # 旧 SDK 46 条 + 新 SDK 66 条 = 112
npm run test:central     # 只跑新引擎 SDK（66 条）

# 真链联调：anvil → 部署 → SDK 造交易并上链 → 校验余额变化
cd .. && bash script/e2e-sdk-central.sh        # 14 项全 PASS（含真 receipt 事件解码）
```

新 SDK 的 66 条测试分六类：
1. **选择器对齐**：28 个函数选择器 + 34 个错误选择器逐条跟 `cast sig` 比对；
2. **calldata 逐字节对齐**：7 个 builder 的输出跟 `cast calldata` 全等（含中文题目的 UTF-8 与动态偏移）；
3. **预检/防夹**：保护价强校验 6 条 + 各类链上状态 20 余条；
4. **离线定价**：`previewBuyOffline` / `previewSellOffline` 与真链 `previewBuy` / `previewSell` 逐位相等
   （夹具由 anvil 上真合约生成）；
5. **事件解码**：19 个 topic0 对 `cast keccak` 重算，5 个核心事件的 indexed/动态字段逐个断言；
6. **Multicall**：`aggregate3` 编码对 `cast calldata` 逐字节相等，4 盘口 × 4 字段确认为 **1 次 RPC**，
   并覆盖「失败降级逐条」与「空数组零 RPC」。
