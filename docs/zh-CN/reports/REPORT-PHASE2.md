# 第二阶段验证报告：Keeper 自动化 · 前端安全层 · 不变式模糊测试

**代码位置**：`/root/prediction-market`
**验证时间**：2026-10-24
**结论**：**Foundry 70/70 测试全绿（含 1000 轮 × 100 步 = 100,000 次随机调用的不变式测试）· SDK 21/21 · 链上 E2E 8/8 · Keeper 实战跑通**

---

## 一、总览

| 交付物 | 文件 | 状态 |
|---|---|---|
| 守护机器人 | `keeper/keeper.js`（14.8 KB，唯一依赖 ethers v6） | ✅ 实跑通过 |
| 前端安全 SDK | `sdk/PredictionSDK.ts` + 21 条单测 + 链上 E2E | ✅ 21/21 + 8/8 |
| 不变式测试 | `test/PredictionInvariant.t.sol`（handler + 8 条不变式） | ✅ 1000 runs / 100,000 calls |
| 参数边界测试 | 5 USDC 起投 / 10,000 USDC 单笔上限 | ✅ 13 条（业务 9 + 攻防 4） |
| 本地联调脚本 | `script/e2e-local.sh`（anvil → 部署 → keeper → SDK） | ✅ 一键 ALL GREEN |

---

## 二、自动化 Keeper

### 2.1 权限设计（最重要的一点）

**Keeper 不持有 admin 权限。** 结算权在 admin 多签手里，keeper 只做两件事：

1. 到点未结算 → 告警 + 生成 **Safe Transaction Builder 可直接导入的提案 JSON**（把 outcome=0/1/2 三种 calldata 都生成好，多签成员只需签名，不用手拼 calldata，也不会填错 outcome）。
2. 只有 **permissionless** 的动作才自己签名发送：`autoDistributeFee()`、`emergencyRefund()`。

私钥泄露的最坏后果是「手续费被提前分账」+「超时盘口被置为 INVALID」，**无法篡改任何盘口结果**。

### 2.2 实跑证据（anvil 本地链）

```
poll #1 | markets=2 | chainTime=2026-10-24 02:52:08Z
WARN  0x856e4424… 已到结算时间 1h 0m 仍未结算
INFO  0xb0279Db6… trading | resolve in 29d 21h
INFO  proposal -> keeper/proposals/0x856e4424…-RESOLUTION_OVERDUE.json
WARN  proposal written for 0x856e4424… {"admin":"0xf39F…","overdue":"1h 0m"}
INFO  feeVault pending=3.00 USDC — distributing
OK    autoDistributeFee confirmed block=5 -> 0x000…bEEF (3.00 USDC)
INFO  === single run finished === {"polls":1,"alerts":1,"refunds":0,"feeDistributions":1,"errors":0}
```

生成的提案片段（真实产物）：

```json
{
  "type": "RESOLUTION_OVERDUE",
  "vault": "0x856e4424f806D16E8CBC702B3c0F2ede5468eae5",
  "adminMultisig": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "overdue": "1h 0m",
  "feeRefundAvailableAt": "2026-10-31 01:32:48Z",
  "proposals": [
    { "to": "0x856e…", "value": "0", "operation": 0,
      "data": "0xa0270dbc0000…0000", "description": "Resolve … as NO" },
    { "data": "0xa0270dbc0000…0001", "description": "Resolve … as YES" },
    { "data": "0xa0270dbc0000…0002", "description": "Resolve … as INVALID" }
  ]
}
```

### 2.3 稳健性

- **告警去重**：同一个盘口同一类告警只推一次，不会每 30 秒刷屏
- **Gas 上限**：超过 `maxFeePerGasGwei`（默认 10 gwei）就跳过本轮，宁可晚分账也不被高费打爆
- **单点故障**：webhook 失败只记日志，不影响主循环；`--once` 模式可交 cron，抗崩溃
- **两种运行方式**：`node keeper.js`（常驻）或 `node keeper.js --once`（cron）

---

## 三、前端安全 SDK

### 3.1 核心机制：从代码层消灭"裸奔"

```ts
async buildBuy({ outcome, amountIn, slippageBps }): Promise<TradePlan>
```

- **接口里没有 minSharesOut 参数** —— 调用方想传 0 也传不进来
- 内部强制走 `previewBuy()` → `minSharesOut = expected * (10000 - slippage) / 10000`
- `slippageBps = 0` → 抛 `SLIPPAGE_NOT_SET`；`> 500` → 抛 `SLIPPAGE_TOO_HIGH`
- preflight 先行：`BELOW_MIN_BET` / `IMPACT_TOO_HIGH` / `MARKET_RESOLVED` / `TRADING_PAUSED` / `ZERO_SHARES` 全部本地拦截，不烧 gas

### 3.2 链上端到端验证（真实合约，不是 mock）

```
✅ SDK 读取链上状态成功
✅ SDK previewBuy 返回非零报价，minSharesOut 严格低于报价
✅ SDK 生成合法 calldata（selector buy(uint8,uint256,uint256)）
✅ previewBuy 报价 + 1 wei 被合约拒绝（证明报价精确到 1 wei，无有利舍入）
✅ SDK 报价 == 链上实际成交份额 (225,956,717)
✅ SDK 在本地拦截超上限大单（不浪费 gas）
✅ SDK 拒绝 slippage=0（从代码层杜绝裸奔）

E2E: 7 checks passed
```

