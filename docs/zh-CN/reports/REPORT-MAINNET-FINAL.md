# Base 主网发车前的最终确认报告

日期：2026-10-25　范围：`CentralPredictionEngine`（单合约多盘口）+ Hermes 大脑 + 工作区清理
本轮新增：**裁决争议缓冲期（1h）+ 抗插针多态确认（3×30s）+ 旧架构归档**

---

## 一、结论（先给数字）

| 项目 | 结果 |
|---|---|
| `forge test`（主工程） | **46 passed / 0 failed**（45 条单元 + 1 个不变式套件，套件内含 **5 条不变式 × 1000 runs × 100 calls = 100,000 次随机调用，reverts 0**） |
| `cd legacy && forge test`（旧实现，独立工程） | **89 passed / 0 failed** |
| `hermes/test_brain.py` | **22 passed** |
| `sdk && npm test` | **90 passed**（旧 SDK 46 + 新引擎 SDK 44） |
| `bash script/e2e-dispute.sh`（anvil 真价格全流程） | **9/9 PASS，ALL GREEN** |
| Slither（含新代码，排除 lib/test/script/mocks/legacy） | **18 条：0 High / 0 Medium**（Low 12 全是 `block.timestamp` 业务比较；Info 6 = `buyShares/sellShares` 圈复杂度 2 + solc 版本提示 4） |
| Base 主网 fork 部署 gas | **4,582,141**（block 53,076,846，baseFee 0.004997 gwei ≈ **$0.07–0.09**） |
| 合约尺寸（EIP-170 限 24,576 B） | 引擎 runtime **13,196 B**（余量 11,380 B）、FeeVault **1,798 B** |

---

## 二、合约：裁决争议缓冲期（`DISPUTE_WINDOW = 1 hours`）

### 状态机

```
                 resolveMarket(id, outcome)
未裁决 ───────────────────────────────────► Disputing（resolved=true, finalized=false,
              （必须 now >= resolutionTime）       disputeEndsAt = now + 1h, owed 定死）
                                                     │
                              ┌──────────────────────┴───────────────────────┐
                              │ 争议期内 now < disputeEndsAt                  │ 争议期后 now >= disputeEndsAt
                              ▼                                              ▼
              redeem / sweep → revert DisputeWindowOpen            redeem 立即可用（无需任何交易）
              admin.overrideResolution(id, 新结果) 可改判            overrideResolution → revert
              owed 按 yesUserAtSettle/noUserAtSettle 重算            finalize(id) 任何人可调，仅 emit 日志
              仍强制 require(cash >= owed)
```

- **无人介入就自动放行**：终结判断是纯时间戳（`m.finalized || block.timestamp >= m.disputeEndsAt`），
  不依赖 keeper 发交易、不依赖 admin 动作 —— 不存在「所有人都忘了 → 钱永远取不出来」。
- **改判不延长窗口**：窗口从第一次裁定起算死，admin 连续改 3 次也不会把 1 小时拖成 3 小时。
- **改判动不了钱**：`owed` 只能按结算瞬间快照的 `yesUserAtSettle / noUserAtSettle` 重算，且每次改判都
  `require(cash >= owed)`；争议期内赎回全封，所以重算不会出现「已经付出去的钱又被重算」。
- **兜底退款不走争议期**：`emergencyRefund`（结算时间 + 7 天）直接 `finalized = true`，立即可以提现。

### 新增接口 / 事件 / 错误

| 类型 | 定义 |
|---|---|
| 常量 | `DISPUTE_WINDOW = 1 hours`（constant，admin 改不了） |
| 函数 | `overrideResolution(bytes32,uint8)` — onlyAdmin，争议期内改判 |
| 函数 | `finalize(bytes32)` — 无权限，仅用于给索引器一条明确日志 |
| 视图 | `resolutionState(bytes32) → (resolved, finalized, disputing, outcome, disputeEndsAt, owed)` |
| 视图 | `isFinal(bytes32) → bool` |
| 事件 | `DisputeWindowOpened(marketId, outcome, disputeEndsAt, owed)` |
| 事件 | `ResolutionOverridden(marketId, oldOutcome, newOutcome, newOwed, disputes)` |
| 事件 | `ResolutionFinalized(marketId, outcome, owed)` |
| 错误 | `DisputeWindowOpen()` / `DisputeWindowClosed()` / `SameOutcome()` |

