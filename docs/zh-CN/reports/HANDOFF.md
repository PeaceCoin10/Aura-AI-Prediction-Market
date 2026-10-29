# 断点续传 / HANDOFF

最后更新：2026-10-25（新增单合约多盘口引擎 CentralPredictionEngine + Hermes 全自动大脑）

---

## 一、一句话状态

合约、测试、SDK、Keeper、E2E **全部绿灯**，可以进入"部署到 Base 测试网 → 前端接入"阶段。
没有半成品、没有已知失败用例。

```
forge test   →  89 passed / 0 failed
不变式        →  1000 runs × 100 步 = 100,000 调用, 0 revert, 9/9
SDK 单测      →  46/46
链上 E2E      →  11/11 (anvil 全链路, ALL GREEN)
```

---

## 二、开机后第一件事（30 秒验证环境没坏）

```bash
export PATH=/opt/foundry:$PATH
cd /root/prediction-market

forge build                    # 应输出 Compiler run successful
forge test                     # 应输出 89 passed, 0 failed（约 60s）
cd sdk && npm test             # 应输出 46/46 passed
```

若 `forge` 报找不到 → `/opt/foundry` 还在，重新 export PATH 即可。
若 `npm test` 报 `Cannot find module dist/...` → `cd sdk && npm run build` 重编。

---

## 三、当前代码事实（不要凭记忆，按这个查）

### 合约
| 文件 | 行数 | 关键点 |
|---|---|---|
| `src/PredictionVault.sol` | ~610 | CPMM + `Pausable` + **两步 `transferAdmin`/`acceptAdmin`** + `maxBet` + LP 份额账本 |
| `src/ConditionalToken.sol` | 185 | ERC1155Supply，1:1 拆分/合并 |
| `src/PredictionFactory.sol` | ~215 | EIP-1167 克隆，`createMarket` **6 个参数**，自带两步 admin（已脱离 OZ Ownable） |
| `src/ProtocolFeeVault.sol` | 71 | `autoDistributeFee()` 任何人可触发 |
| `src/libraries/FixedPoint.sol` | 58 | mulDivDown/Up + bpsDown/Up |

### 硬参数
```
minBet 下限 5 USDC (5e6)          工厂硬顶，盘口不可低于此值
maxBet 上限 10,000 USDC (1e10)    工厂硬顶，盘口不可高于此值
单笔影响上限 500 bps (5% 池深)     盘口可调低
交易费 150 bps / 结算费 50 bps
退款窗口 resolutionTime + 7 days
赎回闸门：暂停期间禁止，但过了 refund 窗口强制放行
```

### 三道闸顺序（不可调换）
```
buy(amountIn)
  ├─ amountIn <  minBet → BelowMinBet()
  ├─ amountIn >  maxBet → AboveMaxBet()
  └─ amountIn >  池深×5% → ImpactTooHigh()
```

### 接口签名（前端照这个接）
```solidity
createMarket(bytes32 conditionId, address admin, uint256 resolutionTime,
             uint256 minBet, uint256 maxBet, uint256 maxImpactBps)  // 0x0ca07ff7
buy(uint8 outcome, uint256 amountIn, uint256 minSharesOut)          // 0xf6d956df
sell(uint8 outcome, uint256 sharesIn, uint256 minAmountOut)
pause()    // 0x8456cb59
unpause()  // 0x3f4ba83a
transferAdmin(address)  // 0x75829def  第 1 步：只写 pendingAdmin
acceptAdmin()           // 0x0e18b681  第 2 步：pendingAdmin 本人接受
pendingAdmin()          // 0x26782247  0x0 = 没有进行中的移交
admin()                 // 0xf851a440
```

---

## 四、文件地图

