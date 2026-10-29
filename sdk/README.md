# SDK — safe transaction builders for the Aura prediction markets

Two SDKs live here, bound to two generations of contracts. They are not interchangeable.

| File | Contract binding | Status |
| --- | --- | --- |
| `CentralPredictionSDK.ts` | `CentralPredictionEngine` (one contract, many markets) | Current. This is what the dApp uses. |
| `PredictionSDK.ts` | `PredictionFactory` + one `PredictionVault` per market | Archived contracts, kept as historical regression plus the MEV submission layer |

New integrations should use `CentralPredictionSDK`. The vault/factory selectors in `PredictionSDK`
must not be pointed at `CentralPredictionEngine`. What is still reusable from it is the
contract-agnostic layer: submission routes, `submitProtected`, `assertPlanIntegrity`,
`confirmQuoteStillValid`, `waitForReceipt`.

## CentralPredictionSDK

```bash
npm install
npm run build
npm test               # both suites: 70 current-engine + 46 legacy
npm run test:central   # current-engine suite only
```

```ts
import { CentralPredictionSDK, parseUsdc, OUTCOME_YES } from "./CentralPredictionSDK";

const sdk = new CentralPredictionSDK(
  {
    ethCall: (to, data) => provider.call({ to, data }),
    now: async () => BigInt(await latestBlockTs()),
  },
  { engine: ENGINE, chainId: 8453, account: user },
);

const plan = await sdk.buildBuyShares({
  marketId,
  outcome: OUTCOME_YES,
  amountIn: parseUsdc("100"),
  slippageBps: 100,
});
await sdk.confirmQuoteStillValid(plan); // re-check the quote before sending
await signer.sendTransaction({ to: plan.to, data: plan.data });
```

Builders: `buildCreateMarket`, `buildBuyShares`, `buildSellShares`, `buildRedeem`,
`buildResolveMarket`, `buildOverrideResolution`. Read views: `marketCore`, `resolutionState`,
`sharesOf`, `previewBuy`, `previewSell`, `constants`, `canCreate`, `canOracle`.

Also included:

- **Event decoding** — 19 engine events, `decodeLog`, `decodeLogs`, `decodeReceiptLogs`.
- **Multicall batching** — `marketSnapshots(ids)`, one RPC round-trip for N markets, with automatic
  per-market fallback if the aggregate call fails.
- **Slippage presets** — `SLIPPAGE_CONSERVATIVE` (50 bps), `SLIPPAGE_NORMAL` (100), `SLIPPAGE_DEGEN` (300).
- **Impact guard** — plans carry `warning: "impact_near_limit"` at 400 bps of the 500 bps cap.
- **Offline maths** — `previewBuyOffline`, `previewSellOffline`, `priceYesOffline` reproduce the CPMM
  formula locally and are checked against the on-chain views.

Three invariants the library enforces:

1. There is no "pass `minSharesOut` directly" entry point. Zero is rejected, above-quote is rejected,
   and anything below 95% of the quote is rejected.
2. `previewBuyOffline` must equal the on-chain `previewBuy` exactly; a mismatch aborts the build, which
   catches ABI drift instead of silently quoting the wrong price.
3. Zero runtime dependencies: one `ethCall` transport is enough. Calldata is hand-encoded and the test
   suite compares it byte-for-byte with `cast`.

Live-chain check (every SDK-built transaction is really broadcast on anvil):

```bash
cd .. && bash script/e2e-sdk-central.sh
```

Integration reference: [`../docs/CENTRAL-SDK-GUIDE.md`](../docs/CENTRAL-SDK-GUIDE.md) — ABI tables,
error codes, frontend state machine, pitfalls.

## PredictionSDK (legacy, archived contracts)

Its single goal: make it impossible for a frontend to send `minSharesOut = 0`.

Design constraints:

1. No interface accepts `minSharesOut`. The only entry point is
   `buildBuy({ amountIn, slippageBps })`; the minimum is computed from `previewBuy()` internally.
2. `slippageBps` must be within `[1, 500]`; `0` throws `SLIPPAGE_NOT_SET`.
3. A preflight runs before a plan is returned: minimum bet, impact cap, resolved state, paused state,
   zero shares. Problems surface locally, before the user pays gas.
4. Zero dependencies — supply `ethCall(to, data)` and adapt viem, ethers or wagmi as needed.

```ts
import { PredictionSDK, ethersTransport, SdkError } from "@prediction/sdk";

const sdk = new PredictionSDK(ethersTransport(provider), { vault: VAULT_ADDRESS });
const plan = await sdk.buildBuy({ outcome: 1, amountIn: 100_000_000n, slippageBps: 100 });

plan.quote.expectedSharesOut; // theoretical shares
plan.quote.minSharesOut;      // enforced floor
plan.quote.priceImpactBps;    // impact in bps
await signer.sendTransaction(plan); // { to, data, value }
```

API: `getMarketState()` (14 on-chain fields), `previewBuy(outcome, amountIn)`,
`calculateMinSharesOut(outcome, amountIn, slippageBps)`,
`buildBuy({ outcome, amountIn, slippageBps })`, `buildSell({ outcome, sharesIn, slippageBps })`.

Sells repeat the contract's reserve maths locally (`newNo = ceil(noReserve * yesReserve / newYes)`)
because the legacy vault has no `previewSell` view: without it, a naive `price × shares` floor would be
trivially pushed through. Fees (1.5%) and slippage are applied on top, yielding `minAmountOut`.

Historical end-to-end run (`npm run test:e2e`) deploys the legacy vault/factory on anvil and asserts
that the SDK quote equals the realised fill, that quote + 1 wei is rejected by the contract, and that
`SLIPPAGE_NOT_SET` / oversized trades are blocked before broadcasting. The archived legacy contracts and
their scripts are not part of this repository tree.

## Layout

```
sdk/
├── CentralPredictionSDK.ts        current engine SDK (types, encoders, builders, multicall, events)
├── CentralPredictionSDK.test.ts   current-engine suite
├── PredictionSDK.ts               legacy vault/factory SDK, archived contract bindings
├── PredictionSDK.test.ts          legacy regression suite
├── e2e.ts / e2e-central.ts        anvil end-to-end drivers
├── tsconfig.json                  emits dist/ (gitignored)
└── package.json                   build + test scripts
```
