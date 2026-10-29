# CentralPredictionEngine — contract reference

One contract, many markets. Each market is a YES/NO constant-product pool quoted in USDC; the
protocol takes a fee on every fill and on winning redemptions, and settlement goes through a
one-hour dispute window so a wrong oracle call is recoverable before payouts.

## Constants

| Name | Value | Meaning |
| --- | --- | --- |
| `TRADE_FEE_BPS` | `150` | 1.5% on every buy and sell, forwarded to the fee vault |
| `SETTLE_FEE_BPS` | `50` | 0.5% on the winning payout at redemption |
| `MIN_BET` / `MAX_BET` | `5e6` / `10_000e6` | 5 … 10,000 USDC per trade |
| `MAX_IMPACT_BPS_CAP` | `500` | a single trade may move the pool by at most 5% |
| `MIN_SEED` | `10e6` | minimum market-making seed (10 USDC) |
| `MIN_TRADING_WINDOW` / `MAX_TRADING_WINDOW` | `1 hours` / `365 days` | allowed resolution offsets at creation |
| `DISPUTE_WINDOW` | `1 hours` | admin override window after the oracle rules |
| `REFUND_DELAY` | `7 days` | emergency refund becomes callable this long after the resolution time |
| `OUTCOME_NO` / `OUTCOME_YES` / `OUTCOME_INVALID` | `0` / `1` / `2` | INVALID pays 0.5 USDC per share on both sides |

## Roles

- `admin` — pause, fee vault, treasury, creator/oracle grants, `overrideResolution`, `sweepResidual`,
  and two-step `transferAdmin` → `acceptAdmin`.
- `creators[addr]` — `createMarket`, `createMarketWithMeta`, `seedLiquidity`.
- `oracles[addr]` — `resolveMarket`.

The admin also passes every role check (`msg.sender != admin && !creators[...]`), which the SDK
mirrors in `canCreate` / `canOracle`.

## Trading

```
buyShares(marketId, outcome, amountIn, minSharesOut)   -> sharesOut
sellShares(marketId, outcome, sharesIn, minAmountOut) -> amountOut
```

Both revert on: paused protocol, unknown market, resolved market, closed trading window, bet
outside `[MIN_BET, MAX_BET]`, price impact above `MAX_IMPACT_BPS_CAP`, or slippage against the
caller's bound. The fee is taken from the gross amount, the remainder moves the pool, and the
resulting share count is what the caller receives.

`previewBuy` / `previewSell` expose the same maths read-only, so a client can quote first and
compare later instead of trusting its own copy.

## Settlement

```
resolveMarket(marketId, outcome)      onlyOracle, after resolutionTime, once
overrideResolution(marketId, newOutcome)  onlyAdmin, inside DISPUTE_WINDOW
finalize(marketId)                    anyone, after the window closes
redeem(marketId)                      holders, after finalize (or after the refund delay)
emergencyRefund(marketId)             anyone, resolutionTime + REFUND_DELAY, unresolved
sweepResidual(marketId)               onlyAdmin, dust left after payouts
```

`INVALID` splits the pool evenly: every YES and NO share is worth 0.5 USDC. `redeem` charges
`SETTLE_FEE_BPS` on the winning payout only; the dispute window blocks redemption so an override
cannot be front-run by claimers.

## Events

`MarketCreated`, `MarketCategoryUpdated`, `LiquiditySeeded`, `SharesBought`, `SharesSold`,
`MarketResolved`, `DisputeWindowOpened`, `ResolutionOverridden`, `MarketFinalized`, `Redeemed`,
`ResidualSwept`, `EmergencyRefund`, `Paused`, `Unpaused`, `FeeVaultUpdated`, `TreasuryUpdated`,
`CreatorUpdated`, `OracleUpdated`, `AdminTransferStarted` (19 total, all decoded by the SDK).

## Invariants the test suite checks

- Pool reserves can never be drained by a sequence of buys/sells: the invariant handler runs
  randomised trade/seed/resolve sequences and asserts `yesReserve + noReserve` and the fee
  accounting stay consistent.
- A fill is monotone in size: bigger size, worse price, never the reverse.
- Redeeming everything never pays more than the pool held plus collected fees.
- Settlement is idempotent: a second `resolveMarket` reverts, `finalize` is a no-op after the first.

## Tests

```bash
forge test                                             # 62 tests
FOUNDRY_INVARIANT_RUNS=512 FOUNDRY_INVARIANT_DEPTH=200 \
  forge test --match-path 'test/*Invariant*' -vv       # stress run
```

## Related

- `src/ReferralLedger.sol` — affiliate accrual/payout. It is deliberately **outside** the trading
  path: the referrer is carried in order calldata metadata and credited by an operator, so a bug in
  rebate accounting can never block or re-price a trade.
- `docs/CENTRAL-SDK-GUIDE.md` — the TypeScript client.
