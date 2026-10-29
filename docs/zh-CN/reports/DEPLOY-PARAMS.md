# 部署参数摘要（2026-10-24 版）

> 一页纸，上链时照这个填。所有数字都来自当前代码与实测，不是设计意图。

## 一、协议级不可变常量（编译进字节码，部署后无法修改）

| 参数 | 值 | 源码常量 | 含义 |
|---|---|---|---|
| 最低下注额下限 | **5,000,000**（5 USDC） | `PredictionVault.MIN_BET_FLOOR` / `PredictionFactory.MIN_BET_FLOOR` | 任何盘口的 `minBet` 都不得低于此值 |
| 单笔下注额上限 | **10,000,000,000**（10,000 USDC） | `PredictionVault.MAX_BET_CEILING` / `PredictionFactory.MAX_BET_CEILING` | 任何盘口的 `maxBet` 都不得高于此值 |
| 单笔影响上限天花板 | **500**（5% 池深） | `MAX_IMPACT_BPS_CAP` | 盘口可调低，不可调高 |
| 交易费 | **150 bps**（1.5%） | `TRADE_FEE_BPS` | 买卖双向收取 |
| 结算费 | **50 bps**（0.5%） | `SETTLE_FEE_BPS` | 仅赢家赎回时收；INVALID 不收 |
| 退款期限 | **7 days** | `REFUND_DELAY` | 结算时间 + 7 天未公布 → 任何人可触发 INVALID 退款 |
| 单笔手续费取整 | 向上 | `FixedPoint.bpsUp` | 协议永不吃亏 |
| 份额取整 | 向上（对池子） | `FixedPoint.mulDivUp` | 用户份额永不优于理论值 |

## 二、每个盘口的可变参数（`createMarket` 入参）

```solidity
function createMarket(
    bytes32 conditionId,   // 盘口唯一 ID，例如 keccak256("BTC-100K-2026Q4")
    address admin_,        // 结算管理员 —— 必须是 Safe 多签
    uint256 resolutionTime_,   // unix 时间戳，必须 > 当前时间
    uint256 minBet_,       // >= 5e6，建议 5e6 或 10e6
    uint256 maxBet_,       // >= minBet_ 且 <= 10_000e6，建议 10_000e6
    uint256 maxImpactBps_  // 1..500，建议 500
) returns (address vault);
```

**推荐配置**

| 盘口类型 | minBet | maxBet | maxImpactBps |
|---|---|---|---|
| 首发主盘（深度 ≥ 20,000 USDC） | 5 USDC | 10,000 USDC | 500 |
| 小额快盘（深度 < 5,000 USDC） | 5 USDC | 5% 深度对应的金额（如 250 USDC） | 500 |

> 浅盘一定要把 `maxBet` 设小。虽然 `buy()` 会被 5% 影响上限拦住，但前端如果直接读 `maxBet` 渲染
> "最多可下 10,000"，用户体验会很差（输入 1,000 却报 `ImpactTooHigh`）。建议前端一律用
> `min(maxBet, depth × maxImpactBps / 10000)` 作为展示上限。

## 二·五、熔断与权限移交（Pausable）

| 操作 | 权限 | 效果 |
|---|---|---|
| `pause()` | 仅 `admin` | 立刻停止 `buy` / `sell` / `addLiquidity` / `redeem` |
| `unpause()` | 仅 `admin` | 恢复全部入口 |
| `setPaused(bool)` | 仅 `admin` | 兼容旧前端的包装，等价于上面两个 |
| `setFeeVault(address)` | 仅 `admin` | 改手续费流向；**每次必须 emit `FeeVaultUpdated(old,new)`**（Phase 5 新增，索引器依赖） |
| `transferAdmin(address)` | 仅 `admin` | **两步移交第 1 步**：只把新地址写入 `pendingAdmin`，`admin` 不变 |
| `acceptAdmin()` | 仅 `pendingAdmin` | **两步移交第 2 步**：由新地址自己调用，`admin` 此刻才转移 |

暂停状态读取：`paused()`（OZ 标准）与 `tradingOpen()`（业务语义，`resolved` / `paused` / 超时任一成立即为 false）。

**两步移交（`PredictionVault` 与 `PredictionFactory` 同一套语义）**：

```
admin=EOA  --transferAdmin(Safe)-->  admin=EOA, pendingAdmin=Safe
                                     （过渡期 EOA 仍掌权，Safe 无任何权限）
pendingAdmin=Safe --acceptAdmin()-->  admin=Safe, pendingAdmin=0
```

- 地址填错**可救**：`transferAdmin` 可重复调用覆盖 `pendingAdmin`，旧 admin 全程保留权限。
- 不存在"交出去但没人接"的空窗，也不存在单步切错即永久失控。
- 没人能代收：旧 admin、第三方、甚至部署私钥调 `acceptAdmin()` 都会 `NotPendingAdmin()`（`0x058d9a1b`）。
- 工厂不提供 `transferOwnership` / `renounceOwnership`；`owner()` 只是 `admin` 的只读别名。

**辅助合约（`ConditionalToken` / `ProtocolFeeVault`）**：Phase 5 起改用 OZ `Ownable2Step`
（`transferOwnership` 只登记 `pendingOwner`，必须 `acceptOwnership()` 才生效），并且
`renounceOwnership()` 被 override 成直接 revert（`RenounceDisabled`），防止 owner 归零后
`setFactory` / `setTreasury` 永久锁死。

