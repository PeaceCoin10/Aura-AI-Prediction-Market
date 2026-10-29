# Phase 3 · 熔断硬化与前端 ABI 同步报告

日期：2026-10-24　范围：`PredictionVault` Pausable + 6 参 ABI 前端同步 + 全量复验

---

## 一、结论

| 项目 | 结果 |
|---|---|
| `forge test` | **78 passed / 0 failed**（业务 37 + 攻防 39 + 不变式 2 套件） |
| 不变式 | 1000 runs × 100 calls = **100,000 次调用，0 revert，9/9 通过** |
| SDK 单测 | **31/31** |
| 链上 E2E | **11/11，ALL GREEN** |
| 合约体积 | Vault **11,066 B**（+619 B，上限 24,576 B） |

---

## 二、Pausable 接入

### 2.1 实现

```solidity
contract PredictionVault is ReentrancyGuard, Pausable, IERC1155Receiver
```

- 删除自造的 `bool public paused` 与自定义 `whenNotPaused` 修饰符，改用 OZ v5 `Pausable`
- 错误码从自造的 `TradingPaused()` 变为 OZ 标准的 `EnforcedPause()` / `ExpectedPause()`
- 所有入口的状态语义统一由 `paused()` 驱动，`tradingOpen()` 同步返回 `!resolved && !paused() && now < resolutionTime`

### 2.2 挂载点

| 函数 | 修饰符 | 说明 |
|---|---|---|
| `buy` | `nonReentrant whenNotPaused` | 冻结下单 |
| `sell` | `nonReentrant whenNotPaused` | 冻结卖出 |
| `addLiquidity` | `nonReentrant whenNotPaused` | 冻结新增做市（防止暂停后继续注入资金） |
| `redeem` | `nonReentrant redeemGuard` | 冻结赎回，**但有时间例外**（见 2.4） |
| `removeLiquidity` | `nonReentrant` | **不冻结**：LP 退出不影响盘口偿付性，允许随时撤 |

### 2.3 管理接口

```solidity
function pause()   external onlyAdmin;   // _pause()
function unpause() external onlyAdmin;   // _unpause()
function setPaused(bool) external onlyAdmin;  // 兼容旧前端的包装
function transferAdmin(address newAdmin) external onlyAdmin;
```

`initialize` 时 `admin` 由工厂建盘参数传入，即部署钱包默认为 admin；
`transferAdmin` 单步移交（非两段式），事件 `AdminTransferred(old, new)` 同时记录新旧地址。

### 2.4 刻意的安全例外：暂停不能锁死赎回

```solidity
modifier redeemGuard() {
    if (paused() && block.timestamp < resolutionTime + REFUND_DELAY) revert EnforcedPause();
    _;
}
```

**理由**：若暂停能无限期阻止赎回，则一个失联/被攻破的 admin 就等于拥有"永久冻结全体用户本金"的权力。
过了 `resolutionTime + 7 days` 之后，赎回无视暂停强制执行。

测试 `test_PauseCannotLockRedemptionPastRefundWindow` 实拍：
1. 结算为 INVALID → `pause()`
2. 窗口内 `redeem()` 被 `EnforcedPause` 拦住 ✅
3. `warp(resolutionTime + 7 days)` → `redeem()` 成功退回 **100.000000 USDC** 本金 ✅

---

## 三、前端 SDK 同步

### 3.1 6 参 `createMarket`

```ts
const tx = await sdk.buildCreateMarket({
  conditionId, admin, resolutionTime, minBet, maxBet, maxImpactBps,
});
// { to: factory, data: 0x0ca07ff7 + 6×32 bytes, value: "0x0" }
```

编码前本地校验（全部抛 `BAD_CONFIG`，不会到链上才炸）：
- `minBet >= 5e6`
- `maxBet ∈ [minBet, 10_000e6]`
- `maxImpactBps ∈ [1, 500]` 且为整数
- `resolutionTime >= now + 60s`
- `conditionId` 必须是 32 字节 hex、`admin` 必须是合法地址
- 未配置 `factory` 时直接拒绝，不静默发空交易

### 3.2 错误码映射（本地 + 链上双层）

本地 preflight 抛出的错误码已有中文文案；链上 revert 通过 4 字节 selector 反查：

| selector | 合约错误 | SDK 错误码 | 前端文案 |
|---|---|---|---|
| `0xb8ab88d4` | `AboveMaxBet()` | `ABOVE_MAX_BET` | 单笔下注不能超过 10,000 USDC |
| `0x5688ffb3` | `BelowMinBet()` | `BELOW_MIN_BET` | 单笔下注不能低于 5 USDC |
| `0x22410594` | `ImpactTooHigh()` | `IMPACT_TOO_HIGH` | 该笔金额占池子比例过大，请减少下单金额 |
| `0xd93c0665` | `EnforcedPause()` | `TRADING_PAUSED` | 该盘口已暂停交易，请稍后再试 |
| `0xe2c865df` | `TradingClosed()` | `TRADING_PAUSED` | 同上 |
| `0x8199f5f3` | `SlippageExceeded()` | `ZERO_SHARES` | 下单金额过小，成交份额为 0，请加大金额 |
| `0x1db9461a` | `MarketResolvedAlready()` | `MARKET_RESOLVED` | 该盘口已结算，无法继续交易 |
| `0xbb55fd27` | `InsufficientLiquidity()` | `INSUFFICIENT_DEPTH` | 池子流动性不足，无法承接该笔交易 |
| `0x47556579` | `OnlyAdmin()` | `NOT_ADMIN` | 只有管理员可以执行该操作 |
| `0xf98175ba` `0x03235eab` `0xc865b21a` `0x10549aa0` | `Invalid*` 系列 | `BAD_CONFIG` | 盘口参数不合法 |

