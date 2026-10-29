# Aura 项目全景资产清单（可直接对外展示）

> 生成时间：2026-10-28 · 仓库：`/root/prediction-market` · 链：Base 主网（8453）
> 原则：**每一条数字都来自本仓库的真实执行结果**，没有估算、没有「应该」。

---

## 一句话定位

> **Aura 是一个会自己出题、自己定价、自己结算的预测市场：Hermes AI 大脑供给内容，链上 CPMM 供给流动性，
> 1 小时争议期纠错，模拟盘负责零门槛拉新。合约在 Base 主网已验证，点开网页不用钱包就能开赌。**

对外三句话版本：
1. AI 每 5 分钟抓真实数据自动出题（加密 / 新闻 / 体育 / 电竞），不用人运营就有盘口。
2. 定价是链上 CPMM，`p_yes = noReserve / (yesReserve + noReserve)`，没有订单簿、没有做市商。
3. 新用户进站点就自动空投 10,000 模拟筹码，12 个精选盘口实时跳动，零门槛体验完整对赌流程。

---

## 1. 链上资产（Base 主网，已亮绿勾）

| 合约 | 地址 | 状态 |
| --- | --- | --- |
| CentralPredictionEngine | `0xE6056Bc6700F6d7E6fF8779B212655284dc1631C` | ✅ Basescan Verified（solc 0.8.24 / MIT / Exact Match） |
| ProtocolFeeVault | `0x29dE563f3059827D00837305FAE2Bbc87c7D9eE1` | ✅ Basescan Verified |
| USDC（官方） | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 官方代币，6 位小数 |

- Engine 构造参数：`(usdc, feeVault, admin, creator)` = `0x8335…2913, 0x29dE…9eE1, 0x436b…5Ba1, 0x436b…5Ba1`
- Vault 构造参数：`(usdc, admin, treasury)` = `0x8335…2913, 0x436b…5Ba1, 0x436b…5Ba1`
- 费率：交易 **1.5%** 进 ProtocolFeeVault，结算 **0.5%**
- 争议期：结算后 **1 小时**（期间禁止提现，Safe 可改判）
- 兜底：结算超时 **7 天** 任何人可 `emergencyRefund` 全额退款
- 字节码/源码一致性：Sourcify `exact_match`（1798B / 13196B，差异仅在 immutable 槽）

---

## 2. 代码资产（行数实测）

| 模块 | 位置 | 规模 |
| --- | --- | --- |
| 核心合约 | `src/*.sol` + `src/libraries` | 970 行（含注释） |
| 合约测试 | `test/*.sol`（单元 + 不变式） | 1,274 行 |
| TypeScript SDK | `sdk/CentralPredictionSDK.ts` | 1,834 行 |
| 前端 | `frontend/src`（React 18 + Vite + Tailwind） | 6,160 行 |
| Hermes AI 大脑 | `hermes/*.py`（含 4 个板块适配器） | 2,545 行 |

---

## 3. 能力矩阵（点开网页就能看到的东西）

| 能力 | 实现 | 现状 |
| --- | --- | --- |
| 首屏欢迎礼包 | `frontend/src/components/WelcomeAirdrop.tsx` | 确认风险后**自动**空投 10,000 FAKE-USDC，数字滚动 + 金币上浮动效 |
| 默认模式 | `frontend/src/lib/mode.tsx` | **首访强制模拟演练（Paper）**；只有用户主动点「实盘 Real」才切真实交易 |
| 大厅铺满 | `frontend/src/lib/demo.ts` | 12 个精选示例盘口，Paper 模式下置顶铺满首屏 |
| 实时行情 | `frontend/src/lib/demoLive.ts` | 每 7 秒随机游走 + 均值回归（漂移上限 ±9%），概率条与数字带方向性闪光 |
| AI 智囊点评 | `frontend/src/lib/insights.ts` + `AIInsights.tsx` | 大脑产出（`insights.json`）优先，缺失时本地规则推演，**UI 明确标注来源** |
| 辩论墙 | `frontend/src/lib/comments.ts` | 每盘独立讨论、YES/NO/中立立场条、localStorage 持久化；大厅卡片直接显示最新一条 |
| 模拟下单 | `frontend/src/lib/paper.ts` | 与链上**同一套 CPMM 公式**（`previewBuyOffline`），含 1.5% 费率、滑点、冲击预警 |
| 实盘交易 | `frontend/src/components/TradePanel.tsx` | EIP-6963 钱包发现、Base 切链、链上报价二次校正、`impact_near_limit` 二次确认 |
| 分享裂变 | `frontend/src/lib/share.ts` | Canvas 生成海报 + 二维码（qrcode 动态 import）+ X 分享 |
| 安全中心 | `frontend/src/components/Overlays.tsx` | Slither 结果、不变式测试次数、争议期、已验证地址，全部真实数据 |
| 文档中心 | 同上 | 用户入门 / Hermes AI 架构 / SDK 集成 三合一 |
| 健康探针 | `frontend/src/components/StatusBar.tsx` | 页脚 Base RPC 延迟 + Hermes 大脑心跳灯 |

