# 合约安全与业务参数验证报告

**项目**：去中心化预测市场（USDC 计价二元盘口）
**目标链**：Base 主网（USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`）
**代码位置**：`/root/prediction-market`
**工具链**：forge 1.8.5-dev · solc 0.8.24 · OpenZeppelin v5.0.2
**验证时间**：2026-10-24
**结论**：**70/70 测试通过（含 1000 轮 × 100 步不变式）· 17/17 独立演练通过 · 审计中发现并修复 3 个真实缺陷（1 个资金锁死级）**

---

## 一、交付物清单

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/libraries/FixedPoint.sol` | 58 | 定点数学：`mulDivDown`/`mulDivUp`/`bpsDown`/`bpsUp`，舍入方向显式命名 |
| `src/ConditionalToken.sol` | 185 | ERC-1155 条件代币：`splitPosition` / `mergePositions` / `redeemFor` |
| `src/PredictionVault.sol` | 542 | CPMM 做市金库：买卖、限额、收费、结算、超时退款、LP 份额 |
| `src/ProtocolFeeVault.sol` | 71 | 协议费金库：`autoDistributeFee()` 无权限触发 |
| `src/PredictionFactory.sol` | 135 | EIP-1167 克隆工厂 + 协议级硬顶 |
| `src/mocks/MockUSDC.sol` | 17 | 6 位小数测试币 |
| `test/BasePrediction.t.sol` | 108 | 测试基座 + 偿付性断言 |
| `test/PredictionBusiness.t.sol` | 430 | 正常业务 28 条 |
| `test/PredictionSecurityTest.t.sol` | 442 | 攻防 26 条 |
| `script/PredictionSecurityTest.s.sol` | 419 | 可独立运行的攻防演练（17 项） |
| `script/Deploy.s.sol` | 64 | Base 主网部署 |
| `test-vvvv.log` | 3,529 行 | `forge test -vvvv` 完整日志 |
| `rehearsal.log` | — | 演练脚本输出 |
| `gas.log` | — | 逐函数 gas 报告 |

合约运行时代码：ConditionalToken **8,709 B**、PredictionVault **10,447 B**、PredictionFactory **2,604 B**、ProtocolFeeVault **1,960 B**（EIP-170 上限 24,576 B，余量充足）。

---

## 二、业务参数：代码即事实

| 参数 | 值 | 定义处 | 强制点 |
|---|---|---|---|
| 最低下注 | **5 USDC** (`5e6`) | `PredictionVault.MIN_BET_FLOOR` | `buy()` 入口 + 工厂拒绝更低的盘口 |
| 单笔最高下注 | **10,000 USDC** (`10_000e6`) | `PredictionVault.MAX_BET_CEILING` | `buy()` 入口 + 工厂拒绝更高配置 |
| 单笔影响上限 | **500 bps = 5% 池深** | `MAX_IMPACT_BPS_CAP` | `buy()` 与 `sell()`，双向生效 |
| 交易费 | **150 bps = 1.5%** | `TRADE_FEE_BPS` | 买卖均收，`mulDivUp` 向上取整（不利于用户） |
| 结算费 | **50 bps = 0.5%** | `SETTLE_FEE_BPS` | 赢家赎回时收，`mulDivUp`；INVALID 不收 |
| 退款期限 | **结算时间 + 7 天** | `REFUND_DELAY` | `emergencyRefund()` |
| 定价曲线 | **k = yesReserve × noReserve 恒定** | `buy`/`sell` | 份额输出用 `ceil`，协议永不吃亏 |
| 重入锁 | `nonReentrant` | buy/sell/redeem/addLiquidity/removeLiquidity | 5 个资金入口全覆盖 |
| 工厂硬顶 | 单盘口无法放宽 | `PredictionFactory.createMarket` | `minBet < 5e6` / `maxBet > 10_000e6` / `maxBet < minBet` / `maxImpact > 500` 直接 revert |

**舍入方向**：`mulDivDown` 只用于"给用户"一侧，`mulDivUp` 只用于"向用户收"一侧。fuzz 256 轮验证：用户拿到的份额 **永不优于 floor 理论值**，最多差 1 wei。

---

## 三、实测数字（全部来自真实 trace，非估算）

初始池：YES 1000 / NO 1000（深度 2,000 USDC）

| 动作 | 输入 | 手续费 | 份额 | 价格 |
|---|---|---|---|---|
| 买入 YES | 100 USDC | **1,500,000**（1.5%） | **89,667,728** | 0.500000 → **0.546835** |
| 赢家赎回 | 89,667,728 份 | **448,339**（0.5%） | 到手 **89,219,389** | — |
| 拆分 | 250 USDC | 0 | 250 YES + 250 NO | — |
| INVALID 退款 | 500 份 | 0 | 到手 **250 USDC**（本金 1:1） | — |

平均成交价 = 100 / 89.667728 = **1.115 USDC/份**。

**这一点必须说清楚**：5% 限额约束的是"相对池深"，不是"相对价格"。在二元 CPMM 上，打满 5% 池深（100 USDC / 2000 深度）的价格冲击固定是 **0.500 → 0.547，约 +9.4%**，与池子大小无关。真正保护用户的是 `minSharesOut` 滑点参数 —— **前端必须根据 `previewBuy()` 计算并传入，不能传 0**。

