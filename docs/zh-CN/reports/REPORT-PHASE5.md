# Phase 5 报告 —— 主网预备硬化（SDK 防夹 + 静态扫描 + 事件完整性 + 主网预案）

日期：2026-10-25　基线：Phase 4（两步 admin + Sepolia 部署准备）

---

## 一、结论

| 项目 | 结果 |
|---|---|
| `forge test` | **89 / 89**（Business 40 + Security 47 + Invariant 2） |
| SDK 单测 | **46 / 46** |
| 本地 E2E（anvil + Keeper + SDK 链上） | **11 / 11，ALL GREEN** |
| Slither（Vault / Factory / ConditionalToken / ProtocolFeeVault） | **0 High / 0 Medium**；Low 8（`block.timestamp` 业务必需）、Info 11 |
| Base 主网 fork 部署演练（chainId 8453 + 真 USDC） | 部署成功，gas 8,539,550；`REQUIRE_SAFE_CONTRACT` 生效 |
| 主网 fork 上的两步移交 | factory `admin=Safe`、`pendingAdmin=0`、旧 EOA 全部 `OnlyAdmin` |
| 主网 fork 上的 Ownable2Step | `ConditionalToken.owner` 两步迁到 Safe；`renounceOwnership` → `RenounceDisabled` |

净增：forge +5、SDK +11。

---

## 二、SDK：MEV 保护与"网络抖动下 minSharesOut 仍严格"

### 2.1 事实基线（先查，再写代码）

- **Flashbots Protect 官方只支持以太坊主网(1) 与 Sepolia(11155111)，不支持 Base**。把 Base 交易往
  `rpc.flashbots.net` 发会被拒。因此 SDK **不会**伪造一条"Base 走 Flashbots"的默认路由。
- **Base 是单排序器、没有公开 pending mempool**：交易直塞 sequencer 队列，传统"监听 mempool 抢跑"不成立；
  残余夹子面是 RPC 层可见性、Flashblocks（~200ms）预确认可观测性、以及转卖订单流的中间商。
  要更硬的隐私，必须由调用方接私有/MEV 保护端点（SDK 提供 `mevProtectedRoute()` 构造器，不内置任何 URL/key）。

### 2.2 新增能力

| API | 作用 |
|---|---|
| `KNOWN_ROUTES` | 已核实的路由表：ETH 主网/Sepolia → Flashbots Protect（`private-relay`）；Base 主网/Sepolia → 官方 RPC（`sequencer-private`） |
| `routesForChain(chainId, extra)` | 按链筛 + 按隐私等级排序（私有中继 > 排序器私有 > 公开）；**未知链返回空数组**，绝不静默降级到公开 RPC |
| `mevProtectedRoute({chainId,url,id})` | 构造自定义私有路由；URL 非法直接 `BAD_CONFIG` |
| `assertPlanIntegrity(plan)` | 解码 calldata 自检：selector / outcome / amountIn / **minSharesOut 必须与报价完全一致且 > 0** |
| `confirmQuoteStillValid(plan, req)` | 三道闸：报价年龄（默认 2s）→ 复算下落 > 容忍度 → 旧 minSharesOut 已成交不了；任一命中都在**签名前**抛 `QUOTE_STALE` |
| `signAndSubmitBuy(req, signer)` | 报价 → 自检 → 新鲜度 → 签名 → 私有路由提交，一条龙 |
| `submitProtected(rawTx)` | 路由链提交：私有路由**超时=结果未知**（`SUBMIT_AMBIGUOUS`，禁止自动改投公开池）；明确拒绝才回退下一条 |
| `waitForReceipt(hash)` | 轮询回执，用于化解 `SUBMIT_AMBIGUOUS` 的"到底上没上链" |
| `EthCallTransport.sendRawTransaction? / getTransactionReceipt?` | 可选扩展，零依赖对接 viem/ethers |

新增错误码（全部带中文文案）：`NO_ROUTE`、`ROUTE_UNAVAILABLE`、`SUBMIT_AMBIGUOUS`、`NETWORK_TIMEOUT`、
`QUOTE_STALE`、`BAD_PLAN`、`RECEIPT_TIMEOUT`。

### 2.3 为什么"超时不能自动改投公开池"

私有路由超时时，交易**可能已经被打包者收下**。此时把同一笔 rawTx 再发给公开 RPC：
轻则同 nonce 自我替换、重则两笔都在等打包 —— 而公开池一旦看到，夹子窗口就打开了。
所以实现是：私有路由超时/返回畸形 → `SUBMIT_AMBIGUOUS` + 提示先查回执；只有"明确 JSON-RPC 拒绝"才回退。

### 2.4 新增测试（11 条）

