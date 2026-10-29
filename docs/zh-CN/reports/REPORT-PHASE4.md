# Phase 4 报告 —— 两步 Admin 移交 + Base Sepolia 部署准备

日期：2026-10-25　分支：main（基于 `6e0404d`）

---

## 一、结论

| 项目 | 结果 |
|---|---|
| `forge build` | 通过（无 error；仅 forge lint 的风格告警，均为既有代码） |
| `forge test` | **84 / 84 通过**（Business 40 + Security 42 + Invariant 2） |
| SDK 单元测试 | **35 / 35 通过** |
| 本地 E2E（anvil + Keeper + SDK 链上） | **11 / 11 通过，ALL GREEN** |
| Base Sepolia 真链状态演练（fork 广播） | 部署 + 6 参建盘 + 两步移交 + 反向用例全部符合预期 |

净增用例：forge +6，SDK +4。

---

## 二、合约改动

### `src/PredictionVault.sol`
- 新增状态 `address public pendingAdmin;`
- `transferAdmin(address)` 语义改为**只登记**：写 `pendingAdmin` + `emit AdminTransferStarted(current, pending)`，`admin` 不变。
- 新增 `acceptAdmin()`：仅 `pendingAdmin` 可调，成功后 `admin = msg.sender`、`pendingAdmin = 0`、`emit AdminTransferred(old, new)`。
- 新增错误 `NotPendingAdmin()`（selector `0x058d9a1b`），事件 `AdminTransferStarted(address,address)`（`0xe5cd1c80`）。
- 保留 `SameAdmin()` / `ZeroAddress()` 守卫；`REFUND_DELAY = 7 days`、熔断与赎回闸逻辑**未改动**。

### `src/PredictionFactory.sol`
- **脱离 OZ `Ownable`**：改为自持两步 admin（`admin` / `pendingAdmin` / `onlyAdmin`）。
- 新增 `transferAdmin` / `acceptAdmin` / `owner()`（只读别名，恒等于 `admin`）。
- 删除单步路径：不再有 `transferOwnership` / `renounceOwnership`，杜绝"一次签名切错即永久失控"。
- `setImplementation` / `setFeeVault` 权限守卫从 `onlyOwner` 换成 `onlyAdmin`，行为等价。
- 构造函数增加 `owner_ != 0` 校验并 `emit AdminTransferred(0, owner_)`。
- `createMarket` 保持 **6 参**、保持 permissionless（建盘不是特权操作）。

设计要点（已用测试钉死）：**过渡期旧 admin 仍完整掌权**，不存在"已交出去但对方还没接"的空窗；
地址填错只需再调一次 `transferAdmin` 覆盖 `pendingAdmin`；任何人（含旧 admin）都无法代收。

---

## 三、测试改动（新增 10 条）

`test/PredictionSecurityTest.t.sol`（盘口侧）
1. `test_TwoStepAdminTransfer_RequiresAcceptance` —— 第 1 步后 admin 不变、pending 无权限、旧 admin 仍可 pause/unpause、第 2 步后权限整体迁移。
2. `test_Revert_OnlyPendingAdminCanAccept` —— 未登记 / 旧 admin 代收 / 第三方抢收 全部 `NotPendingAdmin`。
3. `test_TransferAdminCanOverwriteMistakenPending` —— 填错地址可覆盖，死地址收不走。
4. `test_Revert_TransferAdminGuards` —— 零地址 / 自己 / 非 admin / pending 越权发起，全部拒绝。
5. `test_PendingAdminCannotResolveBeforeAccept` —— 过渡期结算权仍在旧 admin，pending 提前 `resolve` 被拒。

`test/PredictionBusiness.t.sol`（工厂侧）
6. `test_FactoryTwoStepAdminTransfer` —— 含"旧 admin 在过渡期仍能建盘、`createMarket` 本身 permissionless"的显式断言。
7. `test_Revert_FactoryTransferAdminGuards` —— 零地址 / 自己 / 无 pending 时 `acceptAdmin`。
8. `test_FactoryTransferAdminCanOverwriteMistakenPending`。

`test/*` 里旧的单步用例 `test_TransferAdminMovesAllAdminPowers` 已按新语义重写（不是删除）。

`sdk/PredictionSDK.test.ts`（+4）
9. `transferAdmin` 编码（selector + 单 word）+ `acceptAdmin` 是独立交易。
10. 工厂侧同 ABI；未配置 factory 时 `BAD_CONFIG`。