```
/root/prediction-market/
├── src/                    5 个合约 + FixedPoint 库
├── test/
│   ├── BasePrediction.t.sol          部署基座 + _assertSolvent + _newDeepMarket
│   ├── PredictionBusiness.t.sol      37 条业务（含 5/10,000 边界）
│   ├── PredictionSecurityTest.t.sol  39 条攻防（含 8 条熔断/移交）
│   └── PredictionInvariant.t.sol     9 条不变式 + 13 入口 handler
├── script/
│   ├── Deploy.s.sol                  Base 主网（已验证本地实跑）
│   ├── DeployLocal.s.sol             anvil 一键部署 fast/slow 两盘口
│   ├── PredictionSecurityTest.s.sol  17 项独立攻防演练
│   └── e2e-local.sh                  全链路一键跑（anvil→部署→keeper→SDK）
├── sdk/                             PredictionSDK.ts + 31 条单测 + e2e.ts
├── keeper/                          keeper.js + README + config.example.json
├── REPORT.md                        Phase 1（安全与参数）
├── REPORT-PHASE2.md                 Phase 2（Keeper/SDK/不变式）
├── REPORT-PHASE3.md                 Phase 3（Pausable + 6 参 ABI 同步）← 最新
├── DEPLOY-PARAMS.md                 部署一页纸（参数/顺序/核对清单）
├── HANDOFF.md                       本文件
├── test-all.log                     最近一次全量测试输出
├── gas-unit.log                     单元测试 gas 报告
└── .git/                            本次提交 38ff59b
```

---

## 五、没做完的事（按优先级）

1. **Base Sepolia 灰度**（下一步该做的）
   - `script/Deploy.s.sol` 按 chainid 自动选 USDC（84532 → `0x036CbD53842c5426634e7929541eC2318f3dCF7e`，已实测 symbol/decimals）
   - 跑一遍 `pause → unpause → transferAdmin → acceptAdmin` 演练（部署脚本内置两步移交第 1 步）
   - 用 Keeper 真实轮询几个小时，确认告警/Safe 提案 JSON 能生成
   - 手册：`docs/BASE-SEPOLIA-DEPLOY-KEEPER.md`（测试网）/ `docs/BASE-MAINNET-CHECKLIST.md`（主网 10 项核对）

2. **前端联调**
   - SDK 已就绪，前端只要实现一个 `ethCall(to, data)` 传输层
   - 展示上限请用 `min(maxBet, depth × maxImpactBps / 10000)`，不要直接显示 10,000
   - 错误提示直接用 `PredictionSDK.mapRevert(err).message`

3. **第三方审计**（上主网前必须）
   - 78 条测试 + 100,000 次不变式调用 ≠ 审计
   - 重点看：LP 份额账本、赎回闸门的时间例外、克隆初始化的重入面

4. **已知未做的小项**
   - 合约没有 `previewSell`，SDK 卖出侧是本地复刻 CPMM 公式（有单测覆盖，但比买入侧少一道链上校验）
   - Keeper 的 Safe 提案只生成 JSON，没有自动签名提交（by design，admin 权在多签）

---

## 六、环境备忘

```
Foundry  /opt/foundry  （forge/cast/anvil v1.8.5-dev，用前 export PATH=/opt/foundry:$PATH）
solc     0.8.24
OZ       v5.0.2
Node     v23.11.1 / TypeScript 5.6.3 / ethers v6（keeper 用）
代理     http://172.29.208.1:16780（仅 GitHub/npm/文档；链上 RPC 必须 ProxyHandler({})）
坑       pkill -f 会匹配到自己的命令行导致自杀，杀端口用 fuser -k <port>/tcp
```

---

## 七、回滚

```bash
cd /root
tar xzf backup_prediction_20261024.tar.gz     # 完整快照，含 node_modules / lib / out
# 或者只回滚代码：
cd /root/prediction-market && git reset --hard 38ff59b
```

上一版全量备份（猎杀期结束时的环境）：`/root/backup_20261023_prediction/`

## 2026-10-25 追加：单合约多盘口架构（CentralPredictionEngine）