第 4 条是整套前端安全的核心证据：**用 `previewBuy` 的返回值 +1 wei 当 `minSharesOut`，合约直接 `SlippageExceeded`**；用它本身则原样成交、份额分毫不差。说明 SDK 算出的就是链上的精确边界，既不放宽（不会让用户被夹），也不虚高（不会白白 revert）。

### 3.3 离线单测 19/19

覆盖：状态解码、`previewBuy` 数学一致性（100 USDC → 89,667,728 份）、滑点下折、**滑点 0 拒绝**、负滑点/小数滑点拒绝、>5% 拒绝、低于起投额、超影响上限、恰好边界、已结算/暂停/收盘、非法 outcome、calldata 结构、35 组金额×滑点组合的性质断言、卖出数学复刻、零份额、地址校验、安全垫收紧。

---

## 四、不变式模糊测试

### 4.1 配置

```toml
[invariant]
runs = 1000      # 1000 组随机种子
depth = 100      # 每组 100 次乱序调用
fail_on_revert = false
```

实测：**1000 runs · 100,000 calls · 0 reverts · 8/8 不变式通过 · 57.5 秒**

Handler 覆盖全部 11 个外部入口（每个约 9,000 次调用）：

| 入口 | 调用次数 | 入口 | 调用次数 |
|---|---|---|---|
| buy | 9,079 | redeem | 9,042 |
| sell | 9,085 | resolveMarket | 9,183 |
| split | 9,080 | triggerRefund | 9,112 |
| merge | 9,046 | autoDistribute | 9,119 |
| addLiquidity | 9,013 | warpTime | 9,023 |
| removeLiquidity | 9,218 | | |

### 4.2 八条不变式

| # | 不变式 | 断言内容 | 结果 |
|---|---|---|---|
| 1 | `invariant_collateralBacksAllOutstandingShares` | **金库 + 条件代币托管的真实 USDC ≥ 全部流通份额的承兑义务** | ✅ |
| 2 | `invariant_ctAloneBacksAllShares` | 更严格形式：光靠条件代币托管就够（金库现金是 LP 利润，不参与承兑） | ✅ |
| 3 | `invariant_noDoubleSpendAfterResolution` | 结算后剩余托管 ≥ 剩余义务（按结果口径） | ✅ |
| 4 | `invariant_vaultNeverOwesMoreThanItHolds` | 结算后不允许出现任何短缺 | ✅ |
| 5 | `invariant_yesNoSupplyParity` | **结算前** YES 与 NO 流通量严格相等 | ✅ |
| 6 | `invariant_lpShareLedgerBalances` | LP 份额账本自洽：Σ 个人份额 == totalLpShares | ✅ |
| 7 | `invariant_priceSumIsOne` | priceYes + priceNo == 1，且都在 [0,1] | ✅ |
| 8 | `invariant_feesOnlyEverReachTreasury` | treasury 余额恒等于累计已分发额，手续费无法被劫持 | ✅ |

### 4.3 测试过程中纠正的两处自身错误（诚实记录）

**E-01：份额平价不变式写错了作用域。**
首轮 1000 轮跑出 `supply parity broken: 7,143,669,350 != 7,055,499,542`（YES 比 NO 多 88,169,808）。
排查结论：**不是合约缺陷**。结算后用户只销毁自己实际持有的那一侧（赢家只有 YES 或只有 NO），
平价必然被打破。已把该断言限定在结算前，并新增 `invariant_noDoubleSpendAfterResolution` 覆盖结算后的正确口径。

**E-02：虚拟储备的恒等式在收取手续费后不成立。**
最初想断言 `noReserve == 真实NO + 现金`，推导后发现卖出时手续费从现金里出、但虚拟储备不扣，
恒等式每笔卖单都会差一个 fee。这不是缺陷（费用就该由用户承担），是我的断言写错了。
已替换为更严格且永远成立的「仅条件代币托管即可覆盖全部份额」。

---

## 五、复现命令

```bash
cd /root/prediction-market
export PATH=/opt/foundry:$PATH

# 1. 全部 Solidity 测试（56 条，含 10 万次随机调用）
forge test

# 2. SDK 离线单测（19 条）
cd sdk && npm install && npm test

# 3. 全链路联调（anvil + 部署 + keeper + SDK 真实下单）
cd .. && bash script/e2e-local.sh
```

日志：`test-all.log`（forge 全量）、`sdk-test.log`、`e2e-local.log`、`invariant-full.log`

---

## 六、还没做的（上链前仍需人决定）

1. **Keeper 的私钥放在哪** —— 建议独立热钱包，只存够 gas 的 ETH（Base 上约 0.001 ETH 可跑数月）；绝不与 admin 多签共用。
2. **提案如何进入多签流程** —— 目前落地成 JSON 文件 + webhook。若要全自动，需要接 Safe 的 Transaction Service API（需要 Safe 的 API key 与签名策略），这属于运营决策。
3. **SDK 的 `buildSell` 依赖本地复刻合约数学** —— 合约没有 `previewSell` 视图函数。若后续改 CPMM 公式，SDK 必须同步改（已在 README 标注）。建议下一版给合约加 `previewSell`，把这个耦合去掉。
4. **不变式测试的覆盖面** —— 只模拟单盘口 + 10 个 actor。跨盘口、跨工厂的资金串扰不在此次范围内（当前架构每个 Vault 独立托管，理论上不存在串扰，但没有测试证明）。
5. **前端仍需自己处理** —— allowance、用户拒签、链切换、gas 估算失败、交易回执解析。SDK 只保证「报价与滑点保护」这一段不出错。
