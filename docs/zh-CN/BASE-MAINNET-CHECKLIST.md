# Base 主网上线前 10 项终极核对清单

目标链：Base 主网 **chainId 8453**　USDC：`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
用法：逐条执行、逐条打勾。任何一条打不上勾就**停**，不要"先上线再补"。
配套：`docs/BASE-SEPOLIA-DEPLOY-KEEPER.md`（部署与 Keeper 全流程）、`REPORT-PHASE5.md`（本轮实测结论）

```bash
cd ~/prediction-market
export PATH=/opt/foundry:$PATH
set -a; source .env.mainnet; set +a
RPC=$BASE_RPC_URL
U=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
```

---

## ☐ 1. 三个关键地址都是 Safe 合约，且门限合理

```bash
for a in $TREASURY $MARKET_ADMIN $ADMIN_TRANSFER_TO; do
  echo "== $a  code_len=$(cast code $a --rpc-url $RPC | wc -c)"
  cast call $a "getThreshold()(uint256)"   --rpc-url $RPC    # 期望 >= 2
  cast call $a "getOwners()(address[])"    --rpc-url $RPC    # 期望 3~5 个，且不是同一人控制
done
```

**通过标准**：三个地址都有代码（不是 EOA）、门限 ≥ 2、owners 里没有已经废弃的地址。
部署脚本在主网会强制校验（`REQUIRE_SAFE_CONTRACT=true`），EOA 直接 `mainnet: TREASURY must be a Safe contract` 失败。

---

## ☐ 2. 抵押品是"原生 USDC"，不是 USDC.e、不是 WETH

```bash
cast call $U "symbol()(string)"   --rpc-url $RPC   # 期望 "USDC"
cast call $U "decimals()(uint8)"  --rpc-url $RPC   # 期望 6
cast call $U "name()(string)"     --rpc-url $RPC   # 期望 "USD Coin"
```

**通过标准**：`symbol=USDC`、`decimals=6`。脚本还会 staticcall `decimals()` 再校验一次；
把 WETH（18 位）传进 `USDC` 会被 `USDC decimals must be 6` 直接拦下（已实测）。

---

## ☐ 3. 干跑通过，gas 与余额都有余量

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url $RPC
cast balance $(cast wallet address --private-key $PRIVATE_KEY) --rpc-url $RPC
```

**通过标准**：干跑打印 `Chain 8453` + `Estimated total gas used for script`（实测约 **8,539,550 gas ≈ 0.00009 ETH**），
部署钱包余额 ≥ 0.005 ETH（预留建盘、做市、失败的余量）。**没干跑不许广播。**

---

## ☐ 4. 首个盘口 6 个参数落库与预期逐字一致

```bash
cast call $VAULT "minBet()(uint256)"        --rpc-url $RPC   # 5000000
cast call $VAULT "maxBet()(uint256)"        --rpc-url $RPC   # 10000000000
cast call $VAULT "maxImpactBps()(uint256)"  --rpc-url $RPC   # 500
cast call $VAULT "resolutionTime()(uint256)" --rpc-url $RPC  # = RESOLUTION_TIME，且 > now
cast call $VAULT "TRADE_FEE_BPS()(uint256)" --rpc-url $RPC   # 150
cast call $VAULT "SETTLE_FEE_BPS()(uint256)" --rpc-url $RPC  # 50
cast call $VAULT "REFUND_DELAY()(uint256)"  --rpc-url $RPC   # 604800
```

**通过标准**：全部等于上表期望值；`resolutionTime` 必须比现在晚 ≥ 30 天（否则一上线就逼近 7 天退款窗口）。

---

## ☐ 5. 抵押品绑定与偿付性

```bash
cast call $VAULT "collateral()(address)"        --rpc-url $RPC   # == $U
cast call $CT    "collateral()(address)"        --rpc-url $RPC   # == $U
cast call $CT    "isSolvent(bytes32)(bool)" $CID --rpc-url $RPC  # true（做市后应仍为 true）
cast call $VAULT "depth()(uint256)"             --rpc-url $RPC   # = 做市投入 × 2
```

**通过标准**：两个 `collateral()` 都是原生 USDC；做完市后 `isSolvent(cid)=true`、`depth` 等于双边投入之和。

---

## ☐ 6. 两步移交第 2 步已完成（这一步最容易漏）

