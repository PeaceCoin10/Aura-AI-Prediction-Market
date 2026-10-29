# Base 主网部署实录（单钱包模式）

> 本文是**已经发生的事实**，不是计划。快照时间：2026-10-27 00:30 CST。
> 所有地址、tx、状态都用 `cast` 现查过。

## 1. 链上地址

| 角色 | 地址 |
|---|---|
| **CentralPredictionEngine** | `0xE6056Bc6700F6d7E6fF8779B212655284dc1631C` |
| ProtocolFeeVault | `0x29dE563f3059827D00837305FAE2Bbc87c7D9eE1` |
| Collateral（Base 原生 USDC） | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| ADMIN / TREASURY / CREATOR / ORACLE | `0x436b9d5e6fBd40eC93E881263bE53e59F8755Ba1`（同一个 EOA） |

| 动作 | Tx |
|---|---|
| 部署 FeeVault | `0x5bf19d7394d1784cfe93a27e58db9a6504af7efba9af525ed06e7f40fdef910b` |
| 部署 Engine | `0x7988a091b091a76dbb3b2cc777a9822241cd67742ae320032dde26d6da7932c9` |

部署链：Base 主网（chainid 8453）。部署 gas：**4,582,688**，实付约 **0.0000192 ETH**（≈ $0.06）。

## 2. 现查状态（逐条 `cast call` 实测）

| 项 | 值 |
|---|---|
| engine runtime code | 13,196 B |
| feeVault runtime code | 1,798 B |
| `admin()` | 0x436b…5Ba1 |
| `treasury()` | 0x436b…5Ba1 |
| `collateral()` | 0x8335…2913（USDC） |
| `feeVault()` | 0x29dE…9eE1 |
| `paused()` | false |
| `marketCount()` | 0 |
| `MIN_BET()` / `MAX_BET()` | 5,000,000 / 10,000,000,000（5 / 10,000 USDC） |
| `TRADE_FEE_BPS()` / `SETTLE_FEE_BPS()` | 150 / 50（1.5% / 0.5%） |
| `DISPUTE_WINDOW()` | 3600（1 小时） |
| 部署者余额（部署后） | 0.001439885780168635 ETH |

## 3. 验证（源码公开）

| 渠道 | 结果 |
|---|---|
| Sourcify | ✅ 两个合约 `exact_match`（引擎 `0xE605…631C`，金库 `0x29dE…9eE1`） |
| Basescan（绿勾） | ✅ **两个合约均已 Verified**（2026-10-28，Etherscan V2 API 提交，`checkverifystatus` = `Pass - Verified`；`getabi` 可读：金库 27 项 / 引擎 118 项） |
| Etherscan V2 / Basescan | ❌ 未完成：`api.etherscan.io` 从本机直连与走代理均 `HTTP 000`（连接超时）；`api.basescan.org` 只回 `deprecated V1 endpoint`；本机也没有 `ETHERSCAN_API_KEY` |

> **2026-10-27 更新**：`api.etherscan.io` 现在经代理可达（HTTP 200），但**没有有效 API key**
> （旧 key 已作废：`Invalid API Key (#err2)`）；网页表单能自动填到第三步，卡在 Cloudflare Turnstile。
> 完整证据、两条补齐路径、现成的 standard-json 与构造函数参数见 **`docs/VERIFICATION.md`**。


在有外网的机器上补验证（复制即用）：

```bash
cd /root/prediction-market
export ETHERSCAN_API_KEY=<你的 V2 多链 key>
forge verify-contract 0xE6056Bc6700F6d7E6fF8779B212655284dc1631C \
  src/CentralPredictionEngine.sol:CentralPredictionEngine \
  --chain 8453 --verifier etherscan \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=8453" \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode "c(address,address,address,address)" \
     0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
     0x29dE563f3059827D00837305FAE2Bbc87c7D9eE1 \
     0x436b9d5e6fBd40eC93E881263bE53e59F8755Ba1 \
     0x436b9d5e6fBd40eC93E881263bE53e59F8755Ba1)
```

## 4. 部署命令（实际用的这一条）

```bash
REQUIRE_SAFE_CONTRACT=0 \
ADMIN=0x436b9d5e6fBd40eC93E881263bE53e59F8755Ba1 \
TREASURY=0x436b9d5e6fBd40eC93E881263bE53e59F8755Ba1 \
CREATOR=0x436b9d5e6fBd40eC93E881263bE53e59F8755Ba1 \
ORACLE=0x436b9d5e6fBd40eC93E881263bE53e59F8755Ba1 \
SEED_DEMO=0 \
forge script script/DeployCentral.s.sol:DeployCentral \
  --rpc-url https://mainnet.base.org --broadcast \
  --verify --verifier sourcify -vv
```

`REQUIRE_SAFE_CONTRACT=0` 关掉了三条校验：ADMIN/TREASURY 必须是合约、部署者不能是 admin、
CREATOR ≠ ORACLE。**其余校验照旧生效**（USDC 必须 6 位小数、地址非零、有代码）。

## 5. 单钱包模式意味着什么（不粉饰）

- 一把私钥同时握有：建盘权、裁决权、**争议期改判权**、手续费收款、暂停权。
- 私钥泄露 = 攻击者可直接改判盘口、提走 FeeVault 里所有手续费、暂停整个协议。
- 合约**没有** admin 转移函数（treasury/admin 都不可变），要换 Safe 只能重新部署并迁移用户。
- 因此：**尽快把 USDC 流动性和用户体量控制在小规模**，等有量之前切换到 Safe 部署版
  （`REQUIRE_SAFE_CONTRACT=1`，ADMIN/TREASURY 传 Safe 地址，再由 Safe 执行 `setCreator/setOracle`）。

## 6. 现在缺什么（上线的真实卡点）

1. **钱包里 0 USDC** → Hermes 能建盘，但 `seedLiquidity` 会失败，盘口没有对手盘。需要先往
   `0x436b…5Ba1` 打 USDC（每盘建议 ≥ 100 USDC 种子）。
2. **ETH 只剩 0.00144**（≈ $4.5）→ 建盘 + 做市 + 裁决，每笔约 $0.001–0.01，够跑几百轮，但要盯着。
3. **第三方审计未做**、**价格源仍是中心化现货 API**、**裁决仍是单点**。

## 7. Hermes 大脑启动

```bash
# 干跑（不发交易）
bash script/run-brain-mainnet.sh --dry-run --once

# 常驻（300 秒一轮）
bash script/run-brain-mainnet.sh

# systemd 常驻
sudo cp deploy/hermes-brain.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now hermes-brain
journalctl -u hermes-brain -f
```

实测输出（2026-10-27 00:42，dry-run）：

```
INFO hermes | brain start: engine=0xE6056Bc...631C rpc=https://mainnet.base.org dry_run=True
INFO hermes | creating market: BTC（比特币）能否在 24 小时内突破 $81,000？现价 $79,833.25
INFO hermes | [dry-run] would send createMarketWithMeta(...)
INFO hermes | [dry-run] would send seedLiquidity(0x18fb..., 100000000)
```