---

## 四、SDK 改动

- 新增 `buildTransferAdmin(addr)` / `buildAcceptAdmin()` / `buildFactoryTransferAdmin(addr)` / `buildFactoryAcceptAdmin()`。
- 新增读接口 `getAdmin()` / `getPendingAdmin()`（含 `addr()` 解码 helper）。
- selector 落地（`cast sig` 实算，非猜）：`transferAdmin(address)=0x75829def`、`acceptAdmin()=0x0e18b681`、`pendingAdmin()=0x26782247`、`admin()=0xf851a440`。
- 新增错误码 `NOT_PENDING_ADMIN` + 中文文案 + revert 映射 `0x058d9a1b`。

---

## 五、脚本改动

`script/Deploy.s.sol`
- 改写为 `_cfg()` / `_deploy()` / `_report()` 三段（原实现触发 `Stack too deep`，实测报错后重构）。
- 按 chainid 自动选 USDC：8453 → `0x833589fC…A02913`，84532 → `0x036CbD53…dCF7e`，其它链必须显式传 `USDC`。
- 新增 `ADMIN_TRANSFER_TO`：部署末尾自动执行**两步移交第 1 步**（工厂 + 首盘各一次），并打印第 2 步命令。
- 新增参数断言：`maxImpactBps ∈ [1,500]`、`resolutionTime > now`、`ADMIN_TRANSFER_TO ≠ deployer`。
- 保留 6 参 `createMarket`。

---

## 六、Base Sepolia 真链状态演练（实测数据）

方式：`anvil --fork-url https://sepolia.base.org --chain-id 84532`（fork 高度 `49751419`），
抵押品为真 Sepolia USDC，`forge script ... --broadcast` 在 fork 上完整执行。

部署产物：

```
ConditionalToken     0x8f7a1defa8b06a8d66ea14a71a2ef2ce4ba1295b
ProtocolFeeVault     0xe3e1ea59710e5046c238c08ac7558ba2ccb7c445
PredictionVault impl 0x9d1bc2c13235fb96a2b01213fe9fe03184669d5d
PredictionFactory    0x30dec4d0b7c9899bed29adbe3a5d1a8d4ed7ab99
首个盘口 clone        0xfbec451aaa0e18242ec6e688a1c8e5a787d27ca3
```

行为验证（全部实拍，非推断）：

| 断言 | 实际返回 |
|---|---|
| `vault.collateral()` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e`（真 USDC） |
| 第 1 步后 `admin` / `pendingAdmin` | 部署者 / Safe（admin 未变） |
| 第三方 `acceptAdmin()` | revert `0x058d9a1b NotPendingAdmin` |
| 过渡期旧 admin `setFeeVault` | 成功（旧 admin 仍掌权） |
| Safe `acceptAdmin()` × 2 | 成功，两处 `admin=Safe`、`pendingAdmin=0x0` |
| 旧 admin `pause()` / `setImplementation()` | revert `0x47556579 OnlyAdmin` |
| 新 admin `pause()` | 成功，`paused()=true` |

说明：该轮广播落在 fork，不进公网。公网广播命令与核对清单见
`docs/BASE-SEPOLIA-DEPLOY-KEEPER.md`（第 4、5、6 节）。

---

## 七、生产部署前置（未完成项，不掩盖）

1. 公网 Base Sepolia 广播需要你自己的部署私钥 + 两个 Safe 地址（脚本已就绪，命令在手册第 4 节）。
2. 合约验证需要 Etherscan **V2** 多链 key（Basescan V1 端点已废弃，本机实测返回 `deprecated V1 endpoint`）。
3. 测试 USDC 只能靠 faucet 领取（Circle，10 USDC/24h）：灰度首盘用 100–500 USDC 双边即可跑通全链路，不必一上来 5,000。
4. 第三方审计仍未做（上主网硬门槛）。

---

## 八、复现命令

```bash
export PATH=/opt/foundry:$PATH
cd ~/prediction-market

forge build && forge test                    # 84/84
cd sdk && npm test && cd ..                  # 35/35
bash script/e2e-local.sh                     # 11/11, ALL GREEN

# Sepolia 干跑（不花钱，先看有没有炸）
set -a; source .env.sepolia; set +a
forge script script/Deploy.s.sol:Deploy --rpc-url $BASE_RPC_URL
```