```bash
cast call $FACTORY "admin()(address)"        --rpc-url $RPC   # 期望 = $ADMIN_TRANSFER_TO
cast call $FACTORY "pendingAdmin()(address)" --rpc-url $RPC  # 期望 0x000...000
cast call $VAULT   "admin()(address)"        --rpc-url $RPC   # 期望 = $MARKET_ADMIN
cast call $VAULT   "pendingAdmin()(address)" --rpc-url $RPC  # 期望 0x000...000

# 旧部署者必须全部失效（两条都应看到 OnlyAdmin）
cast send $FACTORY "setImplementation(address)" $VAULT --private-key $PRIVATE_KEY --rpc-url $RPC
cast send $VAULT   "pause()"                           --private-key $PRIVATE_KEY --rpc-url $RPC
```

**通过标准**：两处 `admin` 都是 Safe、`pendingAdmin` 归零、旧部署者两条命令都 revert `OnlyAdmin`。
Safe 侧执行方式：Transaction Builder → `To=factory`、`Data=0x0e18b681`（`acceptAdmin()`）→ 门限签名 → Execute。
**注意**：盘口的 admin 是建盘时写入的 `MARKET_ADMIN`，不是部署者 —— 若两者不是同一个 Safe，
盘口侧的 `transferAdmin` 必须由 `MARKET_ADMIN` 自己发起（脚本会打印这条告警）。

---

## ☐ 7. 熔断 + 7 天退款例外窗口（真金白银演练一次）

```bash
# 暂停：下单必须失败
cast send $VAULT "pause()" --private-key $SAFE_PK --rpc-url $RPC
cast call $VAULT "tradingOpen()(bool)"                     --rpc-url $RPC  # false
cast call $VAULT "refundAvailableAt()(uint256)"            --rpc-url $RPC  # resolutionTime + 7d
# 恢复
cast send $VAULT "unpause()" --private-key $SAFE_PK --rpc-url $RPC

# 超时退款（permissionless，任何人可调；用一个 near-future 的小盘口演练）
cast send $VAULT_NEAR "emergencyRefund()" --private-key $KEEPER_PK --rpc-url $RPC
cast call $VAULT_NEAR "outcome()(uint8)"                   --rpc-url $RPC  # 2 = INVALID
```

**通过标准**：暂停后 `tradingOpen=false`；`resolutionTime+7d` 之后即使暂停，`redeem()` 也必须能成功
（这是刻意的安全例外，不能被"优化"掉）；`emergencyRefund` 无需任何权限即可把盘口置 INVALID 并按 0.5/0.5 赔付。

---

## ☐ 8. 手续费链路端到端走通

```bash
cast call $VAULT   "feeVault()(address)"     --rpc-url $RPC  # == ProtocolFeeVault
cast call $FEEVAULT "treasury()(address)"    --rpc-url $RPC  # == $TREASURY
cast call $FEEVAULT "pendingFees()(uint256)" --rpc-url $RPC  # 成交后 > 0
cast send $FEEVAULT "autoDistributeFee()" --private-key $KEEPER_PK --rpc-url $RPC   # 任何人可调
cast call $FEEVAULT "totalDistributed()(uint256)" --rpc-url $RPC
```

**通过标准**：`feeVault` 指向 ProtocolFeeVault；`autoDistributeFee` 由 keeper 钱包（非 admin）调用成功，
钱只进 `treasury`；`totalDistributed` 单调递增。`vault.setFeeVault` 变更必须留 `FeeVaultUpdated` 事件。

---

## ☐ 9. Keeper 灰度：dry-run → once → 常驻，24h 无异常

```bash
cd keeper && npm install
KEEPER_RPC_URL=$RPC KEEPER_FACTORY=$FACTORY KEEPER_FEE_VAULT=$FEEVAULT \
  node keeper.js --config config.json --dry-run      # ① 只看不写：列出全部盘口
KEEPER_RPC_URL=$RPC KEEPER_FACTORY=$FACTORY KEEPER_FEE_VAULT=$FEEVAULT \
KEEPER_PRIVATE_KEY=$KEEPER_PK node keeper.js --config config.json --once   # ② 跑一轮真交易
ls -1 proposals/                                     #    过期盘口应产出 xxx-RESOLUTION_OVERDUE.json
sudo systemctl enable --now prediction-keeper && journalctl -u prediction-keeper -f   # ③ 常驻
```