### 新增测试（10 条，全绿）

1. `test_Dispute_ResolveOpensOneHourWindowAndBlocksRedeem` — 窗口开启、赎回/扫账双拒、到点自动放开
2. `test_Dispute_WindowBoundaryIsInclusive` — `endsAt-1` 拒绝、`endsAt` 放行
3. `test_Dispute_AdminCanFlipOutcomeToTheRealWinner` — 改判后新赢家全额赔付、旧赢家归零、窗口不变、A1 仍成立
4. `test_Dispute_OverrideToInvalidSplitsHalfHalf` — 改判 INVALID 后 0.5/0.5、无结算费
5. `test_Dispute_OverrideCanBeAppliedMultipleTimesButNeverExtends` — 连改 3 次窗口不动
6. `test_Revert_Override_WrongCallerOutcomeOrWindow` — 未裁决/非 admin/同结果/非法值/窗口已过 5 个负例
7. `test_Finalize_PermissionlessAfterWindowEmitsEvent` — 窗口内拒、之后任何人可调、二次调用拒
8. `test_Dispute_EventCarriesWindowAndOwed` — 事件参数逐字校验
9. `test_EmergencyRefund_IsFinalImmediatelyNoDisputeWait` — 兜底退款不等 1 小时
10. `test_Finalize_RejectsUnknownMarket` — 不存在的盘口

不变式新增 A5：`争议期内 sweepable == 0` 且 `resolved ⇒ cash >= owed`（改判后依然成立）。

---

## 三、大脑：抗插针多态确认（3 次 × 30 秒）

`OracleEngine` 现在这样裁决：

```
到期 → sample#1 ──30s──► sample#2 ──30s──► sample#3
         │                  │                  │
         └──── 3 次全部落在同一侧 ──► resolveMarket(id, outcome)   （reason 里带 "3/3 confirmed"）
              任一次取价失败        ──► skip（不结算，下一轮重采）
              三次结果不一致        ──► skip（"price flipped inside confirmation window"，判为插针）
              行情 age > 5min       ──► skip（stale）
              结算 + 7 天仍无行情   ──► emergencyRefund(id)
```

- 默认 `ORACLE_CONFIRM_SAMPLES=3`、`ORACLE_CONFIRM_GAP=30`，也可用 `--confirm-samples/--confirm-gap` 覆盖。
- 新单测 7 条：三次一致、中途翻转、最后一次翻转、采样失败即中止（并断言只在 2 次后停）、
  默认参数断言、三次一致判 NO、以及 cast 输出解析（`[1.793e9]` 注解 + 一行一个返回值两种形态）。
- 实测日志（真实 CoinGecko 价格，间隔真实等待 30s）：
  ```
  sample 1/3: BTC = 80,493.20 (coingecko)
  waiting 30s before the next sample
  sample 2/3: BTC = 80,493.20 (coingecko)
  waiting 30s before the next sample
  sample 3/3: BTC = 80,510.38 (coingecko)
  -> resolve (BTC spot 80,493.20~80,510.38 vs threshold 81,500 (coingecko, 3/3 confirmed))
  in dispute window until 2026-10-29T21:39:34+00:00 (Safe can still override)
  ```

---

## 四、工作区清理：主工程 vs 归档

主工程现在只剩主网要部署的东西：