路由表（Base/ETH/未知链）、自定义路由优先级与非法 URL、私有成功不回退、私有超时=AMBIGUOUS 且只提交一次、
私有明确拒绝才回退、无路由 `NO_ROUTE`、calldata 篡改拦截、`signAndSubmitBuy` minSharesOut 与报价逐字一致、
价格腰斩 → `QUOTE_STALE` 且 **signer 零调用 / 提交零次**、报价过期拦截、回执轮询与超时。

---

## 三、合约硬化（Slither 驱动，逐条落地）

| # | 发现 | 严重度 | 处理 |
|---|---|---|---|
| 1 | `PredictionVault.buy` 先外部调用后写状态（`reentrancy-no-eth` / `reentrancy-benign`） | Medium + Low | **重构为严格 CEI**：曲线计算与只读检查 → 状态落盘 + 事件 → 最后才 `transferFrom / 转手续费 / 付份额`。链上行为不变（全部 89 测试通过），但重入面归零 |
| 2 | `addLiquidity` 的 `shares == 0`（`incorrect-equality`） | Medium | 内联 `slither-disable-next-line` + 写明理由：纯早退守卫，比较结果不参与任何状态分支，无可构造获利路径。**未抑制的原始基线保留在 `reports/slither-baseline.json`** |
| 3 | `ProtocolFeeVault.autoDistributeFee` 的 `amount == 0`（`incorrect-equality`） | Medium | 同上处理与理由 |
| 4 | `ProtocolFeeVault.FeeReceived` 声明但从未 emit | Info（dead-code） | 删除死事件；手续费流入改由 ERC20 `Transfer(to=feeVault)` 索引（已在清单附录 A 写明） |
| 5 | `FixedPoint.min` / `mulWouldOverflow` / `WAD` 未使用 | Info（dead-code / unused-state） | 全部删除 |
| 6 | `ProtocolFeeVault` 构造函数重复的零地址检查 | — | 删除重复行 |
| 7 | `block.timestamp` 比较 ×8 | Low | 业务必需（结算时间、7 天退款窗口）。时间粒度是天，验证者能挪动的是秒级，无可利用面；保留并在报告里明确列出 |
| 8 | 复杂度 16/14、变量名相似 ×2 | Info | 保留（buy/sell 的对称分支与局部变量命名，可读性优先） |

### 3.1 顺带补齐的两个单步所有权（Slither 不报，但是真风险）

- `ConditionalToken`（能改 `factory` 绑定）与 `ProtocolFeeVault`（能改 `treasury` 收款地址）此前仍是 OZ 单步 `Ownable`。
  一次 `transferOwnership` 打错地址 = `setFactory` / `setTreasury` 永久失控。本轮改为 **OZ `Ownable2Step`**：
  - `transferOwnership` 只写 `pendingOwner`，必须 `acceptOwnership()` 才生效；
  - `renounceOwnership()` **override 成直接 revert**（`RenounceDisabled`）——否则 owner 归零同样会永久锁死这两个 setter；
  - `transferOwnership(0)` 在子合约层拒绝（OZ 的 `Ownable2Step` 自身不校验零地址）。
- `PredictionVault` / `PredictionFactory` 继续用显式 `admin/pendingAdmin/acceptAdmin`（它们的管理面更大，语义要更直白）。

### 3.2 事件完整性（索引器口径）

| 缺口 | 处理 |
|---|---|
| `PredictionVault.setFeeVault` 改费率流向却无事件 | 新增 `FeeVaultUpdated(old,new)`（两个字段都 indexed）+ 专门测试 |
| `ProtocolFeeVault.FeeReceived` 死事件 | 删除（见上） |
| `AdminAccepted` 命名 | 本实现中 `AdminTransferred` **只在 `acceptAdmin()` 成功时 emit**，即"接受"事件；不另造重复日志。完整事件矩阵见清单附录 A |
| `Paused/Unpaused` | 来自 OZ `Pausable`，`pause()/unpause()/setPaused()` 三条路径都会 emit，无需自造 |

全部事件（合约 × 事件 × indexed 字段 × 触发点 × 索引器用途）已整理成表：`docs/BASE-MAINNET-CHECKLIST.md` 附录 A。

---

## 四、主网预案

