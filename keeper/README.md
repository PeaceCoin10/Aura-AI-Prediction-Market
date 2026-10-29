# Keeper — 无人值守守护机器人

零权限越界设计：**结算权永远在 admin 多签手里，keeper 只负责提醒 + 生成提案**；
只有 permissionless 的动作（`autoDistributeFee`、`emergencyRefund`）才由 keeper 自己签名发送。

## 职责

| 场景 | 行为 |
|---|---|
| 盘口过了 `resolutionTime` 仍未结算 | 打印告警 + 写出 Safe 多签可直接执行的 `resolve(uint8)` 提案 JSON + 推送 webhook |
| 盘口过了 `resolutionTime + 7d` 退款窗口 | 升级为 `REFUND_WINDOW_OPEN` 告警；若开启 `autoRefund` 则自动调 `emergencyRefund()` |
| `ProtocolFeeVault.pendingFees` ≥ 阈值 | 自动调用 `autoDistributeFee()`，手续费打进 treasury |
| 已结算盘口 | 记录一行 OK，不再重复告警 |
| Gas 超过上限 | 跳过本轮（不会被打爆），下一轮再试 |

## 运行

```bash
cd keeper
npm install                      # 只依赖 ethers v6
cp config.example.json config.json
# 填 rpcUrl / factory / feeVault；私钥建议用环境变量注入

# 单轮（cron 友好）
node keeper.js --config config.json --once

# 常驻
node keeper.js --config config.json

# 只看不写
node keeper.js --config config.json --dry-run
```

环境变量优先于配置文件：

```
KEEPER_RPC_URL / KEEPER_FACTORY / KEEPER_FEE_VAULT / KEEPER_PRIVATE_KEY
KEEPER_FEE_THRESHOLD / KEEPER_AUTO_REFUND / KEEPER_WEBHOOK / KEEPER_INTERVAL_MS
```

## 产出的多签提案

每个过期盘口生成 `proposals/<vault>-RESOLUTION_OVERDUE.json`：

```json
{
  "type": "RESOLUTION_OVERDUE",
  "vault": "0x...",
  "adminMultisig": "0x...",
  "overdue": "1h 0m",
  "proposals": [
    { "safe": "0x...", "to": "0x...", "value": "0", "operation": 0,
      "data": "0xa0270dbc...0000", "description": "Resolve 0x... as NO" },
    { "data": "0xa0270dbc...0001", "description": "... as YES" },
    { "data": "0xa0270dbc...0002", "description": "... as INVALID" }
  ]
}
```

`to / value / operation / data` 就是 Safe Transaction Builder 的字段，多签成员导入即可签名，
不需要手工拼 calldata，也不会因为手滑把 outcome 填错。

## 部署建议

- 用 systemd / pm2 常驻，`--once` + crontab 每分钟也是合理选择（更抗崩溃）
- 私钥只给「手续费分发 + 超时退款」用，**绝不给 admin 权限的私钥**
- webhook 可接钉钉/飞书/Slack，失败只记日志不阻塞主循环
- `maxFeePerGasGwei` 默认 10，Base 上正常远低于此；超过就跳过，避免高费时被抽干