| 文件 | 说明 |
|---|---|
| `src/CentralPredictionEngine.sol` | 单合约 N 盘口：`mapping(bytes32 => Market)`，独立 cash/owed/储备，CPMM + mint-split 定价 |
| `hermes/hermes_brain.py` | 全自动大脑：Creator（行情→出题→建盘→做市）/ Marketing（模板或 LLM 文案）/ Oracle（到点按行情裁决，7 天兜底退款） |
| `hermes/test_brain.py` | 13 条离线单测（决策逻辑 / 文案 / 状态文件 / 视图解析） |
| `test/CentralEngine.t.sol` | 35 条：建盘、做市、买卖、滑点、影响上限、结算、赎回、超时退款、暂停例外、扫残余、多盘隔离、全流程 |
| `test/CentralEngineInvariant.t.sol` | 4 条不变式 × 1000 runs × 100 calls（cash≥owed、cash≥单边供应、无暗账、库存自洽） |
| `script/DeployCentral.s.sol` | 一键部署（本地自动发 MockUSDC，8453/84532 自动选真 USDC） |
| `docs/CENTRAL-ENGINE.md` | 架构 / 定价数学 / 不变式 / 角色 / 事件表 / 与旧架构对比 / 已知问题 |

测试总数：`forge test` = **125 passed**（老 89 + 新 36），`hermes/test_brain.py` = **13 passed**。
`foundry.toml` 打开 `via_ir = true`（Solc 0.8.24 非 IR 管线在 `marketCore` 多返回值上 stack-too-deep），
老合约 89 条在 via_ir 下仍全绿。

**待你决策**：老 `PredictionVault.buy` 只给 `dy` 不给 `net + dy`，50% 赔率下买 100 只能赔 89.22（必亏）。
新引擎已修正；老合约未动，需要确认后再回补。

## 2026-10-25 追加：争议缓冲期 + 抗插针 + 工作区清理（主网发车前最后一轮）

| 项目 | 现状 |
|---|---|
| 裁决争议期 | `DISPUTE_WINDOW = 1 hours`；`resolveMarket` 后进 Disputing，`redeem`/`sweepResidual` 全拒；`overrideResolution`（onlyAdmin，Safe 多签）可改判且不延长窗口；到点纯时间戳自动放行；`finalize(id)` 任何人可调仅为索引器留日志；`emergencyRefund` 直接终结不额外等 1h |
| 决策快照 | `Market` 新增 `disputeEndsAt / finalized / disputes / yesUserAtSettle / noUserAtSettle`；改判按 `*AtSettle` 重算 `owed` 并强制 `cash >= owed` |
| 视图 | `resolutionState(id)` / `isFinal(id)` |
| 大脑抗插针 | Oracle 连续采样 3 次 × 间隔 30s（`ORACLE_CONFIRM_SAMPLES/GAP`），全部同向才 `resolveMarket`；失败/翻转一律 skip |
| 工作区 | 旧架构整体移到 `legacy/`（独立 foundry 工程，`cd legacy && forge test` = 89 passed），主工程只剩引擎 + FeeVault + FixedPoint + MockUSDC |
| 部署脚本 | `DeployCentral.s.sol` 主网硬校验（ADMIN/TREASURY 必须合约、ADMIN≠部署者、USDC 6 位、creator≠oracle）；ADMIN 是 Safe 时打印 `setCreator/setOracle` calldata 交多签执行 |
| 测试 | 主工程 46（45 单元 + 5 条不变式 × 1000×100）/ legacy 89 / 大脑 22 / SDK 46 / e2e-dispute 9 项全 PASS |
| Slither | 18 条：0 High / 0 Medium（Low 12 全是 timestamp 业务比较） |
| 主网 fork | chainid 8453、block 53,076,846、部署 gas 4,582,141（≈$0.07–0.09）、引擎 runtime 13,196 B |

完整报告：`REPORT-MAINNET-FINAL.md`。**未做**：第三方审计、签名价格源、去中心化仲裁、新引擎前端 SDK。

