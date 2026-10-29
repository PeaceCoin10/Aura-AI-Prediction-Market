# CentralPredictionEngine —— 单合约多盘口架构

一个合约承载无限盘口：`mapping(bytes32 => Market)`，每条 `createMarket` 就是开一个新盘，
不需要再部署合约、不需要再注册条件、不需要新金库。

- 合约：`src/CentralPredictionEngine.sol`
- 大脑：`hermes/hermes_brain.py`（见 `hermes/README.md`）
- 部署：`script/DeployCentral.s.sol`
- 测试：`test/CentralEngine.t.sol`（35 条）、`test/CentralEngineInvariant.t.sol`（4 条不变式 × 1000 runs × 100 calls）

---

## 1. 盘口生命周期

```
createMarketWithMeta(id, question, category, resolutionTime)   ← AI / Keeper（授权）
        │
        ├── seedLiquidity(id, amount)                           ← 注入做市资金（铸出等量 YES/NO 库存）
        │
        ├── buyShares(id, side, amountIn, minSharesOut)  ⇄  sellShares(id, side, sharesIn, minAmountOut)
        │
        ├── resolveMarket(id, outcome)                          ← 预言机（Hermes），必须已到 resolutionTime
        │   └── 进入 1 小时争议期（Disputing）：禁止 redeem / sweep
        │       ├── admin（Safe 多签）可 overrideResolution(id, 新结果) 一键改判，窗口不延长
        │       └── 1 小时无人介入 → 自动终结（纯时间戳判断，不需要任何交易）
        │   └── 或 resolutionTime + 7d 后任何人 emergencyRefund(id) → INVALID，0.5/0.5 退款（立即终结）
        │
        ├── finalize(id)                                        ← 争议期后任何人可调，只为给索引器一条日志
        ├── redeem(id)                                          ← 争议期结束后用户领钱（赢家 1.0，INVALID 各 0.5）
        │
        └── sweepResidual(id)                                   ← admin 扫走做市残余（cash - owed）
```

参数硬编码在 `constant`，admin 改不了：交易抽成 **1.5%**、结算费 **0.5%**、单笔最低 **5 USDC**、
单笔最高 **10,000 USDC**、单笔价格影响上限 **5%**、超时退款 **7 天**、盘口最短存活 **1 小时**、
最长 **365 天**、做市种子下限 **10 USDC**、裁决争议期 **1 小时**（`DISPUTE_WINDOW`）。

## 2. 定价模型（这是本轮唯一需要讲清楚的数学）

每个盘口维护：池内 `yesReserve / noReserve`（份额库存）、`cash`（本盘口专属 USDC 账面）、
`yesSupply / noSupply`（份额总发行）、用户份额 `yesOf / noOf`、应付 `owed`。

**买入 YES（净额 net，已扣 1.5%）**：

```
1) net USDC 拆成 net 对：net YES 给用户、net NO 进池子（1 对 = 1 USDC 抵押，cash += net）
2) 池子按 CPMM 再放出一部分 YES：
       newNo  = noReserve + net
       newYes = ceil(yesReserve * noReserve / newNo)
       dy     = yesReserve - newYes
3) 用户合计拿到 sharesOut = net + dy
```

为什么一定要有 `net +` 这一项：在 50% 赔率下，1 USDC 必须能买到**接近 2 份**（赢则赔 ~2 倍），
这才是"价格 = 概率"。如果只给 `dy`（1 USDC 换 0.897 份），赢家赔付比本金还少 —— 那就不是预测市场，
而是一个 10% 点差的赌场。**老的 `PredictionVault` 就是只给 `dy`**（`test_LpProfitWhenTraderIsWrong`
里 100 USDC 只换到 89.67 份），这个问题在本引擎里已修正；老合约未改动，见第 8 节。

**卖**：`sharesIn` 份与其等量对手份额合并销毁（1 对 = 1 USDC），用户按
「成交前价 + 成交后价」的中点拿现金，价差留作池子（= 对手方）收益。中点定价保证
「买一卖一必亏 2× 手续费 + 冲击成本」，不存在无风险套利（有专门测试 `test_SellRoundTrip_NeverProfits`）。

