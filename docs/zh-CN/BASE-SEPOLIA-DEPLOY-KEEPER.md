# Base Sepolia 测试网正式部署与自动化 Keeper 启动手册

版本：2026-10-25　适用 commit：本手册与 `src/PredictionFactory.sol` 的两步 admin 版本同时提交
前提：本地 `forge test` 84/84、SDK 35/35、E2E 11/11 全绿（见 `REPORT-PHASE4.md`）

---

## 0. 一页流程

```
① 领测试币（ETH + USDC）
② 填 .env.sepolia（.env.sepolia.example 是模板）
③ forge script 干跑（不花 gas，先看有没有炸）
④ forge script 广播（真部署 4 个合约 + 建首个盘口 + 两步移交第 1 步）
⑤ 部署后核对 12 项（admin/pendingAdmin/常量/USDC 绑定）
⑥ 两步移交第 2 步：Safe 自己调 acceptAdmin()（盘口 + 工厂各一次）
⑦ 做市（approve → splitPosition → setApprovalForAll → addLiquidity）
⑧ Keeper 先 --dry-run，再 --once，最后 systemd 常驻
⑨ 熔断 + 超时退款演练，确认 7 天例外窗口真的能救人
```

---

## 1. 前置条件

| 项 | 要求 | 获取方式 |
|---|---|---|
| Base Sepolia ETH（gas） | 0.05 ETH 足够（实测整套部署 8,444,040 gas ≈ 0.00013 ETH @0.005 gwei 基础费） | https://faucet.quicknode.com/base/sepolia |
| Base Sepolia USDC（做市） | 首盘双边各 ≥ 5,000 USDC | https://faucet.circle.com → 选 Base Sepolia（每 24h 10 USDC/次） |
| Circle USDC 地址 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | 已在本机实测：`symbol()=USDC`、`decimals()=6`、`chainId=84532` |
| foundry | `/opt/foundry`（musl 版，forge 1.8.5-dev） | `export PATH=/opt/foundry:$PATH` |
| Safe 多签 | 2 个：`TREASURY`（收款）、`PROTOCOL_SAFE`（admin 接管） | https://app.safe.global（Base Sepolia 网络） |

> 先核对 Safe，别等上线才发现地址抄错：
> ```bash
> cast call $SAFE "getOwners()(address[])"  --rpc-url $BASE_RPC_URL
> cast call $SAFE "getThreshold()(uint256)" --rpc-url $BASE_RPC_URL
> ```
> 即使抄错了也不会失控 —— 两步移交下部署者仍是 admin，重新 `transferAdmin` 覆盖即可（这是本次改造的核心收益）。

---

## 2. 环境变量

```bash
cd ~/prediction-market
cp .env.sepolia.example .env.sepolia
# 填 4 个东西：PRIVATE_KEY / TREASURY / MARKET_ADMIN / ADMIN_TRANSFER_TO
# 其余可留默认；CONDITION_ID 和 RESOLUTION_TIME 用下面两条命令生成
export CONDITION_ID=$(cast keccak "SEPOLIA-BTC-100K-2026Q4")
export RESOLUTION_TIME=$(( $(date +%s) + 30*86400 ))
set -a; source .env.sepolia; set +a
export PATH=/opt/foundry:$PATH
```

`script/Deploy.s.sol` 会读：`PRIVATE_KEY`、`TREASURY`（必填）、`USDC`（缺省按 chainid 自动选，84532 → Sepolia USDC）、
`MARKET_ADMIN`（缺省=部署者）、`ADMIN_TRANSFER_TO`（缺省=不移交）、`CONDITION_ID`、`RESOLUTION_TIME`、
`MIN_BET`、`MAX_BET`、`MAX_IMPACT_BPS`。

脚本内置的链下断言（不满足直接 require 失败，不会带病上链）：
treasury ≠ 0、minBet ≥ 5 USDC、maxBet ∈ [minBet, 10,000 USDC]、maxImpactBps ∈ [1,500]、
resolutionTime 在未来、USDC 地址有代码、`ADMIN_TRANSFER_TO ≠ 部署者`。

