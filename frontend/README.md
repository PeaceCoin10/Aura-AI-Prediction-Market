# AI 预测市场前端（Base 主网 · CentralPredictionEngine）

Vite + React 18 + TypeScript + TailwindCSS + viem。**不复制 SDK**：直接通过 `@sdk` 别名引用
工作区的 `sdk/CentralPredictionSDK.ts`（单一事实来源），所有读链、报价、calldata 编码、日志解码都由 SDK 完成。

已部署合约（Base 主网 8453）：

| 角色 | 地址 |
|---|---|
| CentralPredictionEngine | `0xE6056Bc6700F6d7E6fF8779B212655284dc1631C` |
| ProtocolFeeVault | `0x29dE563f3059827D00837305FAE2Bbc87c7D9eE1` |
| USDC（Base 原生） | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

---

## 1. 三分钟启动

```bash
cd /root/prediction-market/frontend
npm install            # 依赖已在仓库里（node_modules 已就位可跳过）
cp .env.example .env   # 默认值就是主网，可直接不改
npm run dev            # http://localhost:5173
```

生产构建 / 本地预览：

```bash
npm run build && npm run preview   # 产物在 frontend/dist
npm run typecheck                  # tsc --noEmit，0 错误
```

### 环境变量（`.env`）

| 变量 | 默认 | 说明 |
|---|---|---|
| `VITE_ENGINE_ADDRESS` | `0xE605…631C` | 引擎地址；本地联调时换成 anvil 上的地址 |
| `VITE_USDC_ADDRESS` | `0x8335…2913` | 抵押品；本地 MockUSDC 要换 |
| `VITE_RPC_URL` | `https://base-rpc.publicnode.com,https://1rpc.io/base,https://mainnet.base.org` | 逗号分隔，按顺序 fallback |

> 只读走公共 RPC（viem `fallback`，任一可用即可）；写交易走用户钱包的 `eth_sendTransaction`，前端不接触私钥。

---

## 2. 功能闭环（对照需求逐条落地）

| 模块 | 实现位置 | 行为 |
|---|---|---|
| **钱包连接 / 网络切换** | `src/lib/wallet.tsx` | EIP-6963 自动发现所有注入式钱包（MetaMask / Coinbase / Rabby / 任意 EOA），连上后 `wallet_switchEthereumChain` 到 Base(8453)，节点不认识链时自动 `wallet_addEthereumChain`；监听 `accountsChanged` / `chainChanged` |
| **盘口大厅** | `src/hooks/useMarkets.ts` + `MarketCard.tsx` | `marketCount()` → `marketId(i)`（倒序）→ **`marketSnapshots(ids, {withMeta:true})` 一次 Multicall3**；卡片显示题目/分类/YES·NO 概率/池深/成交额/倒计时，15 秒自动刷新 |
| **下单交易** | `src/components/TradePanel.tsx` | 绑定 `buildBuyShares` / `buildSellShares`；输入金额即时走 SDK 离线公式（`previewBuyOffline`），420ms 后再用 `previewBuy/previewSell` 链上校正并标注「链上报价」；滑点三档 0.5% / **1%（默认）** / 3%；冲击条实时显示；**≥ 上限的 80%（4%）时按 SDK 的 `warning: "impact_near_limit"` 弹二次确认**；买入前自动检查并补 USDC 授权 |
| **资产 / 提现** | `src/hooks/usePortfolio.ts` + `PortfolioView.tsx` | 逐盘读 `sharesOf`（限制 5 并发）+ USDC 余额；已结算且争议期结束 → `buildRedeem` 一键提现；**结算后 1 小时争议期内按钮置灰 + 高亮提示「当前处于 1 小时争议期，Safe 可能会改判，暂不可提现」，并显示剩余倒计时** |
| **事件日志实时渲染** | `src/hooks/useEventFeed.ts` + `ActivityView.tsx` | 每 8 秒增量 `eth_getLogs`（引擎地址）→ **SDK `decodeLogs`** 解 19 个事件 → Toast 通知流 + 可展开的事件列表（点开看 `decodeLog(args)` 原始字段）；交易回执用 `sdk.decodeReceiptLogs` 再解一次，保证 Toast 与链上一致 |

额外：`src/components/CreateMarket.tsx` —— 建盘面板（`buildCreateMarket` + `seedLiquidity`），
主网 `CREATOR` 就是部署 EOA，所以在没有任何盘口时可以自己先开一个。

---

## 2.5 多板块大厅 · 示例盘口 · 辩论墙（2026-10-27 新增）

