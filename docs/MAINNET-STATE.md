# Live mainnet state

Snapshot taken 2026-11-10 by reading Base mainnet directly (chainId 8453, USDC
`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`).

## Contracts

| Contract | Address | State |
| --- | --- | --- |
| `CentralPredictionEngine` | `0xE6056Bc6700F6d7E6fF8779B212655284dc1631C` | live, 13196 bytes, verified (Etherscan V2 exact match) |
| `ProtocolFeeVault` | `0x29dE563f3059827D00837305FAE2Bbc87c7D9eE1` | live, `pendingFees()` = 0 |
| `ReferralLedger` | `0x2EbF3B69870979F863B8900f03CE8AcfE58E8954` | live, `rebateBps` = 2000, `poolBalance()` = 0 |

Engine wiring, read back from the contract:
`admin()` = `0x436b9d5e6fBd40eC93E881263bE53e59F8755Ba1`,
`treasury()` = same, `feeVault()` = `0x29dE…9eE1`,
`collateral()` = USDC, `creators(operator)` = **true** (granted 2026-11-10).

## Markets

`marketCount()` = 3. All created 2026-11-10 by the admin EOA.

| # | Market id | Question | Category | Resolution (UTC) | Depth |
| --- | --- | --- | --- | --- | --- |
| 1 | `0xce0b1c56de5d0832f491c97f5bf12f54030f7bfc65affe022cb3dccf94446c88` | Will BTC close above $150,000 on 2026-12-31 UTC? | crypto | 2026-12-31 | 0 |
| 2 | `0xd12787b6559491e0689145425b66a35861f1b841133b6552e02fed890f7d49f1` | Will ETH close above $6,000 on 2026-12-31 UTC? | crypto | 2026-12-31 | 0 |
| 3 | `0x25ea6574bd7bc2c7652da8d7701c79ad2317bfeacc35d6bb29b8e3bc14b32732` | Will Base mainnet TVL exceed $10B by 2027-01-31 UTC? | crypto | 2027-01-31 | 0 |

`tradingOpen()` is `true` for all three. `priceYes()` reads 0 because the CPMM
reserves are zero.

## Blocking gap

`buyShares` enforces
`amountIn <= (yesReserve + noReserve) * MAX_IMPACT_BPS_CAP / BPS_DENOMINATOR`.
With zero reserves the right side is 0, so **every** buy reverts `ImpactTooHigh` —
the markets exist but cannot be traded until they are seeded.

`seedLiquidity` needs `MIN_SEED` = 10 USDC **per market**, 30 USDC for all three.
Treasury EOA `0x436b…5Ba1` holds 604,932 USDC-wei (0.604932 USDC) and
178,156,095,611,206 wei of ETH — roughly 0.6 USDC short of a single seed by 9.4 USDC.

Operator EOA `0xaaA5…7C80` holds 0 ETH; it must be funded before it can send its
own attribution transactions (`hermes/indexer.py --live`).

## Reproduce

```bash
export PATH=/opt/foundry:$PATH
unset http_proxy https_proxy all_proxy
R=https://mainnet.base.org
cast call 0xE6056Bc6700F6d7E6fF8779B212655284dc1631C "marketCount()(uint256)" --rpc-url $R
cast call 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  "balanceOf(address)(uint256)" 0x436b9d5e6fBd40eC93E881263bE53e59F8755Ba1 --rpc-url $R
```