---

## 3. 干跑（不广播）

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url $BASE_RPC_URL
```

输出里必须看到 `Chain 84532`、`Estimated total gas used for script` 和 4 个合约的预估地址；
任何 revert 都在这一步暴露，钱包不会掉 gas。**没干跑过不要广播。**

---

## 4. 正式广播

```bash
forge script script/Deploy.s.sol:Deploy \
  --rpc-url $BASE_RPC_URL \
  --broadcast \
  --verify \
  --verifier etherscan \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=84532" \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

- Basescan 的 V1 接口已废弃（本机实测返回 `You are using a deprecated V1 endpoint`），所以验证必须走 **Etherscan V2 多链 key + `?chainid=84532`**。
- 没有 key 就先 `--skip` 后面的验证参数，之后补：
  `forge verify-contract <addr> src/PredictionVault.sol:PredictionVault --rpc-url $BASE_RPC_URL --verifier etherscan --verifier-url "https://api.etherscan.io/v2/api?chainid=84532" --etherscan-api-key $KEY`
- 广播产物：`broadcast/Deploy.s.sol/84532/run-latest.json`（每个合约地址 + tx hash，别手抄）。

部署脚本内部顺序（不可颠倒）：

| # | 动作 | 失败后果 |
|---|---|---|
| 1 | `new ConditionalToken(USDC, deployer)` | — |
| 2 | `new ProtocolFeeVault(USDC, TREASURY, deployer)` | treasury 填错 → 手续费永久打给错地址 |
| 3 | `new PredictionVault()`（仅克隆模板） | — |
| 4 | `new PredictionFactory(impl, ct, feeVault, deployer)` | — |
| 5 | `ct.setFactory(factory)` | **漏掉则 createMarket 全部 NotMarket 失败** |
| 6 | `factory.createMarket(cid, admin, rt, minBet, maxBet, impact)` | 6 参，参数落死 |
| 7 | `factory.transferAdmin(ADMIN_TRANSFER_TO)` + `firstVault.transferAdmin(...)` | 只登记 `pendingAdmin`，`admin` 不动 |

---

## 5. 部署后核对（12 项，逐条打勾再往下走）

```bash
RPC=$BASE_RPC_URL
F=$FACTORY; V=$VAULT; U=0x036CbD53842c5426634e7929541eC2318f3dCF7e

cast call $V "admin()(address)"              # MARKET_ADMIN（默认为部署者 EOA 时才是部署者）
cast call $V "pendingAdmin()(address)"       # PROTOCOL_SAFE
cast call $F "admin()(address)"              # 部署者 EOA
cast call $F "pendingAdmin()(address)"       # PROTOCOL_SAFE
cast call $V "collateral()(address)"         # 必须 == $U
cast call $V "minBet()(uint256)"             # 5000000
cast call $V "maxBet()(uint256)"             # 10000000000
cast call $V "maxImpactBps()(uint256)"       # 500
cast call $V "TRADE_FEE_BPS()(uint256)"      # 150
cast call $V "SETTLE_FEE_BPS()(uint256)"     # 50
cast call $V "REFUND_DELAY()(uint256)"       # 604800
cast call $V "paused()(bool)"                # false
cast call $F "owner()(address)"              # == admin（只读别名，无单步 transferOwnership）
```

---

## 6. 两步移交第 2 步（必须由新 admin 自己签）

> 先分清两份管理权：
> - **工厂 admin**：构造函数里 = 部署者，所以脚本能替它做第 1 步（`pendingAdmin=ADMIN_TRANSFER_TO`）。
> - **盘口 admin**：建盘时写入的是 `MARKET_ADMIN`，**不是部署者**。若 `MARKET_ADMIN = ADMIN_TRANSFER_TO`
>   （推荐），盘口从第 0 块起就是 Safe 的，根本不需要移交；若两者不同，盘口侧的 `transferAdmin`
>   只能由 `MARKET_ADMIN` 自己发起 —— 部署者发会 revert `OnlyAdmin`（Phase 5 主网 fork 演练实测）。