| 能力 | 实现位置 | 行为 |
|---|---|---|
| **多板块导航** | `src/lib/nav.ts` + `src/components/CategoryNav.tsx` | 热门 / 加密 / 新闻 / 体育 / 游戏 / 科技，带实时计数与高亮；`groupOf()` 把链上 `category`（crypto / news / politics / macro / sports / esports / tech）归到六个板块，注意 esports 必须先于 sports 判定（`esports` 里含 `sport`） |
| **示例盘口兜底** | `src/lib/demo.ts` + `DemoMarketCard.tsx` | 12 个精选示例（加密 3 / 新闻 2 / 科技 1 / 体育 3 / 电竞 3），链上没有盘口时大厅绝不留白；**报价复用 SDK 真实 CPMM 公式**（`priceYesOffline` / `previewBuyOffline` / `previewSellOffline`），与链上引擎同构，卡片右上角标「示例」 |
| **模拟下单** | `DemoMarketCard.tsx → DemoDetail` | 三档滑点（0.5% / 1% / 3%）、预计份额、成交均价、最小到手、价格冲击；**冲击 ≥ 4%（上限 5% 的 80%）弹出 `warning: impact_near_limit` 提示**；模拟仓位与回款实时刷新，不发交易不花钱 |
| **辩论墙** | `src/lib/comments.ts` + `CommentsWall.tsx` + `hooks/useComments.ts` | 每盘独立讨论区，YES / NO / 中立 三种立场 + 昵称 + 500 字正文，立场比例条；localStorage 持久化（刷新不丢、换设备不同步，UI 上明确标注）；内置示例盘口预置「官方话题」冷启动内容 |
| **视觉动效** | `src/index.css` | 暗黑赛博底（三层径向辉光 + 网格 + 遮罩）、`hero-panel` 渐变描边、`demo-glow` 霓虹扫光描边、`animate-fade-in` / `animate-pulse-slow`、概率条渐变过渡、卡片悬停上浮 + `shadow-glow` |

---

## 3. 本地全链路联调（跑通过的真实命令）

本地起一条假 Base（chainid 31337），部署引擎 → 建两个盘口 → 做市 → 前端指向它。
用假钱包自动签名，`scripts/e2e_local.py` 会真的发交易、真的读回持仓。

```bash
# 0) anvil
export PATH=/opt/foundry:$PATH
env -u http_proxy -u https_proxy -u all_proxy anvil --chain-id 31337 --port 8545 &

# 1) 部署（本地自动发 MockUSDC；SEED_DEMO 需要先有 USDC，所以关掉）
cd /root/prediction-market
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
REQUIRE_SAFE_CONTRACT=0 SEED_DEMO=0 \
forge script script/DeployCentral.s.sol:DeployCentral --rpc-url http://127.0.0.1:8545 --broadcast
# 地址从 broadcast/DeployCentral.s.sol/31337/run-latest.json 里取，示例：
#   MockUSDC     0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9
#   FeeVault     0x5FC8d32690cc91D4c39d9d3abcBD16989F875707
#   Engine       0x0165878A594ca255338adfa4d48449f69242Eb8F

# 2) 发币 + 授权 + 建盘 + 做市（A0 建盘，A1 交易）
K0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
A0=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
A1=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
USDC=0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9
ENG=0x0165878A594ca255338adfa4d48449f69242Eb8F
RPC=http://127.0.0.1:8545

cast send $USDC "mint(address,uint256)" $A0 5000000000 --private-key $K0 --rpc-url $RPC
cast send $USDC "mint(address,uint256)" $A1 5000000000 --private-key $K0 --rpc-url $RPC
cast send $USDC "approve(address,uint256)" $ENG 3000000000 --private-key $K0 --rpc-url $RPC

MID=$(cast keccak "BTC-up-24h-demo")
RT=$(( $(date +%s) + 172800 ))
cast send $ENG "createMarketWithMeta(bytes32,string,string,uint256)" $MID \
  "BTC 能否在 24 小时内突破 \$81,000？" "crypto" $RT --private-key $K0 --rpc-url $RPC
cast send $ENG "seedLiquidity(bytes32,uint256)" $MID 1000000000 --private-key $K0 --rpc-url $RPC

# 3) 前端指向本地链
cd frontend
VITE_ENGINE_ADDRESS=$ENG VITE_USDC_ADDRESS=$USDC VITE_RPC_URL=$RPC npm run dev

# 4) 自动化端到端（注入 EIP-1193 假钱包 → 连接 → 买入 → 持仓 → 事件流）
python3 scripts/e2e_local.py
```

最近一次实跑结果（本机）：

```
PASS 首次加载读到 2 个盘口
PASS 盘口标题渲染
PASS YES 概率 50%
PASS 钱包连接成功（显示地址/余额）
PASS 详情面板打开
PASS 链上报价出现
PASS 冲击百分比显示
PASS 交易确认 Toast
PASS 持仓页出现份额（YES 114.90）
PASS 可提现/交易中分组
PASS 事件流出现买入事件
RESULT: ALL PASS
```