---

## 4. 内容资产：12 个精选盘口（示例，不上链）

| # | 板块 | 题目 | 初始 YES | 池深 | 结算 |
| --- | --- | --- | --- | --- | --- |
| 1 | 加密 | BTC 能否在 24 小时内突破 $88,000？ | 31.0% | 46,000 | 22h |
| 2 | 加密 | ETH 现货 ETF 能否在本周内录得单日净流入超过 5 亿美元？ | 44.0% | 31,500 | 96h |
| 3 | 加密 | DeFi 总锁仓量能否在 48 小时内重回 1,200 亿美元上方？ | 58.0% | 22,800 | 46h |
| 4 | 新闻 | 美联储是否会在下次议息会议声明中明确提及「降息」？ | 37.0% | 52,000 | 70h |
| 5 | 新闻 | 本周内是否会出现至少两家主流媒体确认的停火协议？ | 23.0% | 38,000 | 118h |
| 6 | 科技 | 欧盟 AI 法案的实施细则能否在本月内正式生效？ | 66.0% | 27,000 | 140h |
| 7 | 体育 | Boston Celtics 能否在今晚的 NBA 比赛中击败 Brooklyn Nets？ | 72.0% | 41,000 | 9h |
| 8 | 体育 | Arsenal 能否在本轮英超击败 Chelsea？ | 49.0% | 33,500 | 40h |
| 9 | 体育 | Kansas City Chiefs 能否在客场取胜？ | 55.0% | 19,800 | 62h |
| 10 | 电竞 | T1 能否在 Worlds 淘汰赛中击败 Movistar KOI？ | 63.0% | 24,600 | 28h |
| 11 | 电竞 | CS2 Major 小组赛中，欧洲赛区能否取得超过 60% 的胜场？ | 41.0% | 16,400 | 80h |
| 12 | 电竞 | Sentinels 能否在下一场 VCT 比赛中以 2:0 取胜？ | 28.0% | 13,200 | 52h |

- 模拟累计成交额：**1,226,100 USDC**（12 盘加总，仅展示用，不是链上数字）
- 每道题都带**客观判定标准**（数据源 + 阈值 + 延期/取消处理），与链上 `criteria` 同义
- 预置「官方话题」冷启动评论 5 个盘口共 7 条，UI 标 `seeded`

---

## 5. 测试与安全实测（本次运行）

| 套件 | 结果 | 命令 |
| --- | --- | --- |
| Foundry 合约测试（单元 + 不变式） | **46 / 46 通过** | `forge test` |
| TypeScript SDK 离线用例 | **70 / 70 通过** | `cd sdk && npm test` |
| Hermes 大脑（板块 / 校验 / 指纹） | **49 / 49 通过** | `python3 -m unittest discover -s hermes -p 'test_*.py'` |
| 前端 UI E2E（Playwright，含欢迎礼包/12 盘口/AI/辩论/海报） | **55 / 55 通过** | `frontend/scripts/e2e_ui.py` |
| 前端真链 E2E（anvil + 假钱包：连接/报价/买入/持仓/事件流） | **11 / 11 通过** | `frontend/scripts/e2e_local.py` |
| 前端类型检查 | 0 error | `cd frontend && npx tsc --noEmit` |
| 前端生产构建 | 成功（dist 200K，gzip 183KB JS） | `npm run build` |

安全（Slither 0.10.0，真实 JSON 在 `docs/security/slither-report.json`）：

- **0 High / 0 Medium**
- 12 Low：全部是 `block.timestamp` 相关（争议期/退款期限的预期用法）
- 7 Informational：5 条 solc 版本提示 + 2 条圈复杂度
- 不变式测试：**512 runs × 深度 200 = 102,400 次 handler 调用，0 次不变式破坏**
- 8 个 handler 选择器各约 1.25 万次调用（buy/sell/resolve/redeem/sweep/warp 等）

> 本次顺手修掉一个真实缺陷：`hermes/test_verticals.py` 把电竞样例的 `startTime` 写死成 2026-10-28，
> 时间一过用例就必红。已改成相对于 `now` 生成，测试从此不会「随日期腐烂」。