- `.env.mainnet.example`：Base 主网专用模板（真实 USDC、三个 Safe 地址、`REQUIRE_SAFE_CONTRACT=true`、Keeper、私有 RPC）。
- `script/Deploy.s.sol` 主网硬化：
  1. `USDC.decimals() == 6` 强制校验（把 WETH 传进来会被拦，已实测）；
  2. `REQUIRE_SAFE_CONTRACT`（8453 默认 true）：`TREASURY` / `MARKET_ADMIN` / `ADMIN_TRANSFER_TO` 必须是合约，EOA 直接 require 失败；
  3. 修正了一处只在主网配置下才暴露的逻辑错误：**盘口 admin 是建盘时的 `MARKET_ADMIN`，不是部署者**，
     所以部署者无权对盘口发起 `transferAdmin`。现在只有 `marketAdmin == deployer` 时才由脚本发起盘口侧移交，
     否则打印"必须由 MARKET_ADMIN 自己发起"的告警；
  4. `safe-only` / `marketAdm` 打进部署日志，便于事后核对。
- `docs/BASE-MAINNET-CHECKLIST.md`：10 项终极核对清单（每项都有命令 + 期望输出 + 通过标准），
  外加"上线前最后一小时"顺序、事件矩阵、已知残余风险、本轮实测数字。

### 4.1 Base 主网 fork 演练（真链状态，非模拟）

`anvil --fork-url https://mainnet.base.org --chain-id 8453`，fork 高度 **53,043,502**，真 USDC（`0x8335…2913`，实测 symbol/decimals）。

| 项 | 实测 |
|---|---|
| 部署 | 4 合约 + 6 参建盘 + 第 1 步移交，`ONCHAIN EXECUTION COMPLETE & SUCCESSFUL`，gas **8,539,550** |
| ConditionalToken | `0x2285405f04ec0d5a09be86043b5d96d6eace3513` |
| ProtocolFeeVault | `0x5678c8802673fa25862d2854f291e1319e4e07d2` |
| PredictionVault impl | `0x64fc4514a2841893e3fdc685f81d5116375d2d24` |
| PredictionFactory | `0xd9da33fb3288b577d1ea35c1ac843b02aa9a6517` |
| 首个盘口 clone | `0x908f047267d0f6c899cd1bad34f9ca384d23d783` |
| EOA 当 TREASURY | revert `mainnet: TREASURY must be a Safe contract`（硬化生效） |
| WETH 当 USDC | revert `USDC decimals must be 6`（硬化生效） |
| 第 1 步后 | `factory.pendingAdmin=Safe`、`factory.admin=部署者`；`vault.admin=Safe`（建盘即 Safe，无特权窗口） |
| 第 2 步（Safe.exec → `acceptAdmin()`） | `factory.admin=Safe`、`pendingAdmin=0` |
| 旧部署者越权 | `setImplementation` / `pause` 双 `OnlyAdmin` |
| ConditionalToken 两步 | `owner` 部署者 → pendingOwner=Safe → Safe `acceptOwnership()` → owner=Safe，pending 归零 |
| `renounceOwnership`（Safe 身份） | `ExecFailed(RenounceDisabled 0x89051165)` |

> 说明：本轮在主网 fork 上用 `src/mocks/RehearsalSafe.sol`（仅演练用的最小 exec 替身，**无门限/无签名校验**）
> 扮演 Safe，用来验证"关键地址必须是合约"与两步移交的真实链路；公网广播仍由真 Safe 执行。

---

## 五、未完成项（照实说）

1. 公网 Base 主网广播需要真实部署私钥 + 三个真 Safe 地址；命令与顺序在清单"最后一小时"段落。
2. 合约验证需要 Etherscan **V2** 多链 key（Basescan V1 已下线，实测返回 deprecated）。
3. 第三方人工审计未做 —— 本轮只有自动化扫描（0 High / 0 Medium），不能替代人工审计。
4. `resolve()` 仍是 `MARKET_ADMIN` 单方裁定（Safe 多签降低单点，不消除误判）；预言机/争议期机制未实现。

---

## 六、复现

```bash
export PATH=/opt/foundry:$PATH && cd ~/prediction-market
forge test                                   # 89/89
(cd sdk && npm test)                         # 46/46
bash script/e2e-local.sh                     # 11/11 ALL GREEN

# 静态扫描（0 High / 0 Medium）
export PATH=/root/.pyenv/versions/3.12.0/bin:$PATH
slither . --solc /root/.local/share/svm/0.8.24/solc-0.8.24 --filter-paths "lib/|test/|script/"

# 主网 fork 演练（0 成本，真链状态）
anvil --fork-url https://mainnet.base.org --port 8547 --chain-id 8453 &
PRIVATE_KEY=<anvil_pk> TREASURY=<safe> MARKET_ADMIN=<safe> ADMIN_TRANSFER_TO=<safe> \
  forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8547 --broadcast
```

机器上 slither 装在 pyenv 3.12（`0.10.0`），需要 `setuptools<81`（`pkg_resources`）；solc 用 foundry 自带的
`/root/.local/share/svm/0.8.24/solc-0.8.24`。