`PredictionSDK.mapRevert(err)` 兼容裸 hex、`{data}`、`{error:{data}}`、`{info:{error:{data}}}`、`{cause:{data}}` 五种错误形状，
解不出的 selector 返回 `UNKNOWN` 并保留原始 data，**不吞异常**。

> 自定义错误只有 4 字节，理论上存在碰撞。这张表定位是"把链上 revert 翻译成人话"，
> 真正的拦截以本地 preflight 为准（本地不通过就不会发交易，不烧 gas）。

### 3.3 熔断开关

```ts
sdk.buildPause();   // 0x8456cb59
sdk.buildUnpause(); // 0x3f4ba83a
```

SDK 只做编码，不校验权限（前端该按钮本来就只对 admin 展示）。

---

## 四、E2E 实测（anvil 全链路）

```
✅ SDK 读取链上状态成功
✅ SDK previewBuy 返回非零报价，minSharesOut 严格低于报价
✅ SDK 生成合法 calldata（selector buy(uint8,uint256,uint256)）
✅ previewBuy 报价 + 1 wei 被合约拒绝（证明报价精确到 1 wei，无有利舍入）
✅ SDK 报价 == 链上实际成交份额 (225956717)
✅ SDK 在本地拦截超过 10,000 USDC 绝对上限的大单
✅ SDK 在本地拦截超 5% 影响上限的大单（池深 10001.902962 USDC -> 上限 501.112155 USDC）
✅ SDK 拒绝 slippage=0（从代码层杜绝裸奔）
✅ 6 参 createMarket 建盘成功，参数原样落库 (vault=0x3dE2Da43d4c1B137E385F36b400507c1A24401f8)
✅ 暂停期间下单被拒，SDK 映射为「该盘口已暂停交易，请稍后再试」
✅ unpause 后交易恢复（5 USDC 起投额实拍成交）
E2E: 11 checks passed
```

第 9 项是真实建盘：SDK 编码 `minBet=7e6 / maxBet=8_000e6 / maxImpactBps=300`，
链上回读 `minBet()=7000000`、`maxBet()=8000000000`、`maxImpactBps()=300`、
`admin()=deployer`、`MAX_BET_CEILING()=10000000000`、`paused()=false`，逐项相等。

第 10 项是从**真实 revert** 里抓 `0xd93c0665` 再走 `mapRevert()`，不是拿常量糊弄。

---

## 五、新增测试清单（12 条）

**业务侧**：无新增（参数边界已在上一轮补齐）

**攻防侧（`PredictionSecurityTest` +8）**

| 测试 | 验证点 |
|---|---|
| `test_PauseFreezesAllValueMovingEntrypoints` | buy/sell/addLiquidity/redeem 四个入口同时冻结 |
| `test_UnpauseRestoresTrading` | 解除暂停后立即恢复 |
| `test_Revert_NonAdminCannotPauseOrUnpause` | 非 admin 调 pause/unpause 均 `OnlyAdmin` |
| `test_Revert_PauseTwiceAndUnpauseWhenRunning` | OZ 语义：重复 pause / 未暂停时 unpause 必须报错 |
| `test_PauseCannotLockRedemptionPastRefundWindow` | 退款窗口后暂停不得阻止赎回 |
| `test_TransferAdminMovesAllAdminPowers` | 新 admin 生效、旧 admin 全部权限失效、事件正确 |
| `test_Revert_TransferAdminGuards` | 零地址 / 同一地址 / 非 admin 三种拒绝 |
| `test_DeployerIsAdminByDefault` | 建盘时传入的地址即 admin，立即可 pause |

**不变式侧（+1）**

- `invariant_pauseBlocksValueFlow`：暂停期间 `tradingOpen()` 必须为 false
- handler 新增 `pauseMarket()` / `unpauseMarket()`，1000 轮内各执行约 **7,800 次**，
  随机状态下 9 条不变式全部成立（偿付性、手续费去向、LP 账本、价格和为 1 等）

**SDK（+10）**：6 参编码精确到 word、超限 maxBet 拒绝、minBet 下限拒绝、maxBet 倒挂拒绝、
未配 factory 拒绝、pause/unpause selector、AboveMaxBet/BelowMinBet/EnforcedPause 三条映射、
未知错误不吞、15 个错误码文案无空洞

---

## 六、遗留与风险

1. **暂停是中心化权力**。虽然加了"7 天后强制放行赎回"的例外，但窗口内的赎回确实可被 admin 冻结。
   缓解：admin 必须是 Safe 多签（2/3 起），不要用 EOA。
2. **`transferAdmin` 是单步且不可回滚**。切错地址 = 永久失去盘口控制权。切之前务必链下核对地址。
3. **暂停不影响 `emergencyRefund`**（permissionless），任何人仍可在超时后把盘口置为 INVALID。
4. **本轮的 78 条测试仍不等于第三方审计**。上链前建议至少做一次独立审计 + 一次测试网灰度。
5. **合约已有部署则必须重新部署**：加了 Pausable 改变了存储布局，克隆盘口全部需要重建。

---

## 七、复验命令

```bash
export PATH=/opt/foundry:$PATH
cd /root/prediction-market

forge test                                  # 78 passed / 0 failed
forge test --match-contract PredictionInvariantTest   # 9/9 invariants
(cd sdk && npm test)                        # 31/31
bash script/e2e-local.sh                    # 11/11, ALL GREEN
```
