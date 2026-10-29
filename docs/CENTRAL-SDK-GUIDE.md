# CentralPredictionSDK — API guide

A dependency-free TypeScript client for `CentralPredictionEngine`. It encodes every call by hand,
runs a local preflight before anything is signed, and only depends on the caller supplying one
function:

```ts
const sdk = new CentralPredictionSDK(
  { ethCall: (to, data) => publicClient.call({ to, data }).then((r) => r.data!) },
  { engine: "0xE605…631C", chainId: 8453, account: "0x…" },
);
```

That is the whole integration surface — viem, ethers, wagmi or a bare node all work.

## Design rules

1. **No naked calldata.** Every `build*` method preflights on-chain state and throws a typed
   `SdkError` locally instead of burning gas on a revert.
2. **No unprotected orders.** `minSharesOut` / `minAmountOut` may not be `0`, may not exceed the
   quote, and may not be looser than `quote × (1 − 5%)`. A slippage preset (`1…500` bps) is the
   supported path; the guard exists because "0" is what naive front-ends send.
3. **Offline pricing is exact.** `previewBuyOffline` / `previewSellOffline` mirror the contract's
   CPMM maths, so a UI can quote before the RPC answers and reconcile afterwards.

## Reads

| Method | Returns |
| --- | --- |
| `marketCount()` | number of markets |
| `marketId(index)` | market id at a 0-based index |
| `marketQuestion(id)` / `marketCategory(id)` | strings, kept out of the struct to keep lists cheap |
| `marketCore(id)` | reserves, creator, resolution time, resolved flag, outcome |
| `priceYes(id)` | YES probability at `1e18` |
| `priceNo(id)` | `1e18 − priceYes` |
| `depthOf(id)` | `yesReserve + noReserve` |
| `tradingOpen(id)` / `isFinal(id)` | trade/settlement gates |
| `sharesOf(id, who)` | `{ yes, no }` positions |
| `resolutionState(id)` | outcome, dispute-window end, override count |
| `paused()` / `admin()` / `constants()` | protocol gates and live constants |
| `marketSnapshots(ids, opts)` | N markets × 4 views in **one** `eth_call` via Multicall3 (`0xcA11bde0…CA11`), with automatic per-market fallback |
| `previewBuy(id, outcome, amountIn)` / `previewSell(id, outcome, sharesIn)` | on-chain quote |

## Writes (all return a `TxPlan`)

| Method | Preflight |
| --- | --- |
| `buildCreateMarket({ marketId, question, category?, resolutionTime })` | 8–280 byte question, 1–32 byte category, resolution between +1h and +365d, id unused, creator role |
| `buildBuyShares({ marketId, outcome, amountIn, slippageBps \| minSharesOut })` | min/max bet, price impact ≤ 5% (warns at 4%), local quote must equal the chain quote |
| `buildSellShares({ marketId, outcome, sharesIn, slippageBps \| minAmountOut })` | position size, impact cap, quote parity |
| `buildRedeem({ marketId })` | resolved, dispute window closed, position non-zero |
| `buildResolveMarket({ marketId, outcome })` | oracle role, resolution time reached |
| `buildOverrideResolution({ marketId, newOutcome })` | admin role, inside dispute window, outcome differs |

`TxPlan` carries `to`, `data`, `value: "0x0"`, `method`, an English `summary` safe to show in a
confirmation dialog, a `meta` snapshot for the audit trail, and an optional `warning`
(`impact_near_limit`). Hand it straight to any wallet:

```ts
const plan = await sdk.buildBuyShares({ marketId, outcome: OUTCOME_YES, amountIn, slippageBps: SLIPPAGE_NORMAL });
if (plan.warning === "impact_near_limit") await askTheUserToConfirm();
await sdk.confirmQuoteStillValid(plan);        // re-reads the quote, aborts if it moved
const hash = await wallet.sendTransaction({ to: plan.to, data: plan.data });
```

## Errors

`SdkError` has a two-layer code and an English message:

- `local/*` — caught before signing (no gas spent): `local/MIN_OUT_REQUIRED`,
  `local/SLIPPAGE_TOO_LOOSE`, `local/QUOTE_MISMATCH`, `local/MARKET_RESOLVED`, `local/NOT_ORACLE`, …
- `chain/*` — a real revert, decoded from the 4-byte selector: `chain/BELOW_MIN_BET`,
  `chain/IMPACT_TOO_HIGH`, `chain/DISPUTE_WINDOW_OPEN`, `chain/SLIPPAGE_EXCEEDED`, …

`decodeRevert(err)` turns anything a wallet or RPC throws into an `SdkError`, including
`Error(string)` and `Panic(uint256)`.

## Events

`decodeLogs(logs)` / `decodeReceiptLogs(logs)` decode the engine's 19 events, skip foreign logs
(USDC `Transfer` etc.) instead of throwing, and expose `eventTopic(name)` / `eventNameOf(topic0)`
for filtering. Every topic0 in the table is recomputed from `cast keccak` in the test suite.

## Slippage presets

| Constant | bps | Use |
| --- | --- | --- |
| `SLIPPAGE_CONSERVATIVE` | 50 | large size or thin pool: prefer a failed trade to a sandwich |
| `SLIPPAGE_NORMAL` | 100 | default |
| `SLIPPAGE_DEGEN` | 300 | racing a hot market |

Hard bounds: `MIN_SLIPPAGE_BPS = 1`, `MAX_SLIPPAGE_BPS = 500`.

## Tests

```bash
cd sdk && npm test     # 116 assertions across the legacy vault SDK and the central engine SDK
```

The suite checks the hand-written encoders byte-for-byte against `cast calldata`, the selectors
against `cast sig`, and the event topics against `cast keccak` — no value in this SDK is copied from
the compiler output by hand.