部署私钥**做不到**这一步 —— 这是设计目标，不是权限没配好。

### 方式 A：cast（多签里有人握着 EOA 私钥时仅限测试网）

```bash
cast send $V "acceptAdmin()" --private-key $PROTOCOL_SAFE_PK --rpc-url $BASE_RPC_URL
cast send $F "acceptAdmin()" --private-key $PROTOCOL_SAFE_PK --rpc-url $BASE_RPC_URL

cast call $V "admin()(address)"         # PROTOCOL_SAFE
cast call $V "pendingAdmin()(address)"  # 0x0000000000000000000000000000000000000000
```

### 方式 B：Safe 多签（生产正确做法）

Safe UI → New transaction → **Transaction Builder** → 填 `To = vault 地址`、`Value = 0`、`Data = 0x0e18b681`（`acceptAdmin()` selector）
→ `Add new transaction`，对 factory 重复一次 → 收集门限签名 → Execute。

验证交接真的生效（这三条必须同时成立）：

```bash
# 旧部署者失去权限（应 revert 0x47556579 OnlyAdmin）
cast send $V "pause()" --private-key $DEPLOYER_PK --rpc-url $BASE_RPC_URL
# 新 admin 有权（应成功，随后记得 unpause）
cast send $V "pause()"   --private-key $PROTOCOL_SAFE_PK --rpc-url $BASE_RPC_URL
cast send $V "unpause()" --private-key $PROTOCOL_SAFE_PK --rpc-url $BASE_RPC_URL
```

> 交接前的空窗期无需担心：`transferAdmin` 之后旧 admin 仍然完整掌权，Safe 尚无任何权限；
> 如果 Safe 地址填错，旧 admin 直接 `transferAdmin(正确地址)` 覆盖即可，不会出现"切错即永久失控"。

---

## 7. 首盘做市（真金白银的 4 步）

```bash
V=$VAULT; U=0x036CbD53842c5426634e7929541eC2318f3dCF7e; CID=$CONDITION_ID; SEED=5000000000  # 5,000 USDC

cast send $U "approve(address,uint256)" $CT $SEED                      --private-key $LP_PK --rpc-url $RPC
cast send $CT "splitPosition(bytes32,uint256)" $CID $SEED              --private-key $LP_PK --rpc-url $RPC
cast send $CT "setApprovalForAll(address,bool)" $V true                --private-key $LP_PK --rpc-url $RPC
cast send $V "addLiquidity(uint256)" $SEED                             --private-key $LP_PK --rpc-url $RPC

cast call $V "depth()(uint256)"        # 期望 10,000e6
cast call $V "priceYes()(uint256)"     # 期望 0.5e18
cast call $V "totalLpShares()(uint256)"# == SEED
```

做市必须在 `resolutionTime` 之前完成（`addLiquidity` 在结算时间后直接 `TradingClosed`）。

> faucet 每 24h 只给 10 USDC（Base Sepolia），所以灰度首盘把 `SEED` 降到 `100e6 ~ 500e6`（100–500 USDC 双边）。
> 5 USDC 起投 + 5% 影响上限在 200 USDC 池深下就够跑通全链路（上限 10 USDC/笔），
> 想压更大单量再逐步加池，不必一开始就 5,000。

---

## 8. Keeper 启动（自动化运维）

### 8.1 配置

```bash
cd keeper && npm install && cp config.example.json config.json
```

`config.json`（Base Sepolia 版）：

```json
{
  "rpcUrl": "https://sepolia.base.org",
  "factory": "<Deploy 输出的 PredictionFactory>",
  "feeVault": "<Deploy 输出的 ProtocolFeeVault>",
  "privateKey": "",
  "intervalMs": 30000,
  "feeThreshold": "10000000",
  "autoRefund": false,
  "webhookUrl": "",
  "proposalDir": "./proposals",
  "maxFeePerGasGwei": 10
}
```