## 2026-10-25 追加：新引擎前端 SDK

| 文件 | 说明 |
|---|---|
| `sdk/CentralPredictionSDK.ts` | 绑定 `CentralPredictionEngine`：`buildCreateMarket / buildBuyShares / buildSellShares / buildRedeem / buildResolveMarket / buildOverrideResolution`，全部带链上 preflight；calldata 手工编码，零依赖 |
| `sdk/CentralPredictionSDK.test.ts` | 44 条：28 个函数选择器 + 34 个错误选择器逐条对 `cast sig`；7 个 builder 的 calldata 与 `cast calldata` 逐字节相等；保护价三道闸；`decodeRevert` 双层映射；离线定价与真链报价逐位相等 |
| `sdk/e2e-central.ts` + `script/e2e-sdk-central.sh` | 真链联调 10 项：建盘→做市→买→卖→裁决→争议期拦提现→Safe 改判→提现→扫残余 |
| `docs/CENTRAL-SDK-GUIDE.md` | 前端对接指引：ABI 对照表、6 个 builder 预检清单、错误码表（含 selector）、状态机、6 条踩坑 |

测试面：`cd sdk && npm test` = **90 passed**（旧 46 + 新 44）。旧 `PredictionSDK.ts` 仅历史回归，其 vault/factory 已归档。

## 2026-10-27 主网发车（单钱包模式）+ SDK 三项增强

**已上 Base 主网**（不是计划，是可查的事实）：

| 项 | 值 |
|---|---|
| CentralPredictionEngine | `0xE6056Bc6700F6d7E6fF8779B212655284dc1631C` |
| ProtocolFeeVault | `0x29dE563f3059827D00837305FAE2Bbc87c7D9eE1` |
| 部署 tx | `0x5bf19d73…def910b`（vault）/ `0x7988a091…7932c9`（engine） |
| gas | 4,582,688，实付 ≈ 0.0000192 ETH |
| 验证 | Sourcify 两个合约 exact_match；Etherscan V2 本机不通（详见 docs/MAINNET-DEPLOYED.md） |

单钱包：ADMIN = TREASURY = CREATOR = ORACLE = `0x436b…5Ba1`；`REQUIRE_SAFE_CONTRACT=0`。
主网状态现查：paused=false、marketCount=0、MIN_BET=5e6、MAX_BET=1e10、费率 150/50、争议期 3600s。

**卡点**：钱包 USDC 余额 = 0 → 能建盘不能做市；ETH 余额 0.00144（≈$4.5），够几百笔。

SDK 三项增强（`sdk/CentralPredictionSDK.ts`）：
1. 事件解码：`EVENT_TOPICS` / `decodeLog` / `decodeLogs` / `sdk.decodeReceiptLogs`，19 个事件全覆盖；
2. `marketSnapshots(ids)`：Multicall3 一次 RPC 拿 N 个盘口的价格/池深/状态，失败自动降级逐条；
3. `SLIPPAGE_CONSERVATIVE/NORMAL/DEGEN` + `plan.warning="impact_near_limit"`（冲击 ≥ 上限 80%）。

测试面：`cd sdk && npm test` = **112 passed**（旧 46 + 新 66）；`forge test` = 46；
`bash script/e2e-sdk-central.sh` = **14/14**（含真实 receipt 事件解码、冲击预警临界值）。

新增文件：`script/run-brain-mainnet.sh`、`deploy/hermes-brain.service`、`docs/MAINNET-DEPLOYED.md`。

## 2026-10-27 追加：前端 DApp 落地（frontend/）

