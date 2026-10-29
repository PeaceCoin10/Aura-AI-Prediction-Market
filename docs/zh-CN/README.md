# Aura — Agentic DeFi Prediction Markets

> 一个会自己出题、自己定价、自己结算的预测市场：Hermes AI 大脑 × 链上 CPMM × 零门槛模拟盘。
> 部署在 **Base 主网**，合约已在 Basescan 亮绿勾，前端点开即玩（不用钱包也能下注）。

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Aura · Agentic DeFi Prediction Market                                       │
│                                                                              │
│   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐               │
│   │   Creator    │      │    Oracle    │      │  Marketing   │               │
│   │  多板块出题   │      │  采样/赛果裁决 │      │  自动文案     │               │
│   └──────┬───────┘      └──────┬───────┘      └──────┬───────┘               │
│          └──────────── Hermes AI Brain ─────────────┘                       │
│                          (Python, 5 分钟一轮)                                 │
│                                    │ cast / RPC                              │
│                                    ▼                                         │
│   ┌───────────────────────────────────────────────────────────────┐          │
│   │  CentralPredictionEngine (Solidity 0.8.24, CPMM, 1.5% fee)    │          │
│   │  createMarket · buyShares · sellShares · resolve · redeem     │          │
│   └───────────────┬───────────────────────────────┬───────────────┘          │
│                   │ 0.5% settle fee               │ 1.5% trade fee           │
│                   ▼                               ▼                          │
│          ┌──────────────────┐          ┌────────────────────┐               │
│          │ ProtocolFeeVault │◀─────────│   USDC (Base)      │               │
│          └──────────────────┘          └────────────────────┘               │
│                   ▲                                                          │
│   ┌───────────────┴───────────────┐        ┌──────────────────────────┐      │
│   │  CentralPredictionSDK (TS)    │◀──────▶│  Frontend (Vite+React)   │      │
│   │  Multicall3 · 离线报价 · 事件   │        │  Real / Paper · AI 评述   │      │
│   └───────────────────────────────┘        └──────────────────────────┘      │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 目录

