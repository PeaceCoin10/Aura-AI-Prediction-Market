# Keeper — unattended market watchdog

The keeper never holds resolution authority. Settlement stays with the admin multisig; the keeper only
warns and prepares proposals. It signs transactions itself for permissionless actions only
(`autoDistributeFee`, `emergencyRefund`).

It binds to the legacy architecture — `PredictionFactory` enumerating `PredictionVault` markets — and to
`ProtocolFeeVault` for fee distribution.

## Responsibilities

| Situation | Action |
| --- | --- |
| Market past `resolutionTime` and not resolved | Log an alert, write a Safe-executable `resolve(uint8)` proposal JSON, POST to the webhook |
| Market past `resolutionTime` + 7-day refund window | Escalate to `REFUND_WINDOW_OPEN`; call `emergencyRefund()` when `autoRefund` is enabled |
| `ProtocolFeeVault.pendingFees` ≥ `feeThreshold` | Call `autoDistributeFee()`, moving fees to the treasury |
| Market already resolved | Log one OK line, no repeated alerts |
| Gas price above `maxFeePerGasGwei` | Skip the round and retry next interval instead of overpaying |

## Running

```bash
cd keeper
npm install                       # only dependency: ethers v6
cp config.example.json config.json
# fill rpcUrl / factory / feeVault; prefer injecting the key via env

node keeper.js --config config.json            # long-running
node keeper.js --config config.json --once     # single pass, exits (cron friendly)
node keeper.js --config config.json --dry-run  # read and report, never sign
```

Environment variables take precedence over the config file:

```
KEEPER_RPC_URL / KEEPER_FACTORY / KEEPER_FEE_VAULT / KEEPER_PRIVATE_KEY
KEEPER_FEE_THRESHOLD / KEEPER_AUTO_REFUND / KEEPER_WEBHOOK / KEEPER_INTERVAL_MS
```

Config keys (`config.example.json`): `rpcUrl`, `factory`, `feeVault`, `privateKey`, `intervalMs`
(default 30000), `feeThreshold` (USDC, 6 decimals, default 1 USDC), `autoRefund`, `webhookUrl`,
`proposalDir`, `maxFeePerGasGwei` (default 10). `rpcUrl` and `factory` are required and the addresses
are validated at startup.

## Multisig proposals

One file per overdue market, `proposals/<vault>-RESOLUTION_OVERDUE.json`:

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

`safe / to / value / operation / data` are Safe Transaction Builder fields: signers import the file and
sign, with no hand-assembled calldata and no chance of mistyping the outcome. The JSON layout also keeps
the three outcome options side by side for review.

## Deployment notes

- Run under systemd or pm2, or schedule `--once` from cron every minute (more resilient to crashes).
- Give the key fee distribution and timeout refunds only — never a key with admin rights.
- The webhook accepts any JSON endpoint (DingTalk, Feishu, Slack); failures are logged and never block
  the main loop.
- `maxFeePerGasGwei` defaults to 10, comfortably above normal Base fees; exceeding it means skipping the
  round rather than draining the signer during a fee spike.

## Layout

```
keeper/
├── keeper.js              polling loop, proposal writer, webhook, CLI
├── config.example.json    configuration template
├── package.json           single dependency: ethers v6
└── proposals/             generated Safe proposal JSON (gitignored)
```
