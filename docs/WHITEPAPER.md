# Aura Protocol — Architecture, Market Model and Security Whitepaper

**Version 1.2 · Base mainnet (chain 8453) · November 2026**

---

## Abstract

Aura is a binary prediction market protocol and trading terminal. Markets are drafted by an
automated research agent from public data feeds, priced by a constant-product market maker
(CPMM) held entirely inside one contract, and settled against a written rule with a one-hour
dispute window. The terminal is a static client: no account, no backend session, no custody of
user keys.

The protocol is deliberately narrow. It does not do leverage, does not do scalar outcomes, does
not hold user funds outside a position, and has no upgrade path. Every number in this document is
reproducible from this repository: the contract source, the invariant harness, the raw Slither
output and the test suite are all in-tree.

Two claims are made and defended below: **the pricing engine is path-consistent and fee-safe**,
and **the deployed bytecode has no High or Medium static-analysis findings and survived 100,000
randomised invariant calls without breaking a single property**.

---

## 1. Design goals and non-goals

**Goals**

1. A question, a price and a settlement date that any competent third party can verify.
2. One pricing formula shared by the quote, the paper simulator and the on-chain fill, so the
   number a trader sees is the number a trader gets.
3. Fee revenue accounted for at fill time, never minted, never socialised into the pool.
4. A failure mode for every external dependency: dead feed, dead oracle, dead RPC, wrong ruling.
5. A client that reads honestly — paper fills are labelled paper, external prints are attributed
   to the venue that printed them.

**Non-goals (v1)**

- Permissionless market creation. Creation is gated by `CREATOR_ROLE`; the brain drafts, an
  operator signs. Opening this up requires a creation bond and a resolution-arbitration market.
- Cross-chain settlement, leveraged positions, options.
- Decentralised governance. Admin and treasury are an EOA today; §8.4 discloses exactly what that
  means instead of hiding it.

---

## 2. System topology

```
                      ┌──────────────────────── public data plane ────────────────────────┐
   CoinGecko ─┐       │  Binance aggTrades · ESPN scoreboard · LoL Esports · RSS wires     │
   (spot)     ├──────▶│  read at draft time and at render time, never persisted as truth  │
              │       └───────────────┬──────────────────────────────────────────────────┘
              │                       │ draft + validate
              ▼                       ▼
      ┌──────────────┐        ┌──────────────────┐    createMarket    ┌──────────────────────┐
      │ live strip   │        │  Hermes agent    │──────────────────▶ │ CentralPrediction-   │
      │ (client)     │        │  hermes/*.py     │   seedLiquidity    │ Engine (Base 8453)   │
      └──────┬───────┘        └────────┬─────────┘                    │  CPMM + escrow       │
             │                         │ insights.json                └───────┬──────────────┘
             │                         ▼                                      │ 1.5% fee
             │                 ┌──────────────┐                             ▼
             │                 │ static host  │                    ┌──────────────────┐
             └────────────────▶│ (Pages/CDN)  │◀───── reads ───────│ ProtocolFeeVault │
                               └──────┬───────┘                    └──────────────────┘
                                      │ serves bundle
                                      ▼
                              ┌────────────────┐   personal_sign → PBKDF2 → AES-GCM
                              │ browser client │──────────────▶ cloud sync (self-host/Supabase/ntfy)
                              └────────────────┘
```

Contracts: `CentralPredictionEngine` (market state, CPMM, escrow, resolution), `ProtocolFeeVault`
(fee custody and distribution), `ReferralLedger` (off-book attribution ledger, optional).

The client never trusts a server for prices: quotes are recomputed from reserves with the same
formula as the contract, and write calls carry `minSharesOut` / `minAmountOut` guards.

---

## 3. Market object and lifecycle

```solidity
struct Market {
    string  question;      string  category;      // displayed and used as the settlement rule
    uint256 resolutionTime; uint256 createdAt;
    address creator;
    uint256 yesReserve;    uint256 noReserve;     // CPMM inventory (6 dp)
    uint256 cash;                                 // market-scoped USDC book
    uint256 owed;                                 // payouts promised, not yet redeemed (gross)
    uint256 totalVolume;                          // cumulative traded volume (reconciliation)
    uint8   outcome;                              // 0 NO · 1 YES · 2 INVALID
    bool    resolved;      bool    exists;
    uint64  disputeEndsAt;                        // 0 = not yet ruled
    bool    finalized;                            // window lapsed, finalize, or emergency refund
    uint8   disputes;                             // how many times the ruling was overridden
    uint256 yesUserAtSettle; uint256 noUserAtSettle;  // share snapshot, for re-ruling
}
```