**通过标准**：dry-run 扫到 `marketCount()` 个盘口；`--once` 之后 `pendingFees` 归零且 `proposals/` 有产物；
webhook 真实收到一次告警；连续 24h 日志无 ERROR、无 `maxFeePerGas` 越界刷屏。
Keeper 私钥**只能**是普通热钱包（它只会调 `autoDistributeFee` / `emergencyRefund` 两个 permissionless 函数）。

---

## ☐ 10. 前端 / SDK 抗夹子链路已接线（不是"代码里有"就算完）

```ts
const sdk = new PredictionSDK(transport, {
  vault: VAULT,
  factory: FACTORY,
  chainId: 8453,
  routes: [ mevProtectedRoute({ chainId: 8453, url: PRIVATE_RPC_URL, id: "prod-private" }) ],
  submitTimeoutMs: 4000,
  maxQuoteAgeMs: 2000,
});

// 买入：报价 → 完整性自检 → 新鲜度闸门 → 签名 → 私有路由提交
const { hash, route } = await sdk.signAndSubmitBuy(
  { outcome: 1, amountIn: 50_000_000n, slippageBps: 100 },
  (tx) => wallet.signTransaction(tx),
);
```

**通过标准**（逐项在真机上点一遍）：

| 检查 | 期望表现 |
|---|---|
| 私有路由生效 | 返回值 `route.privacy === "private-relay"`；公开 RPC 的 mempool 里看不到这笔 |
| `minSharesOut` 永不为 0 | calldata 第 3 个 word > 0，且等于 UI 上展示的最少到手份额 |
| 价格跑动 | 改价后点确认 → 立刻弹「价格已跑出滑点，已拦截」，**钱包没有弹出签名**（`QUOTE_STALE`） |
| 网络抖动 | 私有路由无响应 → 提示「结果未知，请先查回执」，**不自动改投公开池**（`SUBMIT_AMBIGUOUS`） |
| 回执确认 | `sdk.waitForReceipt(hash)` 能等到 status=0x1，浏览器能查到同一 hash |
| 错误文案 | `PredictionSDK.mapRevert(e).message` 全部是中文人话，没有裸 hex |

> 关键背景（别被"Base 有私有 mempool"这句话骗到）：Base 是单排序器、**没有公开 pending mempool**，
> 传统 mempool 抢跑不成立；但 RPC 层可见性、Flashblocks ~200ms 预确认、以及转卖订单流的中间商
> 仍然构成夹子面。所以链路是：**私有端点（自己买）+ 严格 minSharesOut（链上兜底）+ 报价新鲜度（本地闸门）** 三层，
> 缺一层都不算"防夹"。

---

## 上线前最后一小时（按顺序，别跳）

```bash
# 1) 冻结代码：打 tag，记下 commit
git rev-parse --short HEAD && git tag -a mainnet-v1 -m "Base mainnet launch"

# 2) 全绿复跑（本机实测 89/89 + 46/46 + 11/11）
forge test && (cd sdk && npm test) && bash script/e2e-local.sh

# 3) 静态扫描：高危=0 中危=0
slither . --solc /root/.local/share/svm/0.8.24/solc-0.8.24 \
  --filter-paths "lib/|test/|script/"

# 4) 广播
forge script script/Deploy.s.sol:Deploy --rpc-url $RPC --broadcast \
  --verify --verifier etherscan \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=8453" \
  --etherscan-api-key $ETHERSCAN_API_KEY

# 5) 按本清单第 1~10 项逐条打勾（第 6、7 项必须真发交易）
```

---

## 附录 A：事件 → 索引器接入表（本轮已补齐缺口）

