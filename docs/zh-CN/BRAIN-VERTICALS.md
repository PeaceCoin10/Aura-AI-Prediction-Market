# Hermes 大脑 · 多板块出题引擎

代码：`hermes/verticals.py`（数据源 + 解析 + 出题 + 校验）、`hermes/hermes_brain.py`（建盘 / 裁决接入）。
测试：`cd hermes && python3 -m unittest -v test_verticals.py test_brain.py`（49 条离线，不碰网络不碰链）。

## 1. 四个板块，各自的真实数据源

| 板块 | 数据源（全部免 key、公开） | 出题示例 | 判定方式 |
|---|---|---|---|
| **crypto 加密/金融** | CoinGecko（主）+ Binance（备）现货价 | `BTC（比特币）能否在 24 小时内突破 $81,500？现价 $80,431.76` | **自动**：结算时刻收盘价 vs 阈值 |
| **news 新闻/地缘** | Cointelegraph / The Block / Decrypt / BBC World RSS | `「USDC overtakes USDT in euro stablecoin…」是否会在 24 小时内获得官方正式回应？` | **人工**（Oracle/Safe）：RSS 无法客观断定"官方是否回应" |
| **tech 科技** | BBC Tech / TechCrunch RSS | 同上模板，`category=tech` | **人工** |
| **sports 体育** | ESPN 公开记分牌：NBA / NFL / 英超 / 欧冠 / 美职联 | `Boston Celtics 能否在 10-28 07:30 的 NBA 比赛中击败 Brooklyn Nets？` | **自动**：ESPN 最终比分（含加时） |
| **esports 电竞** | LoL Esports 公开赛程（Worlds 等） | `Movistar KOI 能否在 10-29 04:00 的 Worlds 比赛中击败 T1？` | **自动**：官方 gameWins |

取不到数据就跳过（`vertical X: 本轮没有合格新题`），**绝不编造标题或比分**。

## 2. 每道题必须过的硬校验 `validate_binary_question()`

建盘前逐条检查，不合格直接丢弃并记日志：

1. 必须是问句（以 `？` 结尾）；
2. 必须含二元连接词（`能否 / 是否会 / 会不会 / 是否`）；
3. 禁止出现会破坏二元性的词（`还是 / 或者 / 概率 / 多少 / 涨跌幅 / 几个 / 何时 / 哪一个 / 排名第几`）；
4. 题面长度 8–280 字节；
5. 判定标准 ≥ 12 字符，且必须写明数据源与判定动作；
6. 结算时间必须在 30 分钟 ~ 8 天之间。

## 3. 判定责任划分（不越权）

| 类型 | 谁判 | 说明 |
|---|---|---|
| `verification = auto` 且 `payload.kind = price` | 大脑自动 | 3 次采样 × 30 秒，三次同向才 `resolveMarket`，防插针 |
| `verification = auto` 且 `payload.kind = espn` | 大脑自动 | 读 ESPN `summary` 的 `status=post` 与最终比分；未结束 / 拿不到比分 → `skip` 等下一轮 |
| `verification = auto` 且 `payload.kind = lolesports` | 大脑自动 | 读官方 `gameWins`；未出结果 → `skip` |
| `verification = manual`（news / tech） | **不自动判** | 大脑明确返回 `keep`：`manual settlement (news/geopolitics) — 等 Oracle/Safe 人工裁决`，不会瞎猜 |

## 4. 轮转与预算

- `--verticals crypto,news,sports,esports`（默认全开），`--create-per-cycle N`（默认 3）。
- 每轮按 `state.last_cycle // 600` 滚动起点做 round-robin，且**每个板块先保底 1 条**，避免 crypto 把预算吃光。
- 做市资金不够时按 `余额 // seed` 自动降档；一个都做不了时打 `[plan-only]` 日志，让人看到"本来会开什么题"。

## 5. 实跑证据（主网只读 dry-run）

```
[crypto  ] BTC（比特币）能否在 24 小时内突破 $81,500？现价 $80,424.98
[news    ] 「Truce begins in Ukraine city where…」是否会在 24 小时内获得官方正式回应？
[sports  ] Boston Celtics 能否在 10-28 07:30 的 NBA 比赛中击败 Brooklyn Nets？
[esports ] Movistar KOI 能否在 10-29 04:00 的 Worlds 比赛中击败 T1？
total: 4 | 板块覆盖: ['crypto', 'esports', 'news', 'sports']
```

常驻进程日志（主网，钱包 USDC=0 时的 plan-only）：

```
ERROR hermes | insufficient USDC for seeding: have 0.00, need 100.00 — skip creating
INFO  hermes | [plan-only] [crypto/crypto] BTC（比特币）能否在 24 小时内突破 $81,500？现价 $80,431.76 (判定 auto)
INFO  hermes | [plan-only] [news/news] 「USDC overtakes USDT in euro stablecoin…」… (判定 manual)
INFO  hermes | [plan-only] [sports/sports] Boston Celtics 能否在 10-28 07:30 的 NBA 比赛中击败 Brooklyn Nets？ (判定 auto)
INFO  hermes | [plan-only] [esports/esports] Movistar KOI 能否在 10-29 04:00 的 Worlds 比赛中击败 T1？ (判定 auto)
```

> 往 `0x436b…5Ba1` 打 ≥100 USDC，下一轮就会真的建盘 + 做市（每盘 100 USDC 做市金）。