链上核对：`cast call $ENG "yesOf(bytes32,address)(uint256)" $MID $A1` 返回 `77306483`（第一次 20 USDC 买到 77.30 份），
与 UI 显示一致 —— 说明报价、授权、下单、持仓读取整条链路都对。

---

## 4. 主网只读冒烟（不需要钱包）

```bash
npm run dev
python3 scripts/smoke.py          # 打印首屏文本 + 控制台错误
```

主网当前 `marketCount = 0`（引擎已部署、`paused = false`），所以首屏是空态：
「链上还没有任何盘口」+ 建盘入口。这是链上真实状态，不是渲染失败。

---

## 5. 目录

```
frontend/
├── index.html
├── vite.config.ts          @sdk 别名 → ../sdk/CentralPredictionSDK.ts（允许读父目录）
├── tailwind.config.js
├── scripts/
│   ├── smoke.py            首屏冒烟（控制台错误 / 失败请求 / 截图）
│   └── e2e_local.py        本地全链路 E2E（注入假钱包，真发交易）
└── src/
    ├── main.tsx            ToastProvider → App
    ├── App.tsx             三视图路由（大厅 / 持仓 / 事件）+ 详情弹层 + 连接弹窗
    ├── index.css           Tailwind 层 + 卡片/按钮/输入元语
    ├── lib/
    │   ├── config.ts       chainid、地址、RPC、滑点档位、冲击阈值
    │   ├── sdk.ts          publicClient（fallback）+ SDK Transport + 链上时间缓存 + ERC20 读取
    │   ├── wallet.tsx      EIP-6963 发现、切链、sendTransaction、USDC 授权
    │   ├── format.ts       USDC/概率/bps/倒计时/错误文案
    │   └── events.ts       事件中文名、盘口状态机
    ├── hooks/
    │   ├── useMarkets.ts   marketCount → marketIds → marketSnapshots（Multicall3）
    │   ├── usePortfolio.ts sharesOf + 余额 + 可提现/争议期判定
    │   ├── useEventFeed.ts 增量 getLogs → decodeLogs → Toast + 列表
    │   └── useToasts.tsx   Toast 上下文与渲染栈
    └── components/
        ├── Header.tsx / MarketCard.tsx / MarketDetail.tsx
        ├── TradePanel.tsx / PortfolioView.tsx / ActivityView.tsx
        ├── CreateMarket.tsx / ui.tsx
```

---

## 6. 实现要点（踩过的坑）

1. **报价必须双轨**：离线公式给即时反馈，链上 `previewBuy` 修正；`buildBuyShares` 内部还会再校一次，
   本地/链上不一致会抛 `local/QUOTE_MISMATCH` —— 前端把这句原样显示，不做兜底猜测。
2. **不设 `minSharesOut` 的保护价会被 SDK 直接拒**（`local/MIN_OUT_REQUIRED`），所以 UI 只暴露滑点档位，不暴露裸价。
3. **单笔上限是动态的**：`min(maxBet, depth × 5%)`，UI 显示的是「池深 5%」而不是合约的 10,000 USDC 硬顶。
4. **争议期 ≠ 已终结**：`resolved && !finalized` 期间 `redeem` 必失败，UI 直接把按钮置灰，不让用户白付 gas。
5. **SDK 的 `Hex` 是 `string`，viem 的 `Hex` 是 `` `0x${string}` ``**：跨层传 calldata 时钱包层统一收 `string`，
   否则 `tsc` 报 `Type 'string' is not assignable to '\`0x${string}\`'`。
6. **公共 RPC 会 429**：`llamarpc` 无 CORS 头，已从默认列表移除；现在默认
   `publicnode → 1rpc → mainnet.base.org`，任一失败由 viem fallback 自动切换。
7. **链上时间缓存 8 秒**：SDK 每次 build 都问一次 `now`，不缓存会把 `getBlock` 打成主要 RPC 消耗。
8. **事件用轮询不用 filter**：公共 RPC 的 `eth_newFilter` 会过期，8 秒增量 `eth_getLogs` 更稳。

## 7. 已知限制

- 只支持注入式钱包（EIP-6963 / `window.ethereum`），**没有做 WalletConnect**（移动端扫码得加 relay）。
- 没有 SSR / SEO，纯 SPA；分享链接用 `?market=<id>` 之类的路由还没加。
- 没有接 Keeper 的「自动裁决」按钮（`buildResolveMarket` / `buildOverrideResolution` 已在 SDK 里，
  UI 只给 admin/oracle 留了事件流可见性，没暴露改判面板）。
- 依赖公共 RPC，重查询场景（>100 盘口）需要换自建节点或付费 RPC。

---

