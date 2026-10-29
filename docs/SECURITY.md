# Security model

Aura holds user funds on Base mainnet. This page states what the code enforces, what the operator can do,
and what has been tested — no more.

## 1. Privileged roles

| Role | Who | Powers | Mitigation |
| --- | --- | --- | --- |
| `admin` | single EOA today (`0x436b…5Ba1`) | `setCreator`, `setOracle`, resolve/override during the dispute window, vault withdrawal | withdrawals require a Safe signature; moving `admin` to a multisig is on the roadmap |
| `creator` | agent wallet (`0x436b…5Ba1`) | create markets, seed liquidity | cannot resolve, cannot move user funds |
| `oracle` | agent wallet | submit resolution, 3×30 s sampling for price markets | can be overridden by `admin` inside the dispute window |
| `treasury` | same EOA at deploy | receives vault fees via Safe-gated withdrawal | fee destination is immutable in the vault |

The engine has no upgrade path, no proxy and no admin transfer function for `treasury` — the deploy
script therefore insists on setting it correctly on day one (see `script/DeployCentral.s.sol`).

## 2. What the contracts enforce

1. `Y · N` moves only through `buyShares`, `sellShares`, `seedLiquidity`, settlement and refund.
2. One 1.5% trade fee, taken from notional and sent to `ProtocolFeeVault`; one 0.5% settlement fee, taken
   from the losing side.
3. A single order cannot move the price more than **5%** (`MAX_IMPACT_BPS = 500`); the SDK warns at 400 bps.
4. A market cannot be resolved twice. After resolution there is a **1-hour** dispute window during which
   withdrawals are closed.
5. If a market is still unresolved **7 days** past its settlement time, anyone may call
   `emergencyRefund` and every holder is made whole.
6. Payouts are computed from the recorded reserves, never from a caller-supplied amount.

## 3. Oracle policy per vertical

| Vertical | Source | Resolution |
| --- | --- | --- |
| Crypto | CoinGecko / Binance | sampled 3× at 30 s intervals, median of the samples decides; wick-resistant |
| Sports | ESPN scoreboard | official final score only; postponement or cancellation → `INVALID` + full refund |
| Esports | LoL Esports / HLTV / VCT | official series result only; forfeits follow the tournament ruling |
| News | RSS (Cointelegraph, The Block, Decrypt, BBC) | **never auto-resolved** — routed to a human Safe decision |

## 4. Tested, with numbers

| Layer | Result |
| --- | --- |
| Slither 0.10.0 | **0 High, 0 Medium**; 12 Low (`block.timestamp`, used only for deadlines and the dispute window), 7 Informational |
| Invariant campaign | 512 runs × depth 200 = **102,400 handler calls**, 0 reverts, 0 invariant breaks |
| forge unit + integration | **46 passed** |
| SDK offline suite | **70 passed** |
| Agent unit tests | **49 passed** |
| UI e2e | **63 passed** (first-run funnel, hall, ticks, paper fill, debate wall, overlays, mode switch, mobile) |
| Real-chain e2e | **12 passed** against anvil (connect → quote → buy → position → event feed) |

Raw Slither output: [`security/slither-report.json`](security/slither-report.json).

**No third-party audit has been performed.** Static analysis and invariant tests reduce risk; they do not
eliminate it. Treat every market as a bet you can lose entirely.

## 5. Known limitations

- `admin` is a single EOA. It can override a resolution inside the dispute window; users' only protection
  is the 7-day `emergencyRefund` and the public, verified source.
- Price markets sample the feed three times; a manipulation sustained across all three windows is out of
  scope of that defence and is handled socially (dispute window + override).
- The debate wall and paper balances live in `localStorage`; they are presentation, not settlement.
- The front end trusts its configured RPC for reads. A malicious RPC can lie about reserves to a reader,
  but cannot move funds — every write is signed by the user and executed by the contract.

## 6. Reporting

See [`../SECURITY.md`](../SECURITY.md): private GitHub advisory, 48-hour acknowledgement, 7-day fix target
for critical issues.