私钥不要写进文件，用环境变量注入（优先级高于配置文件）：

```bash
export KEEPER_RPC_URL=$BASE_RPC_URL
export KEEPER_FACTORY=$FACTORY
export KEEPER_FEE_VAULT=$FEE_VAULT
export KEEPER_PRIVATE_KEY=$KEEPER_PK       # 只用于 autoDistributeFee / emergencyRefund，两个都是 permissionless
export KEEPER_FEE_THRESHOLD=10000000       # 10 USDC
export KEEPER_AUTO_REFUND=0                # 灰度期先关：无资金风险，但会改变盘口终态
```

### 8.2 三段式启动（顺序不能跳）

```bash
# ① 只看不写：确认能读到 factory / 盘口 / pendingFees
node keeper.js --config config.json --dry-run

# ② 跑一轮真交易：确认手续费分发与提案 JSON 真的产出
node keeper.js --config config.json --once
ls -1 proposals/            # 期望出现 <vault>-RESOLUTION_OVERDUE.json（盘口过期时）

# ③ 常驻
node keeper.js --config config.json
```

### 8.3 systemd 常驻（服务器版）

```ini
# /etc/systemd/system/prediction-keeper.service
[Unit]
Description=Prediction Market Keeper (Base Sepolia)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/root/prediction-market/keeper
EnvironmentFile=/root/prediction-market/.env.sepolia
ExecStart=/usr/bin/node /root/prediction-market/keeper/keeper.js --config /root/prediction-market/keeper/config.json
Restart=always
RestartSec=10
StandardOutput=append:/var/log/prediction-keeper.log
StandardError=append:/var/log/prediction-keeper.log

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now prediction-keeper
journalctl -u prediction-keeper -f
```

cron 版（更抗崩溃，推荐灰度期先用这个）：

```cron
* * * * * cd /root/prediction-market/keeper && /usr/bin/node keeper.js --config config.json --once >> /var/log/keeper.log 2>&1
```

### 8.4 Keeper 的权限边界（不要越界）

| 动作 | 谁签 | 说明 |
|---|---|---|
| `ProtocolFeeVault.autoDistributeFee()` | keeper 自己 | permissionless，钱只能进 treasury |
| `PredictionVault.emergencyRefund()` | keeper（`KEEPER_AUTO_REFUND=1` 时） | permissionless，仅在 `resolutionTime + 7d` 之后可用 |
| `PredictionVault.resolve(uint8)` | **admin 多签** | keeper 只写 `proposals/*.json`，把 `to/value/operation/data` 交给 Safe Transaction Builder |

---

## 9. 上线演练（Sepolia 上必须逐条跑完）

```bash
# 1) 熔断：暂停后下单必失败
cast send $V "pause()" --private-key $PROTOCOL_SAFE_PK --rpc-url $RPC
cast call $V "tradingOpen()(bool)"                                  # false
# 2) 7 天例外窗口：结算时间 +7d 之后，暂停也必须放行 redeem
cast call $V "refundAvailableAt()(uint256)"
# 3) 恢复
cast send $V "unpause()" --private-key $PROTOCOL_SAFE_PK --rpc-url $RPC
# 4) 超时退款（把 RESOLUTION_TIME 设成 near-future 的盘口上演练）
cast send $V "emergencyRefund()" --rpc-url $RPC   # 任何人可调，无需私钥
cast call $V "outcome()(uint8)"                    # 2 = INVALID，YES/NO 各赔 0.5
# 5) 两步移交再演一遍（用第二个测试 Safe），确认 acceptAdmin 只能本人调
```

---

## 10. 本次改造在真实链状态上的实测记录

环境：`anvil --fork-url https://sepolia.base.org --chain-id 84532`，fork 高度 **49751419**，
抵押品是**真 Sepolia USDC**（`0x036CbD…CF7e`），部署脚本完整广播，非模拟调用。