| 合约 | 事件 | indexed 字段 | 触发点 | 索引器用途 |
|---|---|---|---|---|
| PredictionFactory | `MarketCreated` | vault, conditionId, creator | createMarket | 盘口目录（含 6 参参数） |
| PredictionFactory | `AdminTransferStarted` | currentAdmin, pendingAdmin | transferAdmin | 移交中状态（pending 谁） |
| PredictionFactory | `AdminTransferred` | oldAdmin, newAdmin | **acceptAdmin**（含构造函数） | 所有权流水 |
| PredictionFactory | `ImplementationUpdated` / `FeeVaultUpdated` | old, new | 对应 setter | 实现/金库变更审计 |
| PredictionVault | `Initialized` | conditionId | clone initialize | 盘口初始化快照（含 admin/feeVault/参数） |
| PredictionVault | `LiquidityAdded` / `LiquidityRemoved` | provider | add/removeLiquidity | LP 份额账本 |
| PredictionVault | `SharesBought` / `SharesSold` | buyer / seller | buy / sell | 成交明细、价格曲线重建 |
| PredictionVault | `MarketResolved` | 无（按 emitter 地址过滤） | resolve / emergencyRefund | 结算结果（含 `emergency` 标志） |
| PredictionVault | `Redeemed` | account | redeem | 赔付流水 |
| PredictionVault | `AdminTransferStarted` / `AdminTransferred` | 同上 | 两步移交 | 盘口控制权流水 |
| PredictionVault | `FeeVaultUpdated` | old, new | **本轮新增** setFeeVault | 费率流向变更留痕 |
| PredictionVault | `Paused` / `Unpaused`（OZ） | account | pause/unpause/setPaused | 熔断状态时间线 |
| ConditionalToken | `ConditionRegistered` / `ConditionResolved` | conditionId, market | factory / vault | 条件生命周期 |
| ConditionalToken | `PositionSplit` / `PositionMerged` / `PositionRedeemed` | conditionId, account | 对应函数 | 份额与抵押品流水 |
| ConditionalToken | `OwnershipTransferStarted` / `OwnershipTransferred` / `FactoryUpdated` | — | Ownable2Step / setFactory | 管理权与工厂绑定 |
| ProtocolFeeVault | `TreasuryUpdated` / `FeeDistributed` | old/new；caller, treasury | setTreasury / autoDistributeFee | 手续费到账与提现 |
| ProtocolFeeVault | （无合约事件）手续费**流入** | — | ERC20 `Transfer(to=feeVault)` | 用 USDC Transfer 反查，`FeeReceived` 死事件已删 |

**命名说明**：需求里提到的 `AdminAccepted` 在本实现中就是 **`AdminTransferred`**（只在 `acceptAdmin()` 成功时触发）。
没有额外造一条重复日志 —— 一个状态变更只该有一条事件，索引器按 `AdminTransferStarted`（开始）→ `AdminTransferred`（完成）配对即可。

---

## 附录 B：已知残余风险（上线不是"零风险"，这四条要明说）

1. **未做第三方审计**：Slither 0 高/0 中只是自动化扫描，不等于人工审计。主网前必须补。
2. **结算仍是中心化决定**：`resolve()` 由 `MARKET_ADMIN` 单方给出 outcome。Safe 多签降低单点风险，但不消除作恶/误判可能；
   7 天退款例外只兜"不结算"，不兜"错结算"。若要更强，需要 UMA/Chainlink 预言机或争议期机制（未实现）。
3. **Base 排序器单点**：出块与排序由 Coinbase 运营的 sequencer 决定，存在停机/审查的可能性；合约层无对冲手段。
4. **Keeper 私钥是热钱包**：即使只有 permissionless 权限，被盗也只能被用来"提前分发手续费/提前触发退款"（资金流向不可改），
   但仍是可被滥用的操作面 —— 定期轮换、限额、监控。

---

## 附录 C：本轮实测数字（可复现）

| 项目 | 数字 |
|---|---|
| `forge test` | **89 / 89**（Business 40 + Security 47 + Invariant 2） |
| SDK 单测 | **46 / 46** |
| 本地 E2E | **11 / 11，ALL GREEN** |
| Slither（4 个核心合约） | **0 High / 0 Medium**，Low 8（全部为 `block.timestamp` 业务必需比较）、Info 11 |
| Base 主网 fork 部署 | chainId 8453、真 USDC、gas 8,539,550、`safe-only=true` 全通过 |
| 两步移交（主网 fork） | factory `admin=Safe`、`pendingAdmin=0`；旧 EOA 全部 `OnlyAdmin` |
| 辅助合约所有权（主网 fork） | `ConditionalToken.owner` 经 Ownable2Step 两步迁到 Safe；`renounceOwnership` → `RenounceDisabled(0x89051165)` |