```
 draft ──▶ created ──▶ seeded ──▶ trading ──▶ resolution proposed ──▶ [1h dispute] ──▶ settled
                                     │                                   │
                                     │ (global pause() freezes fills and redeems)
                                     └──▶ refundable (resolutionTime + 7d, bypasses pause)
```

| Phase | Constraint enforced on-chain |
| --- | --- |
| create | `1h ≤ resolutionTime − now ≤ 365d`; question and category non-empty; `CREATOR_ROLE` |
| seed | `amount ≥ MIN_SEED = 10 USDC`, added to **both** reserves, so the book opens at 50/50 with real depth |
| trade | `5 USDC ≤ amountIn ≤ 10,000 USDC`; notional ≤ 5% of pool depth; `paused == false`; `now < resolutionTime` |
| propose | `ORACLE_ROLE` only; sets `disputeEndsAt = now + 1h`; increments `disputes` on every override |
| dispute | redeems frozen during the window; admin may re-rule; `owed` is recomputed from the share snapshot |
| settle | after the window the ruling is final with no further transaction; `INVALID` refunds both sides fee-free |
| refund | if unresolved at `resolutionTime + 7d`, `emergencyRefund` pays both sides and every read path bypasses pause |

The 7-day refund delay is a deliberate trade: it gives the oracle time to rule on a delayed event,
and it caps how long a position can be stuck if the oracle never acts.

---

## 4. Pricing engine

### 4.1 State and price

A market holds two reserves: `y` (YES-side) and `n` (NO-side), denominated in collateral units
(USDC, 6 dp). The curve is the constant product

```
k = y · n            (invariant, non-decreasing across trades)
p_yes = n / (y + n)  (1e18 fixed point, priceYes())
p_no  = y / (y + n)
```

`p_yes + p_no = 1` by construction. A market seeded at 40% holds `y = 30,000`, `n = 20,000`, i.e.
`k = 6·10⁸`.

### 4.2 Buying

A YES buy of gross `G` charges `fee = ceil(G · 150 / 10_000)` and mints `net = G − fee` complete
pairs (one YES + one NO) into the pool. The pool then releases YES shares from reserve:

```
fee     = ceil(G · 1.5%)
net     = G − fee
n'      = n + net
y'      = ceil( y · n / n' )        // rounded up: the pool never gives away a wei
shares  = net + (y − y')            // pairs minted + reserve released
```

A NO buy is the mirror image with `y` and `n` swapped. Rounding is always against the trader
(`mulDivUp` on the reserve side, `mulDivDown` on payouts), so no sequence of dust trades can drain
the pool.

**Worked example.** Pool `y = 30,000`, `n = 20,000` (`p_yes = 40.0%`). Buy YES with `G = 1,000`:

```
fee     = ceil(1,000 · 0.015) = 15
net     = 985
n'      = 20,985
y'      = ceil(30,000 · 20,000 / 20,985) = 28,592
shares  = 985 + (30,000 − 28,592) = 2,393 YES
p_yes'  = 20,985 / (28,592 + 20,985) = 42.33%
```

The trader paid 1,000 for 2,393 shares — an average of 0.4179 against a 0.4000 open, i.e. the fill
crossed 2.33 points of impact and paid 1.5% of fee. Selling the same size back immediately returns
less than 1,000: curve plus fee is a strict round-trip loss for the taker, which is the property
that keeps the pool solvent without an external maker.

### 4.3 Selling

```
gross   = midpoint of pre- and post-trade price × sharesIn     // no free lunch on the way out
fee     = ceil(gross · 1.5%)
payout  = gross − fee
```

The midpoint convention (rather than the post-trade price) removes the "sell into your own
impact" arbitrage that naive CPMM implementations leak.

### 4.4 Impact cap

```
amountIn  ≤ (y + n) · 5%      // buys
sharesIn  ≤ (y + n) · 5%      // sells, valued at spot
```

This is a **notional cap per fill**, not a promise that price impact stays under 5 points. It
bounds single-transaction damage on a shallow book — the failure this protocol can actually
control. It does not protect a trader from a 30% move executed across ten transactions.

### 4.5 Settlement

Winning shares redeem at `1.0 − 0.5%`. Under `INVALID` both sides redeem at par with **no fee**.
The settlement fee is charged at redeem time, not at resolution, so unclaimed positions never
accrue phantom liabilities in the fee accounting.

### 4.6 Fee flow

```
trade (1.5%)  ──▶ ProtocolFeeVault ──▶ autoDistributeFee() ──▶ treasury
redeem (0.5%) ──┘        (anyone may call; no recipient parameter)
```

The vault holds no logic beyond custody: `autoDistributeFee()` takes no arguments, so a caller
cannot redirect funds; `renounceOwnership()` is disabled so `setTreasury` can never be bricked by
accident. `pendingFees()` exposes the balance for monitoring.

---

## 5. Settlement and oracle model