## 8. 测试与验收（2026-10-27 实跑）

| 套件 | 命令 | 结果 |
|---|---|---|
| 合约 | `forge test` | **46 passed / 0 failed**（2 个 suite：单元 45 + invariant 1） |
| SDK | `cd sdk && npm test` | **70/70 passed**（legacy + central 两套） |
| 大脑（离线）| `cd hermes && python3 -m unittest test_verticals.py test_brain.py` | **49 passed**（多板块 27 + 原有 22） |
| 类型检查 | `cd frontend && npx tsc --noEmit` | **0 error** |
| 生产构建 | `node ./node_modules/vite/bin/vite.js build` | 成功，`dist/assets/index-*.js` ≈ 522 KB（gzip 167 KB）/ CSS 29 KB |
| 真链 E2E（本地 anvil）| `python3 scripts/e2e_local.py` | **11/11 PASS**（连接 → 看盘 → 买入 20 USDC → 持仓 YES 77.30 → 事件流），链上 `yesOf` 与 UI 一致 |
| UI E2E（品牌/模拟盘/海报/安全/文档）| `python3 scripts/e2e_ui.py [URL]` | **44/44 PASS**（本地 + 公网各一次，0 JS 报错） |
| 旧版多板块 UI E2E | 同上（已合并）| **20/20 PASS**（六板块导航 / 示例兜底 / 板块过滤 / 详情 / impact 预警 / 模拟下单 Toast / 辩论墙 / 刷新后评论仍在 / 0 JS 报错），本地与线上公网各跑一次 |


---

## 9. 品牌 2.0 / 模拟盘 / 分享海报（2026-10-28）

### 9.1 双模式交易

| 模式 | 入口 | 资金 | 结算 |
| --- | --- | --- | --- |
| 实盘 Real | 右上角分段开关 | 钱包里的真 USDC（Base） | 链上 `buyShares` / `sellShares` |
| 模拟 Paper | 同一开关，默认开启 | 一键领 **10,000 FAKE-USDC** | `src/lib/paper.ts` 本地即时结算 |

模拟盘的份额/均价/冲击/盈亏**全部调用 SDK 的 `previewBuyOffline` / `previewSellOffline`**，
与链上逐 wei 同构；冲击口径与合约一致（`amountIn / depth`，5% 硬上限），不是自造指标。

> 注意枚举陷阱：`OUTCOME_NO = 0, OUTCOME_YES = 1`，UI 的 `side 0` 是 YES，
> `paper.ts` 里用 `sdkOutcome()` 显式映射，映射错一次就是买反方向。

### 9.2 AI 智囊团评述

- 大脑侧：`hermes/insights.py` 把「链上真实池子 + RSS 情绪」写进 `public/insights.json`
  （`script/run-brain-mainnet.sh` 已带 `INSIGHTS_OUT`，每轮自动刷新）
- 前端：60 秒轮询；匹配不到就用规则引擎兜底，UI 明确标「本地推演 / 大脑实时产出」
- 组件：`src/components/AIInsights.tsx`，tone 五档（bull/bear/warn/geek/calm）

### 9.3 分享裂变

`src/lib/share.ts`：Canvas 1200×630，Mesh 渐变 + LOGO + 题面 + 方向 + 概率 + 回报 + 二维码；
`qrcode` 只在点「分享」时动态 import（28 KB 独立 chunk），不占首屏。
支持下载 PNG、X intent、复制文案；二维码落地 `?ref=share&m=<id>`。

### 9.4 安全中心 / 文档中心 / 健康探针

- `SecurityDrawer`：Slither 实测（0 High / 0 Medium / 12 Low / 7 Info，原始 JSON 在 `docs/security/`）、
  不变式 102,400 次调用、1 小时争议期、Safe 降级、已验证合约链接
- `DocsPortal`：用户入门 / Hermes AI 架构 / SDK 集成（代码与真实构造函数签名一致）
- `StatusBar`：浏览器直测 RPC 往返延迟 + 大脑心跳灯（`insights.json` 新鲜度）
- 首访 `RiskModal`：风险条款，确认后 localStorage 记住

### 9.5 视觉规范（CI 视作硬要求）

- 背景：四层径向 Mesh + 46px 网格 + 扫描线 + 漂移光斑，`body` 底色 `#05060a`
- 卡片：`backdrop-blur-xl` + 165° 白→透明渐变 + 内高光，hover 时 conic-gradient 流光描边 + 外发光
- 概率条：900ms `cubic-bezier(.34,1.56,.64,1)` 弹性；顶部高光 + NO 侧斜纹
- 音效：WebAudio 合成（click/success/claim/error/toggle），一键静音并持久化
- LOGO：一份矢量三处复用（导航 `LogoMark` / favicon 内联 data URI / 海报 Canvas）