| 项 | 状态 |
|---|---|
| 技术栈 | Vite 5 + React 18 + TS + Tailwind + viem；SDK 走 `@sdk` 别名直连 `sdk/CentralPredictionSDK.ts` |
| 代码位置 | `frontend/src`（App / lib / hooks / components），说明见 `frontend/README.md` |
| 类型 | `npx tsc --noEmit` = 0 错误 |
| 构建 | `vite build` 成功（dist ≈ 498 KB JS / 21 KB CSS） |
| 本地 E2E | `python3 frontend/scripts/e2e_local.py` = **11/11 PASS**（anvil 31337 + 注入 EIP-1193 假钱包，真发 approve+buy 交易，持仓 YES 114.90 链上核对一致） |
| 主网冒烟 | `python3 frontend/scripts/smoke.py` 首屏正常，`marketCount = 0` → 空态 + 建盘入口 |
| 覆盖需求 | 钱包连接/EIP-6963/切链 8453、Multicall3 盘口大厅、buildBuyShares/buildSellShares+滑点+impact_near_limit 弹窗、持仓与 Redeem+争议期高亮、decodeLogs 事件流 Toast |

Basescan 验证状态：Sourcify 两个合约 `exact_match`；Basescan 绿勾**仍未拿到**，
阻塞点是 API key / Cloudflare Turnstile（实测证据 + 两步补齐命令见 `docs/VERIFICATION.md`）。

## 2026-10-27 追加：公网发布 + 大脑常驻

| 项 | 状态 |
|---|---|
| 公网地址 | `https://7a051387baf6ba.lhr.life`（生产包 dist + localhost.run 免费隧道，无账号；`deploy/tunnel.sh` 守护，断线 3 秒自愈，当前域名随时 `cat PUBLIC-URL.txt`） |
| 环境变量 | `frontend/.env` 写入主网 ENGINE/USDC/RPC，已 inline 进 `dist/assets/index-*.js`（grep 得到 engine 地址） |
| 线上验证 | curl 200 + Playwright 真浏览器：首屏渲染、读到 Base 主网 marketCount=0、控制台 0 错误 0 失败请求 |
| 说明 | 隧道域名会随重连变化；固定域名只差一个 Vercel/Netlify token（命令见 `docs/DEPLOYMENT.md`） |
| 大脑守护 | `hermes/hermes_brain.py` 常驻（300s 一轮，pid 见 `ps`），**必须 `PATH=/opt/foundry:$PATH`** 否则 `cast` 报 GLIBC 2.32 缺失 |
| 大脑现状 | 每轮读链正常，日志 `insufficient USDC for seeding: have 0.00, need 100.00 — skip creating` → 不发交易、不烧 gas；钱包一有 USDC 自动建盘+做市 |
| Basescan | 降维方案已落 `deploy/verify-basescan.sh` + `docs/VERIFICATION.md` 第 2 节：只要有 `ETHERSCAN_API_KEY`，一条命令后台完成 |

## 2026-10-28 追加：多板块大脑 + 全板块前端

| 项 | 内容 |
|---|---|
| 大脑多板块 | `hermes/verticals.py`：crypto(CoinGecko/Binance)、news(Cointelegraph/The Block/Decrypt/BBC RSS)、sports(ESPN NBA/NFL/英超/欧冠/美职联)、esports(LoL Esports)；`validate_binary_question()` 强校验二元/结算时间/判定标准；news 类**只出题不自动裁决** |
| 大脑 CLI | `--verticals crypto,news,sports,esports`、`--create-per-cycle N`；每板块保底 1 条再轮转；无 USDC 时打 `[plan-only]` 日志 |
| 大脑测试 | `cd hermes && python3 -m unittest test_verticals.py test_brain.py` → **49 passed** |
| 实跑证据 | 主网 dry-run：4/4 板块出题（BTC / BBC 新闻 / Celtics NBA / KOI vs T1 Worlds），结算时间与判定方式均落盘 |
| 前端 | 六板块导航、12 个示例盘口（真实 CPMM 报价）、模拟下单 + impact_near_limit 预警、辩论墙（localStorage）、赛博暗黑动效 |
| 前端测试 | `e2e_local.py` 11/11 PASS（真链买卖）；`e2e_ui.py` 20/20 PASS（本地 + 公网）；`tsc` 0 error；build 522KB/167KB gzip |
| 公网地址 | `https://combination-ladder-scratch-qualifying.trycloudflare.com`（Cloudflare 快速隧道，无需账号）；`cat PUBLIC-URL.txt` 永远是当前地址，`deploy/tunnel.sh` 负责重连并回写 |