| 步骤 | 结果 |
|---|---|
| 部署 4 合约 + 建首盘 | `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL`，gas 8,444,040 |
| ConditionalToken | `0x8f7a1defa8b06a8d66ea14a71a2ef2ce4ba1295b` |
| ProtocolFeeVault | `0xe3e1ea59710e5046c238c08ac7558ba2ccb7c445` |
| PredictionVault impl | `0x9d1bc2c13235fb96a2b01213fe9fe03184669d5d` |
| PredictionFactory | `0x30dec4d0b7c9899bed29adbe3a5d1a8d4ed7ab99` |
| 首个盘口（clone） | `0xfbec451aaa0e18242ec6e688a1c8e5a787d27ca3` |
| 第 1 步后 `factory.admin` / `pendingAdmin` | 部署者 / Safe（admin 未变，符合设计） |
| 第 1 步后 `vault.admin` / `pendingAdmin` | 部署者 / Safe |
| 第 1 步后 `vault.collateral` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e`（真 USDC） |
| 第三方冒充 `acceptAdmin()` | revert `0x058d9a1b NotPendingAdmin` |
| 过渡期旧 admin 改 `feeVault` | 成功（旧 admin 仍掌权，无空窗） |
| Safe 自己 `acceptAdmin()` ×2 | 成功，两处 `admin=Safe`、`pendingAdmin=0x0` |
| 旧 admin 再 `pause()` / `setImplementation()` | revert `0x47556579 OnlyAdmin` |
| 新 admin `pause()` | 成功，`paused()=true` |

> 说明清楚：这一轮广播跑在**本地 fork 的真链状态**上（交易进 fork，不进公网），
> 目的是验证"真 USDC + 真 chainId + 真工厂逻辑"下整套脚本能跑通。
> 公网 Base Sepolia 广播用第 4 节命令，由你手上的部署私钥执行。

---

## 11. 故障速查

| 现象 | 原因 | 处理 |
|---|---|---|
| `USDC address has no code` | RPC 打到了别的链 / USDC 填错 | `cast chain-id --rpc-url $RPC` 必须是 84532 |
| `createMarket ... NotMarket` | 漏了 `ct.setFactory(factory)` | 按第 4 节第 5 步补，注意必须在首次 `registerCondition` 之前 |
| `acceptAdmin` 一直 `NotPendingAdmin` | 签名钱包不是 `pendingAdmin`，或第 1 步没做 | `cast call $V "pendingAdmin()(address)"` 核对 |
| 部署后 `admin()` 还是 EOA | 第 2 步没做（脚本只做第 1 步） | 让 Safe 走第 6 节，这是预期行为 |
| 验证失败 `deprecated V1 endpoint` | Basescan V1 已下线 | 用 Etherscan V2 URL（第 4 节） |
| Keeper 报 `maxFeePerGas` 超标 | Base 拥堵或配置过低 | 提高 `maxFeePerGasGwei`，或等下一轮（keeper 会跳过而不是被打爆） |
| 盘口过期但无提案 JSON | `factory` 配置错 → 扫不到盘口 | 核对 `KEEPER_FACTORY`，`--dry-run` 先看它列出几个盘口 |

---

## 12. 上主网前的最后检查

1. `TREASURY` / `MARKET_ADMIN` / `ADMIN_TRANSFER_TO` 三个地址都指向 Safe，且门限 ≥ 2/3。
2. 两步移交第 2 步在 Sepolia 上真的跑通过（`pendingAdmin` 归零、旧 admin 全部动作 revert）。
3. Keeper 至少连续跑 24h，`proposals/` 有真实产物，webhook 收到过一次告警。
4. 超时退款演练过一次：`emergencyRefund()` 把盘口置为 INVALID，YES+NO 各赔 0.5，用户本金无损失。
5. 第三方审计完成（`HANDOFF.md` 第五节第 3 条）。