---

## 6. 部署与运维资产

| 用途 | 脚本 | 验证状态 |
| --- | --- | --- |
| 推 GitHub（PAT，免浏览器登录） | `scripts/github_push.sh` | ✅ mock API + 本地 bare 仓库全链路自测通过 |
| 永久域名（Vercel） | `deploy/vercel.sh` | ✅ 脚本语法 + dry-run 通过；真实部署需你的 `VERCEL_TOKEN` |
| 永久域名（Netlify，纯 API） | `deploy/netlify.sh` | ✅ 本地 mock API 全链路通过（建站 → zip → 上传 → 轮询 → 回读 200） |
| 临时公网隧道（旧方案） | `deploy/tunnel.sh`（cloudflared） | ⚠️ 地址一次一变，建议只用它做临时演示 |
| 合约验证 | `deploy/verify-basescan.sh` | ✅ 主网已验证 |
| 大脑常驻 | `deploy/hermes-brain.service` | systemd unit |

截图（本机生成，可直接放进 README / 投资材料）：

- `reports/shots/01-risk-modal.png` 首访合规弹窗
- `reports/shots/02-welcome-airdrop.png` 欢迎礼包 · 已到账 10,000
- `reports/shots/03-hall-paper.png` Paper 大厅（12 盘口铺满）
- `reports/shots/04-hall-paper-full.png` 整页长图
- `reports/shots/05-demo-detail.png` 示例盘口详情（AI 评述 + 模拟下单 + 辩论墙）

---

## 7. 文档索引

| 文档 | 内容 |
| --- | --- |
| `README.md` | 项目总览、经济模型、主网地址、10 分钟本地跑起来 |
| `docs/CENTRAL-ENGINE.md` | 引擎合约设计（CPMM、争议期、退款、费用） |
| `docs/CENTRAL-SDK-GUIDE.md` | SDK 集成（Multicall3、离线报价、事件解析） |
| `docs/BRAIN-VERTICALS.md` | 大脑四板块数据源与出题/裁决规则 |
| `docs/SECURITY.md` | 安全矩阵与 Slither 结论 |
| `docs/VERIFICATION.md` | 合约验证记录（Basescan / Sourcify） |
| `docs/MAINNET-DEPLOYED.md` | 主网部署参数与交易哈希 |
| `docs/DEPLOYMENT.md` | 完整部署流程 |
| `docs/GITHUB-PUSH.md` | **一键推 GitHub 指南（PAT 自动化）** |
| `docs/DEPLOY-PERMANENT.md` | **Vercel / Netlify 永久域名一条命令** |
| `docs/BRAND.md` | 品牌与视觉系统 |
| `HANDOFF.md` | 断点续传（下一阶段从哪继续） |

---

## 8. 现在的公网状态（诚实版）

- **GitHub：已上线。** https://github.com/PeaceCoin10/Aura-AI-Prediction-Market
  （`main` 分支、`public`、远端 HEAD `e78b7a2` 与本地一致，160 个文件；PAT 权限为 `public_repo`）
- 旧的 `PUBLIC-URL.txt` 里那条 `trycloudflare.com` 是**一次性隧道**，本次检查时 cloudflared 进程已不在，
  地址随时失效 —— 不要拿它当官网。
- 永久域名**还没落地**，因为部署需要一个你自己的平台 token。落地只需一条命令：

```bash
# 二选一
VERCEL_TOKEN=xxx  ./deploy/vercel.sh
NETLIFY_TOKEN=xxx ./deploy/netlify.sh --build
```

- 本机当前可访问：`frontend/dist` 静态预览 `http://127.0.0.1:4173/`（临时，仅供本机验收）。

---

## 9. 可炫耀的三段素材

**技术向**
> 46 条 Solidity 合约测试（单元 + 不变式）全绿，不变式 512×200 = 10.24 万次调用零破坏；Slither 0 High/0 Medium；
> Base 主网双合约 Verified；前端 55 条 UI E2E + 11 条真链 E2E；SDK 70 条离线用例，报价公式与链上同构。

**产品向**
> 点开网页第一秒就被空投 10,000 模拟筹码，12 个真实判定的盘口已经在跳价，AI 点评、辩论墙、分享海报全在线；
> 想上真钱？右上角一按切实盘，同一个 CPMM 曲线，同一个价格。

**增长向**
> 每张盘口都能一键出海报（带二维码 + 邀请参数），海报里带着实时概率和赔率倍数 —— 这就是预测市场最天然的传播单元。
