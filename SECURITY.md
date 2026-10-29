# Security policy

Aura is a live, unaudited protocol. Treat every finding as material.

## Reporting

- **Do not open a public issue** for anything that could move funds, block settlement, or leak keys.
- Use GitHub's private vulnerability reporting (Security → Report a vulnerability) on this repository.
- Include: affected contract or file, a minimal reproduction (forge test or script), expected vs actual
  behaviour, and the impact in USDC terms if you can bound it.

We aim to acknowledge within 48 hours and to ship a fix or a documented mitigation for critical issues
within 7 days. Please give us that window before publishing.

## Scope

| In scope | Out of scope |
| --- | --- |
| `src/CentralPredictionEngine.sol`, `src/ProtocolFeeVault.sol`, `src/libraries/*` | Frontend styling, copy, i18n wording |
| Deployed addresses on Base mainnet (see README) | Third-party infrastructure (Base, USDC, RPC providers) |
| `sdk/CentralPredictionSDK.ts` (quote/ABI correctness) | The demo/featured markets, which are explicitly off-chain samples |
| `hermes/` (oracle decisions, market drafting) | Paper-trading balances, which are `localStorage` only |

## Design invariants we care about

1. Sum of reserves can only change through trades, seeding, settlement or refund.
2. A market cannot be resolved twice; resolution is final after the 1-hour dispute window.
3. Withdrawals are impossible during the dispute window.
4. After 7 days unsettled, `emergencyRefund` must return full principal to holders, permissionlessly.
5. Fees never leave the engine except to `ProtocolFeeVault`, and the vault never pays out without a Safe signature.

## Known limitations (not vulnerabilities)

- `admin` is a single EOA today; moving it to a Safe is on the roadmap.
- Price-market resolution samples the oracle 3×30s apart — a sustained, multi-block manipulation of the
  underlying feed is out of scope of that defence and is handled socially (dispute window + override).
- Slither reports 12 `block.timestamp` findings; timestamps are used for deadlines and dispute windows only.