```
src/     CentralPredictionEngine.sol   ProtocolFeeVault.sol
         libraries/FixedPoint.sol      mocks/MockUSDC.sol（仅本地/测试用）
test/    CentralEngine.t.sol（45）     CentralEngineInvariant.t.sol（5 条不变式）
script/  DeployCentral.s.sol           e2e-dispute.sh
hermes/  hermes_brain.py  test_brain.py  README.md
docs/    CENTRAL-ENGINE.md  BASE-MAINNET-CHECKLIST.md（旧工厂版，仅存档）
legacy/  ← 旧架构全部搬到这里，独立 foundry 工程，不参与主工程编译
         contracts/{PredictionVault,PredictionFactory,ConditionalToken,ProtocolFeeVault,RehearsalSafe}
         test/{PredictionBusiness 40, PredictionSecurityTest 47, PredictionInvariant 2, BasePrediction}
         script/{Deploy.s.sol, DeployLocal.s.sol, PredictionSecurityTest.s.sol, e2e-local.sh}
         foundry.toml（src=contracts, libs=../lib）→ `cd legacy && forge test` = 89 passed
```

`sdk/PredictionSDK.ts` 保留（46 条测试仍全绿），但文件头已加显式警告：它的 calldata 编码器绑定的是
**已被归档的旧 vault/factory**，前端接新引擎不能复用那层选择器；可复用的只有 MEV 路由/私有提交/报价新鲜度
这一层与合约无关的逻辑。**基于新引擎的 SDK 尚未重写，这是当前唯一的前端缺口。**

---

## 五、Base 主网 fork 实测（`anvil --fork-url https://mainnet.base.org --chain-id 8453`）

| 检查 | 结果 |
|---|---|
| chainid / block | 8453 / 53,076,846 |
| 真 USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `symbol="USDC"`, `decimals=6` ✅ |
| 部署（FeeVault + Engine） | **4,582,141 gas**，baseFee 0.004997 gwei → **约 $0.07–0.09** |
| 负例：`ADMIN` 填部署者 EOA | revert `mainnet: ADMIN must not be the deployer EOA` ✅ |
| 负例：拿 WETH 当抵押品 | revert `collateral decimals must be 6` ✅ |
| `ADMIN` 是 Safe 时的行为 | 脚本**不会**假装授权成功：打印 `setCreator` / `setOracle` 的 calldata（`0x6eeb7a36…` / `0x65360843…`），由多签执行 ✅ |

> 注：fork 上没有真 USDC 余额，所以「真币下注」这一步没在 fork 上跑；同样的 ERC20 语义（6 位、
> 标准 transferFrom）已由本地 MockUSDC 全流程覆盖，真 USDC 的地址/精度/代码存在性已在 fork 上校验。

---

## 六、主网发车 8 步（按顺序做）

```bash
export PATH=/opt/foundry:$PATH
cd ~/prediction-market
```

1. **配对**：准备 Safe（ADMIN 与 TREASURY 都必须合约地址，脚本会强制）；Hermes 建盘 key 与裁决 key 分开。
2. **干跑**（不发交易，只看参数）：
   ```bash
   PRIVATE_KEY=$DEPLOY_PK ADMIN=$SAFE TREASURY=$TREASURY_SAFE \
   CREATOR=$BRAIN_ADDR ORACLE=$ORACLE_ADDR \
   forge script script/DeployCentral.s.sol:DeployCentral --rpc-url $BASE_RPC_URL
   ```
3. **广播 + 验证**：
   ```bash
   PRIVATE_KEY=$DEPLOY_PK ADMIN=$SAFE TREASURY=$TREASURY_SAFE \
   CREATOR=$BRAIN_ADDR ORACLE=$ORACLE_ADDR \
   forge script script/DeployCentral.s.sol:DeployCentral --rpc-url $BASE_RPC_URL --broadcast \
     --verify --verifier etherscan \
     --verifier-url "https://api.etherscan.io/v2/api?chainid=8453" \
     --etherscan-api-key $ETHERSCAN_API_KEY
   ```
4. **Safe 执行两条授权**（脚本日志里直接给了 calldata）：
   `setCreator($BRAIN_ADDR,true)`、`setOracle($ORACLE_ADDR,true)`。