**结算**：池内库存直接作废（做市方的对手盘风险），用户侧份额的应赔付定死进 `owed`：

```
owed = outcome == YES ? (yesSupply - yesReserve)
     = outcome == NO  ? (noSupply - noReserve)
     = INVALID        ? ((yesSupply - yesReserve) + (noSupply - noReserve)) / 2
```

`resolveMarket` 里有 `require(cash >= owed, "INSOLVENT")` —— 结算是资金安全的最后一道闸。

## 2.5 裁决争议缓冲期（1 小时）

```
resolveMarket(id, outcome)   ──► resolved = true, disputeEndsAt = now + 1h, finalized = false
                                     │
              ┌──────────────────────┴───────────────────────┐
              │ 争议期内（now < disputeEndsAt）               │ 争议期后（now >= disputeEndsAt）
              ▼                                              ▼
   redeem / sweep 一律 revert DisputeWindowOpen         redeem 立即可用（无需任何人发交易）
   admin 可 overrideResolution(id, 新结果)              overrideResolution 一律 revert DisputeWindowClosed
   owed 按新结果重算，仍强制 cash >= owed               finalize(id) 任何人可调，仅 emit 日志
```

设计要点（每条都有测试）：

| 要求 | 实现 | 证据 |
|---|---|---|
| 硬编码 1 小时 | `DISPUTE_WINDOW = 1 hours`（constant，admin 改不了） | `test_Dispute_ResolveOpensOneHourWindowAndBlocksRedeem` |
| 争议期内禁止提现 | `redeem` 走 `_isFinal()` 闸门 | 同上 + E2E `redeem 被拒（DisputeWindowOpen）` |
| 争议期内禁止扫账 | `sweepResidual` / `sweepable` 同样走 `_isFinal()` | `test_SweepResidual_OnlyOverflowAboveOwed` |
| Safe 可一键纠错 | `overrideResolution`（onlyAdmin，重算 `owed`） | `test_Dispute_AdminCanFlipOutcomeToTheRealWinner` |
| 无人介入自动放行 | 终结判断纯靠 `block.timestamp >= disputeEndsAt`，**不依赖任何 keeper 发交易** | `test_Dispute_WindowBoundaryIsInclusive` |
| 多签不能无限拖延 | 改判不延长窗口，窗口从第一次裁定起算死 | `test_Dispute_OverrideCanBeAppliedMultipleTimesButNeverExtends` |
| 改判不会让账面穿仓 | 改判后仍 `require(cash >= owed)`；争议期内没人能提现，所以 `owed` 可安全重算 | `invariant_DisputeWindowProtectsOwed` |
| 兜底退款不被拖慢 | `emergencyRefund` 直接 `finalized = true`，不额外等 1 小时 | `test_EmergencyRefund_IsFinalImmediatelyNoDisputeWait` |

**诚实边界**：这一小时里 `admin`（即 Safe 多签）对结果有最终决定权。它降低了「预言机单点误判」的风险，
但把信任转移到了「多签不会被攻破/作恶」上。合约能保证的是：多签**动不了钱**——`owed` 只能按
`yesUserAtSettle / noUserAtSettle` 重算，永远 ≤ `cash`，而且窗口一过就再也改不了。

## 3. 资金安全（不变式，已被 1000×100 随机调用验证）

| 编号 | 不变式 | 含义 |
|---|---|---|
| A1 | `cash >= owed` | 已承诺但没领走的赔付，永远有现金兜底 |
| A2 | `cash >= max(yesSupply, noSupply)` | 结算前任何时刻都赔得起"单边全赢" |
| A3 | `engine.balanceOf(USDC) == Σ cash` | 手续费即时划走，没有暗账、没有串盘 |
| A4 | `supply == poolReserve + Σ用户份额` | 库存与账本自洽 |
| A5 | 争议期内 `sweepable == 0`，且 `resolved ⇒ cash >= owed` | 缓冲期不会被人趁乱扫走赔付 |