**一个刻意的安全例外**：`block.timestamp >= resolutionTime + 7 days` 之后，`redeem()` **无视暂停强制放行**。
原因很直接——如果暂停能永久冻结赎回，一个失联或被攻破的管理员就能把全体用户的本金锁死。
这条例外已写入合约注释并有专门测试（`test_PauseCannotLockRedemptionPastRefundWindow`）。

> 上线建议：首选 `MARKET_ADMIN` / `ADMIN_TRANSFER_TO` 直接填 Safe 多签地址，部署脚本会一次性完成两步移交的第 1 步；
> 第 2 步必须由 Safe 自己发起（`acceptAdmin()`），部署私钥做不了。切之前先
> `cast call <safe> "getOwners()(address[])"` 核对多签成员，`cast call <safe> "getThreshold()(uint256)"` 核对门限。

## 三、三道闸的执行顺序（已固化，测试覆盖）

```
buy(amountIn)
  ├─ amountIn <  minBet   → BelowMinBet()      // 5 USDC 起投
  ├─ amountIn >  maxBet   → AboveMaxBet()      // 10,000 USDC 单笔绝对上限
  └─ amountIn >  depth×maxImpactBps/10000 → ImpactTooHigh()   // 5% 池深
```

顺序不能换：巨单必须报 `AboveMaxBet`，否则前端拿到的错误码会把"超过额度"误报成"池子太浅"。

## 四、Base 主网部署顺序

```bash
export PATH=/opt/foundry:$PATH
export BASE_RPC_URL=https://mainnet.base.org
export PRIVATE_KEY=<部署私钥>
export TREASURY=<平台收款多签>

forge script script/Deploy.s.sol:Deploy --rpc-url $BASE_RPC_URL --broadcast --verify
```

| # | 步骤 | 合约 | 关键动作 |
|---|---|---|---|
| 1 | 部署 | `ConditionalToken(USDC, owner)` | USDC = `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| 2 | 部署 | `ProtocolFeeVault(USDC, treasury, owner)` | treasury 必须是多签，部署后仍可由 owner 改 |
| 3 | 部署 | `PredictionVault()` | 仅作克隆模板，**不要直接初始化** |
| 4 | 部署 | `PredictionFactory(impl, ct, feeVault, owner)` | |
| 5 | 绑定 | `ct.setFactory(factory)` | **漏掉这一步，createMarket 会 NotMarket 失败** |
| 6 | 建盘 | `factory.createMarket(...)` | 见第二节参数 |
| 7 | 做市 | `ct.splitPosition` → `vault.addLiquidity` | 1 对 YES+NO = 1 USDC |

## 五、部署后必须核对的 8 项

```bash
cast call $VAULT "minBet()(uint256)"        # 期望 5000000
cast call $VAULT "maxBet()(uint256)"        # 期望 10000000000
cast call $VAULT "maxImpactBps()(uint256)"  # 期望 500
cast call $VAULT "MIN_BET_FLOOR()(uint256)" # 期望 5000000
cast call $VAULT "MAX_BET_CEILING()(uint256)" # 期望 10000000000
cast call $VAULT "TRADE_FEE_BPS()(uint256)" # 期望 150
cast call $VAULT "SETTLE_FEE_BPS()(uint256)"# 期望 50
cast call $VAULT "admin()(address)"         # 必须是你的 Safe 多签，不能是 EOA
cast call $VAULT "pendingAdmin()(address)"  # 移交完成后必须回到 0x0
cast call $FACTORY "admin()(address)"       # 同上，工厂侧单独有一份
cast call $FACTORY "pendingAdmin()(address)"# 同上
cast call $VAULT "paused()(bool)"           # 部署后必须是 false
```

熔断演练（部署完立刻在测试网跑一遍）：

```bash
cast send $VAULT "pause()"   --private-key $ADMIN_PK --rpc-url $BASE_RPC_URL
cast call $VAULT "tradingOpen()(bool)"      # 期望 false
cast send $VAULT "unpause()" --private-key $ADMIN_PK --rpc-url $BASE_RPC_URL

# 两步移交：第 1 步（旧 admin 签），第 2 步（新 admin 自己签）
cast send $VAULT "transferAdmin(address)" $SAFE --private-key $ADMIN_PK --rpc-url $BASE_RPC_URL
cast call $VAULT "pendingAdmin()(address)"  # 期望 $SAFE，且 admin() 仍是旧地址
cast send $VAULT "acceptAdmin()" --private-key $SAFE_PK --rpc-url $BASE_RPC_URL
cast call $VAULT "admin()(address)"         # 期望 $SAFE
```

## 六、Keeper 配置（上线即用）

```json
{
  "rpcUrl": "https://mainnet.base.org",
  "factory": "<上表第 4 步地址>",
  "feeVault": "<上表第 2 步地址>",
  "intervalMs": 30000,
  "feeThreshold": "10000000",
  "autoRefund": false,
  "maxFeePerGasGwei": 10
}
```

私钥只授予上述两个 permissionless 动作，**不要用 admin 多签的私钥**。

## 七、当前实测指标

| 指标 | 数值 |
|---|---|
| Foundry 测试 | **78 passed / 0 failed** |
| 不变式模糊测试 | 1000 runs × 100 步 = **100,000 次调用，0 revert，9/9 不变式**（含 pause/unpause 各约 7,800 次） |
| SDK 单测 | **31/31** |
| 链上 E2E | **11/11**（6 参建盘 + 熔断实拍 + 报价与成交份额分毫不差） |
| 合约体积 | Vault 11,066 B / CT 8,709 B / Factory 2,604 B / FeeVault 1,960 B（上限 24,576 B） |
| 单笔买入 gas | 中位 166,420（Base ≈ $0.001） |
| 建盘 gas | 中位 466,392 |