## 2026-10-28 追加：品牌 2.0 + 模拟盘 + AI 智囊团 + 分享裂变 + 安全/文档中心

| 项 | 内容 |
|---|---|
| 品牌 | `frontend/src/components/BrandLogo.tsx`：眼形 + 六边矩阵 + 代理节点的矢量 LOGO；同一份矢量用于导航 `LogoLockup`、favicon（`index.html` 内联 data URI）、海报 Canvas（`logoSvgDataUri`） |
| 视觉 2.0 | `index.css`：四层 Mesh 径向渐变 + 网格 + 扫描线 + 漂移光斑；`.glass-panel` / `.flow-border`（conic 旋转描边）/ `.hover-glow`；卡片 165° 白→透明渐变；概率条 900ms 弹性缓动 + 高光 + NO 斜纹 |
| 音效 | `src/lib/sound.ts`：WebAudio 合成 click/success/claim/error/toggle，零素材；`SoundToggle` 一键静音（持久化 `aura.sound.muted`） |
| 模拟盘 | `src/lib/paper.ts` + `src/components/PaperPanel.tsx`：默认 Paper 模式，一键领 10,000 FAKE-USDC；买卖/份额/均价/冲击/持仓市值/浮动盈亏全部复用 SDK 同构公式；`PaperPortfolio` 汇总持仓与盈亏 |
| 修过的坑 | SDK `OUTCOME_NO=0 / OUTCOME_YES=1`，UI 的 side 0=YES 必须显式映射，否则买反方向（份额从 156 变 264、均价错成 0.38）；冲击口径改为与合约一致 `amountIn/depth` |
| AI 智囊团 | `hermes/insights.py` 生成 `frontend/public/insights.json`（链上池子 + RSS 情绪），`run-brain-mainnet.sh` 每轮写一次；前端 60s 轮询，缺失时规则引擎兜底并标注「本地推演」 |
| 分享裂变 | `src/lib/share.ts`（Canvas 1200×630 + 二维码 + X intent），`qrcode` 按需动态 import（独立 28KB chunk） |
| 安全/文档 | `Overlays.tsx`：Slither 实测 0 High/0 Medium/12 Low/7 Info、不变式 102,400 次调用、1h 争议期、Safe 降级、已验证地址；DocsPortal 三合一（入门/AI 架构/SDK，构造函数签名与真实 SDK 一致）；首访 RiskModal |
| 健康探针 | `useHealth` + `StatusBar`：浏览器直测 Base RPC 往返延迟、大脑心跳灯（insights 新鲜度）、Basescan 入口 |
| 测试 | forge **46 passed**；SDK **70/70**；hermes **49**；`tsc --noEmit` 0 error；`e2e_ui.py` **44/44**（本地 + 公网）；不变式 **102,400 calls / 0 breaks** |
| 文档 | 根 `README.md`（架构图/经济数学/白名单/快速开始/SDK）、`docs/SECURITY.md`、`docs/BRAND.md`、`docs/security/slither-report.json` |
| 构建 | dist 主包 560KB（gzip ~185KB）+ 分享 chunk 28KB + CSS 29KB |
| 公网 | 以 `PUBLIC-URL.txt` 为准；隧道进程存活地址稳定，失效用 `./deploy/tunnel.sh start` 重连 |
| 未完成 | GitHub 远程仓库重命名/推送：本环境 `gh` 未登录、无 `GITHUB_TOKEN`，仓库无 remote；本地已按 `aura-ai-prediction-market` 命名（根 package.json），拿到 token 后可直接建仓推送 |