---

## 四、五类攻防演练结果

| # | 场景 | 攻击手法 | 期望 | 实测 |
|---|---|---|---|---|
| 1 | 重入 | 恶意合约在 `onERC1155Received` 回调里再次 `buy` | revert | ✅ `ReentrancyGuardReentrantCall`，且储备/费率零污染 |
| 2 | 精度 | 0.5 USDC dust、1 wei、10 亿 USDC、直接捐赠、份额转入金库 | 全拒或无损 | ✅ dust→`BelowMinBet`；巨量→`AboveMaxBet`（绝对上限先命中）；捐赠不改变价格；份额转入不改变储备 |
| 3 | 操纵 | 5 万 USDC 砸 2000 深度池；闪电贷搬砖；同区块先买后卖；连续 20 次打满上限 | revert / 无利 | ✅ `ImpactTooHigh`；闪电贷**无法原额归还**；同区块搬砖净亏手续费；连续攻击下偿付性恒成立 |
| 4 | 抢跑/超时 | 结算时间点后买入；未满 7 天退款；拖到退款窗口套利；暂停状态交易 | revert | ✅ 全部拦截；拆分用户超时退款 **250 USDC 本金 1:1 返还** |
| 5 | 权限 | 非 admin 结算/暂停/换费率；非工厂注册 condition；非 market 销毁份额；克隆二次初始化 | revert | ✅ 9 条权限测试全部 revert，且 `autoDistributeFee()` 任何地址可调但只能打到 treasury |

**独立演练脚本**（不受 forge test 框架影响，用真实 EVM try/catch 语义）：

```
forge script script/PredictionSecurityTest.s.sol --tc PredictionSecurityTestScript
→ RESULT passed: 17   failed: 0
```

---

## 五、审计发现（含 1 个资金锁死级缺陷）

### F-01【严重 · 已修复】LP 的做市利润被永久锁死在金库

**现象**：`buy()` 把净现金（98.5 USDC）留在金库，但 `removeLiquidity()` 只转 YES/NO 代币，没有任何函数能把现金还给 LP。

**实测**：LP 存入 1000 USDC → Alice 用 100 USDC 买 YES → LP 全额撤出，只能拿回 **910.33 YES + 1000 NO**，按 YES 结算值 910.33 USDC，**98.5 USDC 永久卡死**。

**修复**：引入 LP 份额账本（`lpShares` / `totalLpShares`），`removeLiquidity` 按份额比例同时支付 **真实 YES + 真实 NO + 金库现金**；新 LP 按 `poolValue()`（cash + min(YES,NO) + 盈余×0.5）定价，防止稀释既有 LP 的现金利润。

**验证**：`test_LpExitRecoversCashProfit`、`test_LpProfitWhenTraderIsWrong`、`test_SecondLpSharesPricedOffPoolValue`、`test_LastLpExitLeavesNothingBehind`。

### F-02【高 · 已修复】虚拟储备与真实余额脱钩导致撤资 revert

买入后 `noReserve`（虚拟，1098.5）大于金库真实持有的 NO（1000）。旧 `removeLiquidity` 用虚拟储备做边界检查、用真实余额做转账，`removeLiquidity(1050)` 会在 ERC1155 转账处 revert —— LP 的钱进得去出不来。

**修复**：撤资改为按 `shares / totalLpShares` 比例取"真实"资产；虚拟储备同比例缩减，价格不变。

**验证**：`test_LpExitWhenVirtualReserveExceedsRealBalance`（实测拿回 910,332,272 YES + 1,000,000,000 NO + 98,500,000 现金）。

### F-03【中 · 已修复】结算时间后的买入 → 0.5 退款套利面

若结算时间后仍允许交易，攻击者可把价格打到 0.1 以下扫货，拖到 7 天后 `emergencyRefund` 按 0.5/份赔付，无风险套走 LP 的钱。

**修复**：`buy`/`sell`/`addLiquidity` 入口 `block.timestamp >= resolutionTime` 即 `TradingClosed`。

**验证**：`test_Attack04_CannotBuyIntoRefundWindow`、`test_Attack04_TradingClosedAtResolutionTime`。

### F-06【参数变更 · 2026-10-24】起投额 1 → 5 USDC，新增单笔绝对上限 10,000 USDC

`buy()` 现在有三道闸，顺序固定：`minBet` → `maxBet` → `5% 影响上限`。
绝对上限必须先判，否则 50,000 USDC 的巨单会报 `ImpactTooHigh` 而不是 `AboveMaxBet`，前端拿到的错误码会误导用户。
两道上限是**与关系**：最终可下单金额 = `min(minBet 下限之上的金额, maxBet, 池深×5%)`。

F-04【低 · 已修】工程与合规性