- `proposeResolution(marketId, outcome)` is `ORACLE_ROLE`. It stamps `disputeEndsAt = now + 1h`.
- During the window, redeems are frozen. The admin may submit a corrected ruling; the last ruling
  before the window closes is the one that pays.
- When the window lapses, the ruling is final with no further transaction. There is no path for
  the admin to move collateral to itself: `redeem` pays share holders pro rata, and `sweep` only
  touches collateral that is not owed to a winning share.
- Settlement sources, per vertical: CoinGecko daily close (crypto), official final score (sport),
  official `gameWins` (esports), named regulator / issuer publication (news, tech).
- News markets are **never auto-settled**. The brain may draft them; a human signs the ruling.

**Circuit breakers, in plain terms.** `pause()` is a single global switch (`onlyAdmin`): it stops
new fills and also stops redemptions, because during an incident an operator should be able to
freeze the book before paying anyone. What it cannot do is trap principal forever — `redeemGuard`
lets any market past `resolutionTime + 7d` bypass the pause entirely, so the worst case is a delay,
never a loss of access. The ruling path has its own brake: during the one-hour dispute window
redemptions are frozen so a wrong ruling can still be corrected, and the freeze lifts by itself
when the window closes. If nobody rules at all, the 7-day refund makes both sides whole. None of
these paths can move a user's position to the operator.

**Oracle risk is the dominant trust assumption of v1.** A wrong or captured oracle can mispay a
market. Mitigations in place: one-hour dispute window, public criteria on every market, INVALID as
an escape hatch, and a 7-day refund if nobody rules at all. Mitigation not in place: an on-chain
escalation market. It is on the roadmap, and it is why resolution stays gated.

---

## 6. Economic risk framework

| Risk | Vector | Control |
| --- | --- | --- |
| Pool drain by dust | rounding in the trader's favour, repeated | reserve maths rounds against the trader; `k` never decreases |
| Single-fill impact | shallow book, one large order | notional ≤ 5% of depth; `MIN_SEED = 10 USDC` per side; `MAX_BET = 10,000 USDC` |
| Stale quote | price moves between quote and inclusion | mandatory `minSharesOut` / `minAmountOut`; client re-quotes on receipt |
| Round-trip farming | buy and sell in one block | sells price at the midpoint; fee charged on both legs |
| Create-then-refund | instant market, immediate refund | `MIN_TRADING_WINDOW = 1h`; refund only after `resolutionTime + 7d` |
| Reentrancy | ERC-20 hooks on transfer | CEI ordering + `nonReentrant`; state written before transfers |
| Oracle capture | wrong ruling | 1h dispute window, admin re-rule, INVALID, public criteria |
| Admin key loss | one EOA holds admin and treasury | disclosed in §8.4; Safe migration before volume |
| Fee misdirection | caller-chosen recipient | `autoDistributeFee()` takes no parameters |

**Solvency invariant.** For every market, collateral held equals
`Σ unredeemed winning shares + seed remainder + undistributed fees`, and the pool's `k` is
non-decreasing. Both are exercised by the harness in §7.2.

---

## 7. Security evidence

### 7.1 Static analysis

Slither 0.10.0 against `src/` with the Foundry build:

| Severity | Count | Notes |
| --- | --- | --- |
| High | **0** | — |
| Medium | **0** | — |
| Low | 12 | all `block.timestamp` comparisons (deadlines, dispute window, refund delay) |
| Informational | 7 | solc version pin, complexity, naming |

Raw JSON: `docs/security/slither-report.json`. Timestamp use is intentional: every comparison is a
deadline, none is randomness or a price input.

### 7.2 Invariant campaign

Foundry handler suite `test/CentralEngineInvariant.t.sol`, 1,000 runs × depth 100 = **100,000 handler
calls**, zero breaks. The properties as named on disk:

| Property | Statement |
| --- | --- |
| `invariant_CashCoversOwed` | vault balance ≥ total unredeemed winning liability |
| `invariant_CashCoversBothSides` | balance covers both sides' claims simultaneously |
| `invariant_NoHiddenCash` | no collateral unaccounted for between reserves, supply and fees |
| `invariant_DisputeWindowProtectsOwed` | owed funds cannot be swept while the dispute window is open |
| `invariant_SupplyMatchesInventory` | `yesSupply == noSupply`, and both match pool inventory |

### 7.3 Test matrix

```
forge test                                                  62 passed, 0 failed
cd sdk && npm test                                          70 passed (116 assertions)
python3 -m unittest discover -s hermes -p 'test_*.py'         79 passed
node server/sync-selftest.mjs                                11 passed
python3 frontend/scripts/e2e_ui.py <url>                    101 passed
python3 frontend/scripts/e2e_sync.py <url>                   13 passed
npx tsc --noEmit                                              0 errors
```