`test/CentralEngineInvariant.t.sol`：3 个盘口 × 1000 runs × 100 calls
（买/卖/结算/争议期改判/终结/赎回/扫残余/时间快进），`reverts: 0`，五条全部通过。

**钱不会死锁**：赢家随时 `redeem`；没人结算则 7 天后任何人可 `emergencyRefund` 全额退款；
暂停期间赎回被封，但过了「结算时间 + 7 天」强制放行（`redeemGuard`）。

## 4. 角色

| 角色 | 能做什么 | 不能做什么 |
|---|---|---|
| `admin` | 建盘、做市、暂停、设费率金库/treasury、扫残余、授权角色、两步移交、**争议期内改判** | 改费率/限额常数、在争议期外改结果、动已终结的 `owed`、替用户赎回 |
| `creators[addr]` (Hermes 建盘) | `createMarket*`、`seedLiquidity`、`setCategory` | 结算、提款 |
| `oracles[addr]` (Hermes 裁决) | `resolveMarket`（到点后） | 建盘、提款、改参数 |
| 任何人 | `emergencyRefund`（7 天后）、`finalize`（争议期后）、`redeem`、买卖 | 其他 |

建盘权与裁决权**分离**：同一个 key 被攻破也不能"自己出题自己判"。生产环境可以让它们都是 Safe/多签或
独立的 Hermes 实例。admin 是标准两步移交（`transferAdmin` → `acceptAdmin`）。

## 5. 事件（索引器口径）

| 事件 | indexed | 触发 |
|---|---|---|
| `MarketCreated(marketId, creator, question, category, resolutionTime)` | marketId, creator | 建盘 |
| `MarketCategoryUpdated(marketId, category)` | marketId | 改分类 |
| `LiquiditySeeded(marketId, seeder, amount)` | marketId, seeder | 注入做市 |
| `SharesBought(marketId, buyer, outcome, amountIn, fee, sharesOut, priceYes)` | marketId, buyer | 买入 |
| `SharesSold(marketId, seller, outcome, sharesIn, amountOut, fee, priceYes)` | marketId, seller | 卖出 |
| `MarketResolved(marketId, outcome, timestamp, emergency, owed)` | marketId | 结算 / 超时退款 |
| `DisputeWindowOpened(marketId, outcome, disputeEndsAt, owed)` | marketId | 裁定进入争议期 |
| `ResolutionOverridden(marketId, oldOutcome, newOutcome, newOwed, disputes)` | marketId | Safe 争议期内改判 |
| `ResolutionFinalized(marketId, outcome, owed)` | marketId | 争议期后显式终结（`finalize`） |
| `Redeemed(marketId, account, yesBurned, noBurned, payout, fee)` | marketId, account | 赎回 |
| `ResidualSwept(marketId, treasury, amount)` | marketId, treasury | 扫残余 |
| `FeeVaultUpdated / TreasuryUpdated / CreatorUpdated / OracleUpdated` | 变更双方 | 管理 |
| `Paused / Unpaused / AdminTransferStarted / AdminTransferred` | account / 双方 | 熔断与移交 |

一个盘口的所有事件都带 `marketId`（indexed），The Graph / Ponder 直接按 `marketId` 建实体即可，
不需要像「一盘口一合约」那样按合约地址分片。

## 6. 部署

```bash
export PATH=/opt/foundry:$PATH

# 本地（自动发 MockUSDC）
PRIVATE_KEY=<anvil_pk> TREASURY=0x.. ADMIN=0x.. CREATOR=0x.. ORACLE=0x.. \
  forge script script/DeployCentral.s.sol:DeployCentral \
  --rpc-url http://127.0.0.1:8545 --broadcast

# Base Sepolia
PRIVATE_KEY=$PRIVATE_KEY TREASURY=$SAFE ADMIN=$SAFE CREATOR=$BOT ORACLE=$ORACLE \
  forge script script/DeployCentral.s.sol:DeployCentral \
  --rpc-url https://sepolia.base.org --broadcast \
  --verify --verifier etherscan \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=84532" \
  --etherscan-api-key $ETHERSCAN_API_KEY

# Base 主网（USDC 自动取 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913）
... --rpc-url https://mainnet.base.org --verifier-url "...chainid=8453"
```

