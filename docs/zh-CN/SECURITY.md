# 安全矩阵 · Security Matrix

本文件只写**实际跑出来的结果**，每条都带复现命令。原始数据在 `docs/security/`。

审计日期：2026-10-28 · 合约：`CentralPredictionEngine` / `ProtocolFeeVault`
编译器：solc 0.8.24（`via_ir = true`, optimizer runs 200）· License: MIT

---

## 1. Slither 静态分析

```bash
cd prediction-market
/path/to/slither . --solc /tmp/solc --filter-paths "lib/|test/|script/" --json docs/security/slither-report.json
```

**结果：19 条发现（0 High / 0 Medium / 12 Low / 7 Informational）**

| Impact | 检查项 | 数量 | 位置 |
| --- | --- | --- | --- |
| High | — | **0** | — |
| Medium | — | **0** | — |
| Low | `timestamp` | 12 | `CentralPredictionEngine.sol` |
| Info | `solc-version` | 5 | 各合约 pragma |
| Info | `cyclomatic-complexity` | 2 | `buyShares` / `sellShares` |

### 12 条 `timestamp` 逐条说明

全部集中在时间语义，**没有一条**涉及随机数、拍卖截止或锁仓解锁：

| 行号 | 函数 | 时间用途 | 是否可被矿工利用 |
| --- | --- | --- | --- |
| 305 | `_createMarket` | 校验结算时间在 `now+1h ~ now+365d` | 否（±15s 无意义） |
| 346 | `seedLiquidity` | 建盘后限时注入流动性 | 否 |
| 370 | `buyShares` | 交易截止判断 | 否（截止前 1 分钟都能成交，本来就不该抢跑） |
| 414 | `sellShares` | 同上 | 否 |
| 513 | `resolveMarket` | 到期后才能裁决 | 否 |
| 525 | `emergencyRefund` | 超时 7 天 | 否（7 天窗口，差 15 秒无影响） |
| 533 | `_settle` | 记录 `disputeEndsAt` | 否 |
| 572 | `_isFinal` | 争议期结束判断 | 否 |
| 582 | `overrideResolution` | 争议期内才能改判 | 否 |
| 604 | `finalize` | 争议期结束后终局 | 否 |
| 782 | `tradingOpen` | 只读视图 | 否 |
| 807 | `resolutionState` | 只读视图 | 否 |

结论：预测市场必须用区块时间做截止/争议计时，这是业务语义而非漏洞。
真正需要「不可预测随机」的场景（抽签、彩票）本协议不存在。

### 7 条 Informational

- 5 × `solc-version`：「0.8.24 太新，未被广泛使用」——已知，为配合 Base 主网验证而固定 0.8.24。
- 2 × `cyclomatic-complexity`：`buyShares` / `sellShares` 分支较多（滑点、冲击上限、暂停、结算状态）。
  已用 46 个单元测试 + 10.2 万次不变式调用覆盖，不打算为了降复杂度而拆碎资金路径。

---

## 2. 不变式测试（Fuzzing / Invariant）

```bash
PATH=/opt/foundry:$PATH \
FOUNDRY_INVARIANT_RUNS=512 FOUNDRY_INVARIANT_DEPTH=200 \
forge test --match-path "test/*Invariant*" -vv
```

**结果：102,400 次 handler 调用，0 revert，0 次不变式破坏**

| Handler 选择器 | 调用次数 |
| --- | --- |
| `buy` | 12,825 |
| `sell` | 12,678 |
| `resolve` | 12,831 |
| `redeem` | 12,711 |
| `finalizeMarket` | 12,728 |
| `overrideOutcome` | 13,011 |
| `sweep` | 12,711 |
| `warp` | 12,845 |

覆盖性质：

1. **偿付能力**：`cash >= owed` 恒成立——任何时刻池子都兑得出所有未提现份额。
2. **份额守恒**：买卖不凭空造份额，`yesReserve + noReserve` 与流通份额一致。
3. **争议期锁**：`disputing == true` 时 `redeem` 必须失败。
4. **权限**：非 admin 的 `overrideResolution` / `sweep` 必须失败。
5. **暂停语义**：`paused` 只放行「结算 + 7 天」的强制退款。

---

## 3. 其余测试层

| 层 | 命令 | 结果 |
| --- | --- | --- |
| forge 单元 | `forge test` | 46 passed / 0 failed |
| SDK | `cd sdk && npm test` | 70/70 |
| AI 大脑 | `python3 -m unittest discover hermes` | 49 passed |
| 前端类型 | `cd frontend && npx tsc --noEmit` | 0 error |
| 前端真链 E2E | `python3 frontend/scripts/e2e_local.py` | 11/11（anvil 真 approve+buy，UI YES 114.90 ↔ 链上 `yesOf=77306483`） |
| 前端 UI E2E | `python3 frontend/scripts/e2e_ui.py` | 44/44 |

---

## 4. 经济防线（写死在合约里）

| 常量 | 值 | 作用 |
| --- | --- | --- |
| `TRADE_FEE_BPS` | 150 | 1.5% 交易费，向上取整，全部进 Vault |
| `SETTLE_FEE_BPS` | 50 | 0.5% 结算费 |
| `MAX_IMPACT_BPS_CAP` | 500 | 单笔 ≤ 池深 5%，防一笔打穿 |
| `MIN_BET` / `MAX_BET` | 5 / 10,000 USDC | 防粉尘、防单点操纵 |
| `MIN_SEED` | 10 USDC | 建盘最低做市金 |
| `MIN_TRADING_WINDOW` | 1 小时 | 杜绝「1 分钟后结算」的必赢盘 |
| `DISPUTE_WINDOW` | 1 小时 | 裁决后争议期，期间禁提现 |
| `REFUND_DELAY` | 7 天 | 管理员失联兜底，任何人可强制退款 |

---

## 5. 已知边界（不粉饰）

1. **admin 仍是单签 EOA**（`0x436b…5Ba1`）。合约支持 Safe 接管，但当前部署未迁移——
   这是最大的中心化风险点，路线图里排第一。
2. **Slither ≠ 审计**。静态分析没有发现 High/Medium，不代表没有逻辑漏洞。
3. **Oracle 依赖外部数据源**（CoinGecko / ESPN / LoL Esports）。价格类做了 3×30s 采样，
   但数据源整体宕机时需要人工介入（Safe 可改判）。
4. **新闻/科技类不自动裁决**，靠人工，存在裁决延迟风险。
5. **前端评论存 localStorage**，不是共识数据，可被本地篡改——UI 已注明。

---

## 6. 复现全部证据

```bash
# 1. 静态分析
slither . --json docs/security/slither-report.json

# 2. 不变式（10 万次调用）
FOUNDRY_INVARIANT_RUNS=512 FOUNDRY_INVARIANT_DEPTH=200 forge test --match-path "test/*Invariant*" -vv

# 3. 单元 + SDK + 大脑 + 前端
forge test
(cd sdk && npm test)
python3 -m unittest discover hermes
(cd frontend && npx tsc --noEmit && python3 scripts/e2e_ui.py)

# 4. 链上验证状态（Basescan V2 API）
bash deploy/verify-basescan.sh --check
```