- [1. 它解决了什么](#1-它解决了什么)
- [2. 主网合约（已验证）](#2-主网合约已验证)
- [3. 经济模型：每一分钱怎么走](#3-经济模型每一分钱怎么走)
- [4. 安全矩阵](#4-安全矩阵)
- [5. 仓库结构](#5-仓库结构)
- [6. 10 分钟本地跑起来](#6-10-分钟本地跑起来)
- [7. SDK 集成](#7-sdk-集成)
- [8. Hermes AI 大脑](#8-hermes-ai-大脑)
- [9. 前端：实盘 / 模拟盘 / 分享裂变](#9-前端实盘--模拟盘--分享裂变)
- [10. 品牌与视觉系统](#10-品牌与视觉系统)
- [11. 公网部署](#11-公网部署)
- [12. 测试矩阵](#12-测试矩阵)
- [13. 路线图与免责声明](#13-路线图与免责声明)

---

## 1. 它解决了什么

预测市场的老问题是**冷启动**：没有盘口没人来，没人来没人做市，没人做市更没盘口。
Aura 把这三件事拆开，各给一个机械解：

| 痛点 | 解法 | 代码位置 |
| --- | --- | --- |
| 谁来出题 | Hermes 大脑每 5 分钟抓真实数据（币价 / RSS / ESPN / LoL Esports），按板块轮转出题 | `hermes/hermes_brain.py`, `hermes/verticals.py` |
| 谁来定价 | 链上 CPMM，`price = noReserve / (yesReserve + noReserve)`，无需订单簿、无需做市商 | `src/CentralPredictionEngine.sol` |
| 谁来结算 | 价格类 3×30s 采样防插针；体育/电竞只认官方赛果；新闻类**不自动裁决**，交 Safe | `OracleEngine` |
| 没有 USDC 怎么体验 | 一键切「模拟 Paper」，领 10,000 FAKE-USDC，同一套 CPMM 公式本地实时结算 | `frontend/src/lib/paper.ts` |
| 结算会不会被操纵 | 结算后 1 小时争议期，期间不可提现，Safe 可改判 | `DISPUTE_WINDOW = 1 hours` |
| 管理员跑路怎么办 | 超时 7 天任何人可 `emergencyRefund` 全额退款 | `REFUND_DELAY = 7 days` |

一句话：**AI 负责内容供给，AMM 负责流动性，争议期负责纠错，模拟盘负责拉新。**

---

## 2. 主网合约（已验证）

Base 主网 · chainId **8453** · USDC 结算（6 位小数）

| 合约 | 地址 | Basescan | 验证方式 |
| --- | --- | --- | --- |
| CentralPredictionEngine | `0xE6056Bc6700F6d7E6fF8779B212655284dc1631C` | ✅ Verified | Etherscan V2 API（Exact Match, solc 0.8.24, MIT） |
| ProtocolFeeVault | `0x29dE563f3059827D00837305FAE2Bbc87c7D9eE1` | ✅ Verified | 同上 |
| USDC (Base) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | — | 官方代币 |

- Engine 构造函数：`(usdc, feeVault, admin, creator)` → `0x8335…2913, 0x29dE…9eE1, 0x436b…5Ba1, 0x436b…5Ba1`
- Vault 构造函数：`(usdc, admin, treasury)` → `0x8335…2913, 0x436b…5Ba1, 0x436b…5Ba1`
- 复核命令（任何人都能跑）：

```bash
KEY=$(cat ~/.etherscan_key)
curl -s "https://api.etherscan.io/v2/api?chainid=8453&module=contract&action=getsourcecode\
&address=0xE6056Bc6700F6d7E6fF8779B212655284dc1631C&apikey=$KEY" | jq -r '.result[0].ContractName'
# → CentralPredictionEngine
```

字节码与源码一致性也已在 Sourcify 做 `exact_match` 校验（1798B / 13196B，差异仅在 immutable 槽）。

---

## 3. 经济模型：每一分钱怎么走

### 3.1 价格 = 储备比

盘口两侧各有一个 USDC 储备 `Y`（YES）和 `N`（NO），**YES 的价格就是 NO 储备占总储备的比例**：

```
p_yes = N / (Y + N)          p_no = Y / (Y + N)          p_yes + p_no = 1
```

直觉：买 YES 的人越多，`Y` 越大，`p_yes` 越高——和「押注赔率」同构，但不需要对手盘撮合。

### 3.2 一笔买入，你能拿到多少份

扣掉 1.5% 手续费后，净额 `net` 进入池子；CPMM 保持 `Y·N` 近似不变：

```
fee    = ceil(amountIn × 150 / 10000)              // 1.5%，向上取整（不吃协议的亏）
net    = amountIn − fee
Y'     = ceil(Y × N / (N + net))                    // 买 YES 后 YES 储备被消耗
shares = net + (Y − Y')                             // 份额以 USDC 6 位小数计
```

卖出是它的逆运算，并按前后价的中点结算，再扣 1.5%。

**算一笔**（示例盘口 T1：Y=9,102、N=15,438，池深 24,600 USDC）：买 YES 100 USDC
→ 手续费 1.5 → 净额 98.5 → 得到 **155.98 份**，成交均价 **$0.6411**，边际价 **$0.6300**。
均价高于边际价的部分就是**滑点**，明明白白写在交易面板上。

### 3.3 费率与资金流

| 环节 | 费率 | 去向 |
| --- | --- | --- |
| 买入 / 卖出 | **1.5%**（`TRADE_FEE_BPS = 150`） | `ProtocolFeeVault`（Safe 多签才能提） |
| 结算赔付 | **0.5%**（`SETTLE_FEE_BPS = 50`） | 同上 |
| 建盘做市 | 无手续费，`seedLiquidity` 直接进池 | 池子 |
| 强制退款 | 0 | 用户全额拿回（7 天超时后） |

### 3.4 硬约束（写死在合约里，不是参数）

| 常量 | 值 | 意义 |
| --- | --- | --- |
| `MAX_IMPACT_BPS_CAP` | 500 | 单笔金额 ≤ 池深 5%，防止一笔把价格打穿 |
| `MIN_BET` / `MAX_BET` | 5 / 10,000 USDC | 防粉尘、防巨鲸单点操纵 |
| `MIN_SEED` | 10 USDC | 建盘最低做市金 |
| `MIN/MAX_TRADING_WINDOW` | 1 小时 / 365 天 | 杜绝「1 分钟后结算」的必赢盘 |
| `DISPUTE_WINDOW` | 1 小时 | 裁决 → 争议 → 终局 |
| `REFUND_DELAY` | 7 天 | 管理员失联兜底 |

### 3.5 结算时间线

```
结算时间到 ──► resolveMarket(outcome) ──► 争议期 1h ──► finalizeMarket ──► redeem()
                    │                        │
                    │                        └─ Safe 可 overrideResolution 改判
                    └─ 超过 7 天没人裁决 ──► emergencyRefund() 全额退款
```

> 争议期内 UI 明确提示「当前处于 1 小时争议期，Safe 可能会改判，暂不可提现」，并且按钮真的禁用——不是文案。

---

## 4. 安全矩阵

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| Slither 静态分析 | **0 High / 0 Medium**，12 Low（`block.timestamp` 语义）+ 7 Informational | `docs/security/slither-report.json` |
| 不变式测试 | **102,400 次 handler 调用**（512 runs × depth 200，8 个选择器各约 1.28 万次），**0 revert / 0 次不变式破坏** | `forge test --match-path "test/*Invariant*"` |
| 单元测试 | 46 个 forge 测试全绿 | `forge test` |
| SDK | 70/70 离线用例 | `cd sdk && npm test` |
| 大脑 | 49 个离线用例（RSS/ESPN/LoL 解析、二元校验、无 USDC 只出题不发单） | `python3 -m unittest discover hermes` |
| 前端 | 11/11 真链 E2E（anvil 上真买卖）+ 44/44 UI E2E | `frontend/scripts/e2e_local.py`、`e2e_ui.py` |

不变式覆盖的核心性质：

1. 池子现金 ≥ 应付（`cash >= owed`，任何时刻都能兑付）
2. 份额总量与储备一致（买卖不凭空造份额）
3. 争议期内绝不允许提现
4. 非 admin 绝不能改判
5. 暂停时只有「结算 + 7 天」的强制退款可走

12 条 Low 全部是 `block.timestamp` 相关（交易截止、争议期计时）。这是预测市场的业务语义，不是随机数依赖；`docs/security/` 里保留了原始 JSON，欢迎逐条挑战。

---

## 5. 仓库结构

```
prediction-market/
├── src/                      # Solidity 合约
│   ├── CentralPredictionEngine.sol   # 盘口 / CPMM / 裁决 / 提现
│   ├── ProtocolFeeVault.sol          # 手续费金库（Safe 提款）
│   └── libraries/FixedPoint.sol      # mulDiv 定点数学
├── test/                     # 46 个 forge 测试（含不变式 handler）
├── sdk/                      # TypeScript SDK（零依赖，Multicall3 + 离线报价）
├── hermes/                   # AI 大脑
│   ├── hermes_brain.py       # Creator / Oracle / Marketing 三引擎
│   ├── verticals.py          # 4 板块真实数据源 + 二元题强校验
│   └── insights.py           # 「AI 智囊团」盘口评述生成器
├── frontend/                 # Vite + React + Tailwind + viem
│   ├── src/lib/paper.ts      # 模拟盘引擎（复用 SDK 同构公式）
│   ├── src/lib/share.ts      # Canvas 海报 + 二维码
│   └── scripts/e2e_ui.py     # 44 项 UI 验收
├── deploy/                   # tunnel.sh / verify-basescan.sh
└── docs/                     # 部署、验证、安全、大脑板块说明
```

---

## 6. 10 分钟本地跑起来

### 6.1 合约

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
forge install foundry-rs/forge-std --no-commit
forge build
forge test                    # 46 passed

# 本地链 + 部署 + 两个种子盘口
anvil --chain-id 31337 &
forge script script/DeployCentral.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

### 6.2 大脑

```bash
export RPC_URL=http://127.0.0.1:8545
export ENGINE=0x…                       # 上一步输出的地址
export BRAIN_PK=0xac0974…               # anvil 第一个私钥（仅本地）
export VERTICALS=crypto,news,sports,esports
export CREATE_PER_CYCLE=3
python3 hermes/hermes_brain.py --once --dry-run    # 先看它想出什么题，不发交易
python3 hermes/hermes_brain.py --interval 300      # 常驻
```

> 大脑钱包没有 USDC 时不会硬失败：它会打 `[plan-only]` 把四个板块的候选题目写进日志，等充值后再真正建盘。

### 6.3 前端

```bash
cd frontend
npm install
cp .env.example .env        # 填 VITE_ENGINE_ADDRESS / VITE_USDC_ADDRESS / VITE_RPC_URL
npm run dev                 # http://localhost:5173
npm run typecheck           # tsc --noEmit
npm run build               # vite build → dist/
```

---

## 7. SDK 集成

`@prediction/sdk` 是零依赖 TypeScript 包：只读走你注入的 `ethCall`，发交易返回一个 `TxPlan` 交给钱包。

```ts
import { CentralPredictionSDK } from "@prediction/sdk";

const transport = {
  ethCall: (to: string, data: string) =>
    provider.request({ method: "eth_call", params: [{ to, data }, "latest"] }),
};

const sdk = new CentralPredictionSDK(transport, {
  engine: "0xE6056Bc6700F6d7E6fF8779B212655284dc1631C",
  chainId: 8453,
  account,                 // 可选
});
```

**一次 RPC 拉全部盘口**（内部走 Multicall3，单条失败自动降级逐条补）：

```ts
const n = await sdk.marketCount();
const ids = await Promise.all([...Array(n)].map((_, i) => sdk.marketId(i)));
const snaps = await sdk.marketSnapshots(ids, { withMeta: true });
// snaps[i]: yesReserve / noReserve / priceYes / totalVolume / resolutionTime / question / category
```

**下单**（`outcome: 1 = YES, 0 = NO`，与合约枚举一致；`slippageBps` 必填，否则 SDK 直接拒绝）：

```ts
const plan = await sdk.buildBuyShares({
  marketId: ids[0],
  outcome: 1,
  amountIn: 20_000_000n,   // 20 USDC
  slippageBps: 100n,       // 1%
});
const hash = await wallet.sendTransaction(plan);
```

**离线报价**（不联网，与链上 `previewBuy` 逐 wei 同构）：

```ts
import { previewBuyOffline, previewSellOffline, priceYesOffline } from "@prediction/sdk";
const shares = previewBuyOffline({ yesReserve, noReserve }, 1, 20_000_000n);
```

**事件解码**：`sdk.decodeLogs(rawLogs)` 把 `SharesBought` / `MarketCreated` / `MarketResolved` 变成结构化通知，前端直接渲染成 Toast。

完整 API 见 [`sdk/README.md`](sdk/README.md)。

---

## 8. Hermes AI 大脑

### 8.1 三个引擎

| 引擎 | 输入 | 输出 |
| --- | --- | --- |
| **Creator** | CoinGecko / Binance（加密）、The Block / Decrypt / BBC（新闻）、ESPN（体育）、LoL Esports（电竞） | 二元题 + 结算时间 + 判定标准 → `createMarket` + `seedLiquidity` |
| **Oracle** | 价格多态采样 / 官方赛果 | `resolveMarket`；新闻类**不动手**，交人工/Safe |
| **Marketing** | 新盘口元数据 | Twitter / Telegram 文案（模板引擎，可选接 LLM） |

### 8.2 出题硬校验（不满足直接丢弃，绝不硬凑）

- 必须是**二元问句**（能否 / 是否 / 会不会），不允许开放式
- 结算时间必须在 **30 分钟 ~ 8 天**之间，且写进题面
- 必须带**客观判定标准**（≥12 字），例如「以 LoL Esports 官方 gameWins 为准」
- 新闻类只出题不自动裁决（`verification=manual`），避免「AI 自己出题自己判卷」

### 8.3 轮转调度

不是贪心：每个板块先保底 1 条，再填预算。否则 crypto 会吃光额度，体育/电竞永远排不上。
`cursor = last_cycle // 600` 保证每 10 分钟推进一格。

### 8.4 AI 智囊团评述

`hermes/insights.py` 每轮把「链上真实池子 + 新闻情绪」写成 `frontend/public/insights.json`：

```json
{
  "generatedAt": 1793120911763,
  "source": "hermes-brain",
  "newsMood": 1,
  "items": {
    "0x…": { "text": "YES 已经 78.3%，多头把结论写死在价格里了……", "tone": "warn",
             "basis": "YES 78.3% · 池深 24600 · 成交 97400 · 情绪 +1" }
  }
}
```

前端 60 秒轮询；大脑离线时用规则引擎兜底，并在 UI 上明确标注「本地推演」——**不冒充 AI 产出**。

---

## 9. 前端：实盘 / 模拟盘 / 分享裂变

### 9.1 双模式

右上角一键切换：

- **模拟 Paper（首访默认，强制锁定）**：进站即自动空投 **10,000 FAKE-USDC**（欢迎礼包动效弹窗），
  12 个精选盘口铺满首屏，概率条每 7 秒实时跳动，全部盘口（链上 + 示例）都能下单，本地实时结算
- **实盘 Real**：连接钱包 → 自动切 Base 8453 → 真实 approve + buy，交易哈希可查

> 冷启动策略：只要本地没有「用户主动切过实盘」的记录，一律落在 Paper —— 绝不会让人第一眼看到
> 「0 USDC / 0 盘口」的空窗大厅。用户自己点了实盘才会持久化 `real`。

模拟盘不是「假 UI」：份额、均价、滑点、价格冲击、持仓市值、浮动盈亏全部用
`previewBuyOffline / previewSellOffline` 计算——和链上引擎逐 wei 同构，只是不广播交易。

### 9.2 分享裂变

每个盘口卡片、详情页、持仓行都有分享入口：

- Canvas 现画 **1200×630** 海报：Mesh 渐变底 + 品牌 LOGO + 题面 + 你的方向 + 概率 + 潜在回报 + 邀请二维码
- 二维码指向 `?ref=share&m=<marketId>`，可做归因
- 一键下载 PNG / 直接唤起 X(Twitter) intent / 复制文案

### 9.3 其他

- 辩论墙（localStorage，刷新不丢；换设备不同步，UI 有说明）
- 六板块导航（热门/加密/新闻/体育/游戏/科技）+ 实时计数
- 页脚 RPC 延迟探针 + Hermes 大脑心跳灯
- 首次进入风险提示弹窗（合规），安全中心与文档中心抽屉

---

## 10. 品牌与视觉系统

**LOGO 语义**：六边护盾 = 链上矩阵；眼形轮廓 = 预言之眼；虹膜四节点电路 = 智能代理。
一份矢量三处复用：导航栏（`LogoMark`）、favicon（内联 SVG data URI）、分享海报（Canvas 绘制）。

| 角色 | 值 |
| --- | --- |
| 主色 Emerald | `#34d399` |
| 次色 Cyan | `#22d3ee` |
| 强调 Violet | `#a78bfa` |
| 危险 Rose | `#fb7185` |
| 底色 Ink | `#05060a` |

视觉规则：多层 Mesh 渐变背景 + 网格遮罩 + 扫描线；卡片一律毛玻璃（`backdrop-blur` + 内高光）；
悬停时 conic-gradient 流光描边 + 外发光位移；概率条 900ms 弹性缓动（`cubic-bezier(.34,1.56,.64,1)`）。
**没有纯灰白底、没有干瘪 1px 边框**——这是 CI 检查项，不是审美偏好。

音效：WebAudio 现场合成（点击 / 下单成功 / 领取 / 报错），零素材零请求，一键静音并持久化。

---

## 11. 公网部署

**永久域名（推荐，一条命令，HTTPS，不会掉线）**

```bash
VERCEL_TOKEN=xxx  ./deploy/vercel.sh            # → https://<project>.vercel.app
NETLIFY_TOKEN=xxx ./deploy/netlify.sh --build   # → https://<site>.netlify.app（纯 API，不装 CLI）
```

细节、自定义域名、故障排查见 [`docs/DEPLOY-PERMANENT.md`](docs/DEPLOY-PERMANENT.md)。

**临时演示隧道（地址一次一变，仅演示用）**

```bash
./deploy/tunnel.sh start   # cloudflared 快速隧道，地址写 PUBLIC-URL.txt
```

**推 GitHub（PAT，无需浏览器登录态）**

```bash
GITHUB_TOKEN=ghp_xxx ./scripts/github_push.sh   # 自动建库 + 提交 + push main + 回读校验
```

见 [`docs/GITHUB-PUSH.md`](docs/GITHUB-PUSH.md)。项目全景资产清单（数字全部实测）见
[`docs/ASSETS.md`](docs/ASSETS.md)。

---

## 12. 测试矩阵

| 层 | 命令 | 数量 |
| --- | --- | --- |
| 合约单元 + 不变式 | `forge test` | 46 passed |
| 不变式压力 | `FOUNDRY_INVARIANT_RUNS=512 FOUNDRY_INVARIANT_DEPTH=200 forge test --match-path "test/*Invariant*"` | 102,400 calls, 0 breaks |
| SDK | `cd sdk && npm test` | 70/70 |
| AI 大脑 | `python3 -m unittest discover hermes` | 49 passed |
| 前端类型 | `cd frontend && npx tsc --noEmit` | 0 error |
| 前端真链 E2E | `python3 frontend/scripts/e2e_local.py` | 11/11 |
| 前端 UI E2E | `python3 frontend/scripts/e2e_ui.py <url>` | 55/55 |
| 部署脚本自测（离线 mock） | `python3 deploy/test_github_push_mock.py` / `deploy/test_netlify_mock.py` | 2/2 |

---

## 13. 路线图与免责声明

**下一步**

- [ ] 大脑钱包充值 ≥100 USDC → 主网自动建盘（当前只 `[plan-only]`，不烧 gas）
- [ ] 评论上链或接后端，跨设备同步
- [ ] Safe 多签接管 admin（当前 EOA 单签）
- [ ] 独立审计（Slither 只是静态分析，不等于审计）

**免责声明**：本项目是开源协议与实验性产品，不构成投资建议。预测份额价格可能归零；
1 小时争议期内 Safe 可改判；任何人都可以阅读、分叉、审计代码，但**没有任何审计能保证零风险**。

MIT License.