5. **核对部署后状态**（全部应满足）：
   ```bash
   cast call $ENGINE "admin()(address)" --rpc-url $BASE_RPC_URL            # == SAFE
   cast call $ENGINE "pendingAdmin()(address)" --rpc-url $BASE_RPC_URL     # == 0x0
   cast call $ENGINE "creators(address)(bool)" $BRAIN_ADDR --rpc-url $BASE_RPC_URL   # true
   cast call $ENGINE "oracles(address)(bool)"  $ORACLE_ADDR --rpc-url $BASE_RPC_URL  # true
   cast call $ENGINE "MIN_BET()(uint256)" --rpc-url $BASE_RPC_URL          # 5000000
   cast call $ENGINE "MAX_BET()(uint256)" --rpc-url $BASE_RPC_URL          # 10000000000
   cast call $ENGINE "TRADE_FEE_BPS()(uint256)" --rpc-url $BASE_RPC_URL    # 150
   cast call $ENGINE "SETTLE_FEE_BPS()(uint256)" --rpc-url $BASE_RPC_URL   # 50
   cast call $ENGINE "DISPUTE_WINDOW()(uint256)" --rpc-url $BASE_RPC_URL   # 3600
   cast call $ENGINE "REFUND_DELAY()(uint256)" --rpc-url $BASE_RPC_URL     # 604800
   ```
6. **首盘灰度**：`SEED_USDC=50` 级别起一个 24h 小盘，人工盯完整周期：
   建盘 → 下注 → 到期 → 3×30s 确认 → 争议期 → 提现。确认 `feeVault` 收到 1.5% / 0.5%。
7. **Keeper 常驻**：systemd（模板见 `hermes/README.md`），先 `--require-confirm` 观察 3–5 个盘口，再切全自动。
8. **事故预案**：admin `pause()` 只能停「交易」，停不住「7 天后强制赎回」；改判只在争议期内有效，
   过了就永久锁定 —— 这一条要在上线前和做市方说清楚。

---

## 七、仍然没做的（不给模糊话）

1. **第三方审计**：没有。目前只有 Slither（0 High / 0 Medium）+ 46 条 forge（含 100k 次随机调用的不变式）
   + 89 条旧回归 + 22 条大脑单测 + 1 次 anvil 全流程。上主网前建议至少一次外部审计，重点是
   `_applyBuy/_quoteSell` 的舍入方向与 `overrideResolution` 的资金重算。
2. **预言机可信来源**：仍是 CoinGecko/Binance 现货 + 3 次确认。生产建议接 Chainlink/Pyth 签名价格或链上 TWAP；
   现在的 1 小时争议期只是把「误判」从永久变成可纠错，不是消除。
3. **裁决不是去中心化仲裁**：没有质押罚没、没有 UMA 式挑战者。信任模型 = Hermes 出题+裁决 + Safe 兜底改判。
4. ~~前端 SDK 未接新引擎~~ → **已完成**：`sdk/CentralPredictionSDK.ts`（7 个 builder + 双层错误码 + 保护价三道闸），
   44 条单测（选择器/calldata 与 `cast` 逐字节对齐）+ `script/e2e-sdk-central.sh` 真链联调 10 项全 PASS。
   旧 `sdk/PredictionSDK.ts` 仍保留 46 条回归，但它绑定的 vault/factory 已归档，不能用于新引擎。
5. **fork 上没用真 USDC 下注**（无余额）；真 USDC 只验证了地址/精度/部署 gas。
6. **单合约爆炸半径**：所有盘口共享一份代码与一个金库账面。账本隔离靠 A1–A5 不变式 + 每盘 `cash/owed`
   独立记账保证，但代码风险不再按盘隔离 —— 这是单合约架构的固有代价。

---

## 八、复现命令

```bash
cd ~/prediction-market && export PATH=/opt/foundry:$PATH
forge test                                   # 46 passed
bash script/e2e-dispute.sh                   # 9/9 PASS（会真实等待 60s 做 3 次采样）
cd hermes && python3 -m unittest test_brain.py   # 22 passed
cd ../sdk && npm test                        # 90 passed（46 旧 + 44 新）
bash ../script/e2e-sdk-central.sh            # 新引擎 SDK 真链联调 10 项全 PASS
cd ../legacy && forge test                   # 89 passed（旧架构存档）
cd .. && slither . --solc /root/.local/share/svm/0.8.24/solc-0.8.24 \
  --filter-paths "lib/|test/|script/|mocks/|legacy/"    # 18 条，0 High / 0 Medium
```