- 工厂 `createMarket` 改为 **CEI 顺序**（先写 `vaultOf`/`markets`/事件，再调 `initialize`）；
- 全部事件移到外部调用之前（清掉 5 处 `reentrancy-events` 告警）；
- `ProtocolFeeVault` 构造函数补零地址检查；
- `ConditionalToken.setFactory` 增加 `FactoryUpdated` 事件；
- `redeemFor` 补 `feeRecipient` 零地址前置检查。

### F-05【测试自身的口径错误，已纠正并记录】

我最初把偿付性不变量写成 `抵押品 >= max(YES总量, NO总量)`。该式**只在结算前成立**；结算后输家一侧已归零，必须按结果口径核算（YES→`>=YES`，NO→`>=NO`，INVALID→`>=(YES+NO)/2`）。已修正为 `_assertSolvent()` 的双分支实现，并在 54 条测试中每笔资金操作后调用。

---

## 六、Gas 实测

| 函数 | Min | Avg | Median | Max | 调用次数 |
|---|---|---|---|---|---|
| `buy` | 596（revert 路径） | 146,676 | 166,420 | 187,619 | 347 |
| `sell` | 30,492 | 77,125 | 91,892 | 108,992 | 3 |
| `splitPosition` | 26,482 | 194,226 | 210,207 | 210,207 | 65 |
| `mergePositions` | 94,697 | 94,697 | — | — | 2 |
| `addLiquidity` | 107,204 | 197,000 | 198,663 | — | 55 |
| `removeLiquidity` | 116,018 | 140,548 | 145,454 | — | 6 |
| `redeem` | 22,953 | 86,219 | 98,318 | 100,934 | 7 |
| `resolve` | 2,603 | 48,905 | 61,528 | — | 9 |
| `emergencyRefund` | 2,467 | 35,557 | 59,273 | — | 7 |
| `createMarket` | 27,308 | 437,305 | 466,392 | — | 79 |
| `autoDistributeFee` | 33,884 | 69,698 | 87,606 | — | 3 |

Base 主网 0.005 gwei 量级下，单笔交易成本 < $0.01。

---

## 七、上链前必须由你做决定的事（我不能替你决定）

1. **admin 是单点信任**。当前 `admin` 可随时 `resolve(0/1/2)`（公布任何结果）和 `setPaused`。建议上链时 `admin = Safe 多签（2/3）`，并在首期加 24h timelock 或双人确认流程；否则这是一个中心化后门，也是审计报告里必然被点名的项。
2. **结算完全依赖人工**。系统没有 oracle，`resolutionTime` 到了必须有人调 `resolve`。若无人处理，7 天后任何人可触发 `emergencyRefund`，全体按 0.5 赔付 —— 用户不亏本金，但 LP 的做市利润归零。**这是运营 SLA，不是代码能解决的。**
3. **池子深度与单笔上限的取舍**。上限 = 深度/20。1000 USDC 池子最大单笔只有 100 USDC。建议首发盘口初始深度 **≥ 20,000 USDC**（单笔上限 2,000 USDC），否则大额用户会被 `ImpactTooHigh` 卡住。
4. **USDC 依赖**。所有赎回路经 USDC `transfer`，Circle 冻结/升级会直接影响对应地址。Base 原生 USDC 相对稳定，但这是外部依赖，不可消除。
5. **本地测试 ≠ 第三方审计**。54 条测试 + 17 项演练覆盖了代码层面的已知攻击面，但**不构成审计结论**。上链前建议至少做一次外部审计，或上 Code4rena / Sherlock 做公开竞赛。
6. **`autoDistributeFee()` 是公开的**。任何人可触发，但收款地址只能是 owner 预设的 `treasury`，调用者拿不到一分钱 —— 这是刻意的设计（解决管理员私钥不在线），不是漏洞。

---

## 八、上链步骤

```bash
cd /root/prediction-market
export PATH=/opt/foundry:$PATH
export BASE_RPC_URL=https://mainnet.base.org
export PRIVATE_KEY=<部署私钥>
export TREASURY=<平台收款多签地址>

# 1) 干跑
forge script script/Deploy.s.sol:Deploy --rpc-url $BASE_RPC_URL -vv

# 2) 实播 + 验证
forge script script/Deploy.s.sol:Deploy --rpc-url $BASE_RPC_URL --broadcast --verify

# 3) 创建首个盘口（脚本会打印地址）
cast send <FACTORY> "createMarket(bytes32,address,uint256,uint256,uint256)" \
  0x<conditionId> 0x<admin多签> <unix结算时间> 1000000 500 --rpc-url $BASE_RPC_URL

# 4) 注入流动性（LP 先 splitPosition，再 addLiquidity）
```

**部署顺序不可交换**：`ConditionalToken` → `ProtocolFeeVault` → `PredictionVault`(实现) → `PredictionFactory` → `ct.setFactory(factory)`。漏掉最后一步，`createMarket` 会因 `NotMarket` 失败。

---

## 九、复现命令

```bash
cd /root/prediction-market
export PATH=/opt/foundry:$PATH

forge test                              # 70 passed（含 1000 轮不变式）
forge test --gas-report                 # gas 明细见 gas.log
forge script script/PredictionSecurityTest.s.sol --tc PredictionSecurityTestScript   # 17/17
```