No third-party audit has been performed. Static analysis plus invariants reduce risk; they do not
eliminate it, and this document does not claim otherwise.

### 7.4 Client-side safety

- Keys never leave the wallet; the protocol has no custody of user keys.
- Cloud sync derives its AES-256-GCM key from a `personal_sign` signature via PBKDF2-SHA256
  (120k iterations); the relay only ever stores ciphertext.
- Paper mode is labelled in the mode switch, the risk dialog and the trade panel. No simulated
  fill is ever presented as settled money.

---

## 8. Operations

### 8.1 Deployment

| Contract | Address |
| --- | --- |
| `CentralPredictionEngine` | `0xE6056Bc6700F6d7E6fF8779B212655284dc1631C` |
| `ProtocolFeeVault` | `0x29dE563f3059827D00837305FAE2Bbc87c7D9eE1` |
| USDC (canonical, 6 dp) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

Roles: `DEFAULT_ADMIN` (pause, role grants), `CREATOR`, `ORACLE`, `FEE_MANAGER`. Pause is one
global switch: it blocks new fills and redemptions, and only the `resolutionTime + 7d` refund path
runs through it.

### 8.2 Runbook

```
forge test                                               # contract gate
cd frontend && npx tsc --noEmit && npm run build          # client gate
python3 frontend/scripts/e2e_ui.py http://127.0.0.1:4173/  # UI gate
./deploy/gh-pages.sh                                      # publish + verify 200
```

### 8.3 Client architecture

Static bundle, no server session. Prices are recomputed from reserves client-side with the same
formula as §4; five locales (EN/ZH/JA/KO/DE) are a typed message tree with per-market copy in
`src/locales/markets.<code>.json`; state that must survive devices (positions, comments, language)
syncs through the encrypted relay in §7.4.

### 8.4 Known centralisation

Admin and treasury are a single EOA. This is disclosed because it is true: an admin key compromise
can pause trading and re-rule inside a dispute window. It cannot mint, cannot move user positions,
and cannot pay itself out of a settled market. Migration to a 2-of-3 Safe is the first operational
item before real volume.

---

## 9. Limitations

1. **Oracle trust** — the main assumption. Mitigated, not solved.
2. **Liquidity depth** — early markets are seeded, not market-made; large orders hit the impact cap
   quickly. The cap protects the pool, not the trader.
3. **No permissionless creation** — supply is operator-gated: high quality, low breadth.
4. **Paper mode is not money** — the simulator uses the real curve with FAKE-USDC, and says so.
5. **No third-party audit** — stated plainly, everywhere it matters.

---

## 10. Ecosystem, partners and community

### 10.1 Liquidity providers

Two arrangements, both on the same CPMM curve as public flow — no privileged price, no hidden
inventory, no separate fee schedule:

| Track | Who funds | Fee treatment | Reporting |
| --- | --- | --- | --- |
| Direct | LP seeds a named market itself | LP keeps 100% of the 1.5% trade fee that market produces | per-market volume, fee accrual, redemption exposure, daily |
| Curated | we design the market, the LP funds it | split agreed in a signed term sheet before launch | same, plus launch notes |

Minimum seed is 10,000 USDC per market; settlement is USDC on Base. Because the seed sits inside
the same reserves as public flow, an LP cannot front-run its own book: its fills are priced by the
same invariant as everyone else's, and its capital is redeemable only through the normal
resolution path.

### 10.2 Data and oracle partners

A partner qualifies if it publishes a number we can settle against — a closing price, an official
final score, a regulatory decision. In exchange: named attribution on the market card and in the
resolution rule, machine-readable criteria reviewed jointly, and a human signature on every
resolution. News markets never auto-settle, whatever the feed says.

### 10.3 Integrators

`@prediction/sdk` (class `CentralPredictionSDK`) quotes, trades and reads positions against the
deployed engine with no API key and no rate-limit tier — it is plain JSON-RPC against Base 8453.
The client in this repository is one consumer of that SDK, not a privileged one.

### 10.4 Community layer

Every market carries a debate wall: a stance (YES / NO / neutral), a written take, and one upvote
per browser per take. Takes ride the same encrypted payload as the portfolio, so a wall follows the
wallet across devices; likes merge monotonically (the higher count wins) and seeded official
prompts cannot be deleted. The wall is a discussion surface, not a signal product: nothing on it
changes how a market settles.

---

## 11. References

- Contract source: `src/CentralPredictionEngine.sol`, `src/ProtocolFeeVault.sol`
- Invariant suite: `test/CentralEngineInvariant.t.sol`
- Slither output: `docs/security/slither-report.json`
- SDK: `sdk/` · agent: `hermes/` · client: `frontend/`
- Deployed terminal: <https://peacecoin10.github.io/Aura-AI-Prediction-Market/>