部署日志末尾会直接打印大脑需要的 `ENGINE` / `USDC` 环境变量。

## 7. 与「一盘口一合约」的代价对比

| | 旧（PredictionFactory + 克隆） | 新（CentralPredictionEngine） |
|---|---|---|
| 新盘成本 | 一次部署 tx（~200k gas）+ 注册条件 | 一条 `createMarket`（~120k gas） |
| 索引 | 按合约地址分片 | 按 `marketId` 一条流 |
| 升级 | 逐盘升级实现 | **一处升级 = 全部盘口**（风险也集中） |
| 爆炸半径 | 单盘 | 全盘共用一份代码与一个金库账面 |

单合约的代价就是最后一行：**代码风险不再隔离**。所以本合约只保留必要逻辑（无 ERC1155、无回调、
无外部调用回调点、严格 CEI + `nonReentrant`），并且盘口之间的 `cash/owed` 完全独立记账
（A3 不变式保证没有串盘）。上线前仍建议第三方审计。

## 8. 已知问题与边界（照实说）

1. **老 `PredictionVault` 的定价缺陷未修**：买 100 USDC 只铸 89.67 份，赢也只赔 89.22 → 50% 赔率下
   必亏 11%。这是 `sharesOut = dy` 少了 `net` 造成的，本引擎已用 `net + dy` 修正。老合约属于已上线资产，
   未擅自改动（会改变经济模型与全部测试口径），需要你点头我再回补 + 重跑那 89 条测试。
2. **预言机仍是"可信来源"**：`hermes_brain.py` 用 CoinGecko/Binance 现货价，带 5 分钟新鲜度校验，
   但公开 API 不可仲裁。生产建议换 Chainlink/Pyth 签名价格 + 链上 TWAP，或保留 `--require-confirm`
   让人工复核 `proposals/*.json`。
3. **结算可信度**：预言机提交后有 1 小时争议期，Safe 多签可以改判；争议期外任何人都改不了。
   这不是 UMA 式的「质押+仲裁」乐观预言机（没有经济罚没、没有第三方仲裁者），信任模型是
   「Hermes 出题与裁决 + Safe 多签兜底」，只是把单点误判的窗口从「永久」压缩到「1 小时可纠错」。
4. **前端 SDK 已就绪**：`sdk/CentralPredictionSDK.ts` + `docs/CENTRAL-SDK-GUIDE.md`（44 条单测、真链联调 10 项）。
5. **未审计**：本轮只有 Slither + 125 条 forge 测试 + 4 条不变式。Slither 全仓（含本引擎）
   **0 High / 0 Medium**（18 条：Low 12 全是 `block.timestamp` 业务比较，Info 6 = `buyShares/sellShares`
   圈复杂度 + solc 版本提示；此前的 dead-code 与 immutable 建议都已修掉）。
6. **gas 与规模**：单合约所有盘口共享一个存储命名空间，盘口数上千后 `marketIds` 全量遍历会变贵；
   大脑按 `marketId` 精确查询，不受影响。

## 9. 复现

```bash
export PATH=/opt/foundry:$PATH && cd ~/prediction-market
forge test                                   # 46 passed（本引擎 45 + 不变式套件 1，内含 5 条不变式）
bash script/e2e-dispute.sh                   # anvil 全流程：建盘 → 下注 → 3×30s 确认 → 争议期 → 改判 → 赎回
cd hermes && python3 -m unittest test_brain.py   # 22 passed（离线）
cd legacy && forge test                      # 89 passed（重构前的旧实现，独立工程）
```

> 本轮为了让 `marketCore` 这类多返回值视图通过编译，`foundry.toml` 打开了 `via_ir = true`
> （Solc 0.8.24 在非 IR 管线报 stack-too-deep）。这会影响全部合约的字节码，老合约的 89 条测试
> 在 `via_ir=true` 下仍然全绿，但**部署前请用最终编译参数重新生成一次审计快照**。
