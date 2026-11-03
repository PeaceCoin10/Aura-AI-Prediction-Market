<div align="center">

# Aura Protocol

**Binary prediction markets on Base — architecture, market model and security**

![chain](https://img.shields.io/badge/chain-Base%208453-0052FF?style=flat-square)
![forge](https://img.shields.io/badge/forge-62%20tests-2ea44f?style=flat-square)
![invariants](https://img.shields.io/badge/invariants-100%2C000%20calls-2ea44f?style=flat-square)
![slither](https://img.shields.io/badge/slither-0%20high%20%C2%B7%200%20medium-2ea44f?style=flat-square)
![audit](https://img.shields.io/badge/audit-not%20performed-orange?style=flat-square)

*Version 1.3 · November 2026 · engine `0xE6056Bc…1631C`*

</div>

> [!NOTE]
> **What this document is.** The single technical reference for Aura: how a market is created, how
> it is priced, how it settles, and what has actually been verified. Every figure below is
> reproducible from this repository — contract source, invariant harness, raw Slither output and
> test suite are all in-tree. Marketing claims are not part of this document.

> [!WARNING]
> **What this document is not.** It is not an audit, not investment advice, and not a promise of
> returns. No third-party audit has been performed. Trading is real money on Base mainnet; the
> paper mode is labelled paper wherever it appears.

---

## Contents

```
docs/
└── WHITEPAPER.md
    ├── 1  Overview .............. goals, non-goals, audience
    ├── 2  Architecture .......... contracts, data plane, client
    ├── 3  Market lifecycle ...... object, state machine, constraints
    ├── 4  Pricing engine ........ CPMM maths, worked example, impact cap
    ├── 5  Fees .................. 1.5% / 0.5%, vault, distribution
    ├── 6  Settlement ............ oracle, dispute, refund, pause
    ├── 7  Risk framework ........ vectors → controls, solvency
    ├── 8  Security evidence ..... Slither, invariants, test matrix
    ├── 9  Operations ............ addresses, runbook, centralisation
    ├── 10 Ecosystem ............. integrations, desks, community
    ├── 11 AI research layer ..... DeepSeek commentary, guards
    └── A  Parameters ............ every constant in one table
```

---

## 1 · Overview

Aura is a binary prediction market protocol and trading terminal. Markets are drafted by an
automated research agent from public data feeds, priced by a constant-product market maker held
entirely inside one contract, and settled against a written rule with a one-hour dispute window.
The terminal is a static client: no account, no backend session, no custody of user keys.

**Goals**

| # | Goal | Where it is enforced |
| --- | --- | --- |
| 1 | A question, price and settlement date any third party can verify | `criteria` on every market, public feeds |
| 2 | One formula for quote, paper fill and on-chain trade | `priceYes()` mirrored in the client |
| 3 | Fees accounted at fill time, never minted | `buyShares` / `sellShares` → `ProtocolFeeVault` |
| 4 | A defined failure mode for every external dependency | feed skip, INVALID, dispute, refund, pause |
| 5 | Honest client labelling | paper mode, venue attribution, no fake prints |

**Non-goals (v1)**

- **Permissionless creation.** Gated by `CREATOR_ROLE`: the brain drafts, an operator signs.
  Opening it needs a creation bond and a resolution-arbitration market first.
- **Leverage, scalar outcomes, options, cross-chain settlement.**
- **Decentralised governance.** Admin and treasury are one EOA — disclosed in §9.4, not hidden.

---

## 2 · Architecture

```
                    ┌──────────────────── public data plane ────────────────────┐
 CoinGecko ─┐       │  Binance aggTrades · ESPN scoreboard · LoL Esports · RSS  │
 (spot)     ├──────▶│  read at draft time and at render time, never "truth"      │
            │       └──────────────┬───────────────────────────────────────────┘
            │                      │ draft + validate
            ▼                      ▼
   ┌──────────────┐      ┌──────────────────┐  createMarket  ┌─────────────────────┐
   │ live strip   │      │  Hermes agent    │───────────────▶│ CentralPrediction-  │
   │ (client)     │      │  hermes/*.py     │  seedLiquidity │ Engine (Base 8453)  │
   └──────┬───────┘      └────────┬─────────┘                │ CPMM + escrow       │
          │                       │ insights.json            └──────────┬──────────┘
          │                       ▼                                    │ 1.5% fee
          │               ┌──────────────┐                           ▼
          └──────────────▶│ static host  │◀─────────── reads ──┌──────────────────┐
                          │ (Pages/CDN)  │                     │ ProtocolFeeVault │
                          └──────┬───────┘                     └──────────────────┘
                                 │ serves bundle
                                 ▼
                         ┌────────────────┐  personal_sign → PBKDF2 → AES-GCM
                         │ browser client │────────────▶ cloud sync (self/Supabase/ntfy)
                         └────────────────┘
```

| Contract | Responsibility |
| --- | --- |
| `CentralPredictionEngine` | market state, CPMM, escrow, resolution, pause |
| `ProtocolFeeVault` | fee custody; `autoDistributeFee()` takes no parameters |
| `ReferralLedger` | affiliate accrual + pull payout: `rebateBps` 2000 (20% of the 1.5% fee), credited by its `operator`, claimed in USDC |

> [!IMPORTANT]
> The client never trusts a server for prices. Quotes are recomputed from reserves with the same
> formula as the contract, and every write carries `minSharesOut` / `minAmountOut`.

---

## 3 · Market lifecycle

```solidity
struct Market {
    string  question;      string  category;          // category doubles as settlement note
    uint256 resolutionTime; uint256 createdAt;
    address creator;
    uint256 yesReserve;    uint256 noReserve;         // CPMM inventory (6 dp)
    uint256 cash;                                     // market-scoped USDC book
    uint256 owed;                                     // promised payouts, not yet redeemed
    uint256 totalVolume;                              // cumulative volume (reconciliation)
    uint8   outcome;                                  // 0 NO · 1 YES · 2 INVALID
    bool    resolved;      bool    exists;
    uint64  disputeEndsAt;                            // 0 = not yet ruled
    bool    finalized;                                // window lapsed / finalize / emergency refund
    uint8   disputes;                                 // number of overrides (audit trail)
    uint256 yesUserAtSettle; uint256 noUserAtSettle;  // share snapshot for re-ruling
}
```

```
draft ──▶ created ──▶ seeded ──▶ trading ──▶ proposed ──▶ [1h dispute] ──▶ settled
                                    │                          │
                                    │  global pause()          │
                                    ▼                          ▼
                              fills+redeems frozen      ruling becomes final
                                    │
                                    └──▶ refundable after resolutionTime + 7d
```

| Phase | On-chain constraint |
| --- | --- |
| create | `1h ≤ resolutionTime − now ≤ 365d`; question and category non-empty; `CREATOR_ROLE` |
| seed | `amount ≥ 10 USDC`, added to **both** reserves — the book opens 50/50 with real depth |
| trade | `5 ≤ amountIn ≤ 10,000 USDC`; notional ≤ 5% of depth; not paused; `now < resolutionTime` |
| propose | `ORACLE_ROLE` only; sets `disputeEndsAt = now + 1h`; `disputes++` on each override |
| dispute | redeems frozen; admin may re-rule; `owed` recomputed from the share snapshot |
| settle | ruling final with no further transaction; `INVALID` refunds both sides fee-free |
| refund | unresolved at `resolutionTime + 7d` → `emergencyRefund`, both sides made whole |

---

## 4 · Pricing engine

### 4.1 State and price

```text
k      = y · n                 invariant, non-decreasing across trades
p_yes  = n / (y + n)           1e18 fixed point, priceYes()
p_no   = y / (y + n)           p_yes + p_no = 1 by construction
```

A market at 40% holds `y = 30,000`, `n = 20,000`, so `k = 6·10⁸`.

### 4.2 Buying

```text
fee    = ceil(G · 1.5%)              charged on gross, forwarded to the vault
net    = G − fee                     complete pairs minted into the pool
n'     = n + net
y'     = ceil(y · n / n')            rounded up: the pool never gives away a wei
shares = net + (y − y')              pairs minted + reserve released
```

> [!TIP]
> **Worked example** — pool `y = 30,000`, `n = 20,000` (`p_yes = 40.0%`), buy YES with `G = 1,000`:
>
> ```text
> fee    = 15          net = 985
> n'     = 20,985      y'  = ceil(30,000 · 20,000 / 20,985) = 28,592
> shares = 985 + (30,000 − 28,592) = 2,393 YES
> p_yes' = 20,985 / (28,592 + 20,985) = 42.33%
> ```
>
> The trader paid 1,000 for 2,393 shares — average 0.4179 against a 0.4000 open: 2.33 points of
> impact plus the 1.5% fee. Selling the same size back immediately returns less than 1,000.

### 4.3 Selling

```text
gross  = midpoint(pre, post) × sharesIn     // no free lunch on the way out
fee    = ceil(gross · 1.5%)
payout = gross − fee
```

The midpoint convention removes the "sell into your own impact" arbitrage that naive CPMM
implementations leak.

### 4.4 Impact cap

```text
amountIn ≤ (y + n) · 5%     // buys
sharesIn ≤ (y + n) · 5%     // sells, valued at spot
```

> [!CAUTION]
> This is a **notional cap per fill**, not a promise that price impact stays under five points.
> It bounds single-transaction damage on a shallow book — it does not protect a trader from a 30%
> move executed across ten transactions.

---

## 5 · Fees

```text
trade  (1.5%) ──▶ ProtocolFeeVault ──▶ autoDistributeFee() ──▶ treasury
redeem (0.5%) ──┘        anyone may call · no recipient parameter
```

| Fee | Rate | Charged | Destination |
| --- | --- | --- | --- |
| Trading | 1.5% of notional | at fill | `ProtocolFeeVault` |
| Settlement | 0.5% of payout | at redeem | `ProtocolFeeVault` |
| `INVALID` refund | 0% | at redeem | — |

Referral rebates settle in `ReferralLedger`, funded as a separate pool: the ledger credits 20% of
the 1.5% fee to the referrer of an attributed trade (`rebateBps = 2000`) and the referrer pulls the
USDC whenever they want. The pool is funded explicitly, so a credit can never be paid out of user
collateral, and claims revert while the pool is short.

The vault holds no logic beyond custody: `autoDistributeFee()` takes no arguments, so a caller
cannot redirect funds; `renounceOwnership()` is disabled so `setTreasury` can never be bricked by
accident. `pendingFees()` exposes the balance for monitoring.

---

## 6 · Settlement, dispute and pause

- `proposeResolution(marketId, outcome)` is `ORACLE_ROLE`; it stamps `disputeEndsAt = now + 1h`.
- During the window redeems are frozen and the admin may re-rule; the last ruling before the window
  closes is the one that pays.
- After the window the ruling is final with no further transaction. The admin cannot pay itself:
  `redeem` pays share holders pro rata and `sweep` only touches collateral not owed to winners.
- Sources by vertical: CoinGecko daily close (crypto), official final score (sport), official
  `gameWins` (esports), named regulator / issuer publication (news, tech).
- **News is never auto-settled.** The brain may draft it; a human signs the ruling.

> [!WARNING]
> **Oracle risk is the dominant trust assumption of v1.** A wrong or captured oracle can mispay a
> market. Mitigations: 1-hour dispute window, public criteria, `INVALID` escape hatch, 7-day
> refund. Not mitigated: no on-chain escalation market yet — which is why resolution stays gated.

**Circuit breakers in plain terms.** `pause()` is one global switch (`onlyAdmin`): it stops new
fills and redemptions, because during an incident an operator should be able to freeze the book
before paying anyone. It cannot trap principal forever — `redeemGuard` lets any market past
`resolutionTime + 7d` bypass the pause. Worst case is a delay, never loss of access.

---

## 7 · Risk framework

| Risk | Vector | Control |
| --- | --- | --- |
| Pool drain by dust | rounding in the trader's favour, repeated | all reserve maths rounds against the trader; `k` never decreases |
| Single-fill impact | shallow book, one large order | notional ≤ 5% of depth; seed floor 10 USDC; max bet 10,000 USDC |
| Stale quote | price moves between quote and inclusion | mandatory `minSharesOut` / `minAmountOut`; client re-quotes |
| Round-trip farming | buy and sell in one block | sells price at the midpoint; fee on both legs |
| Create-then-refund | instant market, immediate refund | 1h minimum window; refund only after `resolutionTime + 7d` |
| Reentrancy | ERC-20 hooks on transfer | CEI ordering + `nonReentrant` |
| Oracle capture | wrong ruling | dispute window, admin re-rule, `INVALID`, public criteria |
| Admin key loss | one EOA holds admin and treasury | disclosed in §9.4; Safe migration before volume |
| Fee misdirection | caller-chosen recipient | `autoDistributeFee()` takes no parameters |

**Solvency invariant.** For every market, collateral held equals
`Σ unredeemed winning shares + seed remainder + undistributed fees`, and `k` is non-decreasing.
Both are exercised by the harness in §8.2.

---

## 8 · Security evidence

### 8.1 Static analysis

| Severity | Count | Detail |
| --- | --- | --- |
| High | **0** | — |
| Medium | **0** | — |
| Low | 12 | all `block.timestamp` comparisons (deadlines, dispute, refund) |
| Informational | 7 | solc pin, complexity, naming |

Raw output: `docs/security/slither-report.json`. Timestamp use is intentional — every comparison is
a deadline, none is randomness or a price input.

### 8.2 Invariant campaign

`test/CentralEngineInvariant.t.sol` — **1,000 runs × depth 100 = 100,000 handler calls, zero
breaks**:

| Property | Statement |
| --- | --- |
| `invariant_CashCoversOwed` | balance ≥ total unredeemed winning liability |
| `invariant_CashCoversBothSides` | balance covers both sides' claims simultaneously |
| `invariant_NoHiddenCash` | no collateral unaccounted between reserves, supply and fees |
| `invariant_DisputeWindowProtectsOwed` | owed funds cannot be swept while the window is open |
| `invariant_SupplyMatchesInventory` | `yesSupply == noSupply`, and both match inventory |

### 8.3 Test matrix

```bash
forge test                                                    # 62 passed, 0 failed
cd sdk && npm test                                            # 70 passed, 116 assertions
python3 -m unittest discover -s hermes -p 'test_*.py'          # 107 passed
node server/sync-selftest.mjs                                 # 11 passed
python3 frontend/scripts/e2e_ui.py <url>                      # 130 passed
python3 frontend/scripts/e2e_sync.py <url>                    # 13 passed
npx tsc --noEmit                                              # 0 errors
```

> [!IMPORTANT]
> No third-party audit has been performed. Static analysis plus invariants reduce risk; they do not
> eliminate it, and this document does not claim otherwise.

### 8.4 Client-side safety

- Keys never leave the wallet; the protocol never custodies them.
- Cloud sync derives an AES-256-GCM key from `personal_sign` + PBKDF2-SHA256 (120k iterations);
  the relay stores ciphertext only.
- Paper mode is labelled in the mode switch, the risk dialog and the trade panel.

---

## 9 · Operations

### 9.1 Deployment

| Contract | Address |
| --- | --- |
| `CentralPredictionEngine` | `0xE6056Bc6700F6d7E6fF8779B212655284dc1631C` |
| `ProtocolFeeVault` | `0x29dE563f3059827D00837305FAE2Bbc87c7D9eE1` |
| USDC (canonical, 6 dp) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| `ReferralLedger` | `0x2ebf3b69870979f863b8900f03ce8acfe58e8954` (owner = treasury, **operator = indexer `0xaaA5…7C80`**) |

Roles: `DEFAULT_ADMIN` (pause, role grants), `CREATOR`, `ORACLE`, `FEE_MANAGER`.

### 9.2 Runbook

```bash
forge test                                                  # contract gate
cd frontend && npx tsc --noEmit && npm run build             # client gate
python3 frontend/scripts/e2e_ui.py http://127.0.0.1:4173/     # UI gate
./deploy/gh-pages.sh                                         # publish + verify 200
```

### 9.3 Client

Static bundle, no server session. Prices recomputed from reserves with the §4 formula; five locales
(EN/ZH/JA/KO/DE) as a typed message tree plus per-market copy in `src/locales/markets.<code>.json`;
portfolio, debate takes and language sync through the encrypted relay.

### 9.5 Client performance

The hall renders a first page of 48 markets with `content-visibility: auto` on each card, so
off-screen cards cost neither layout nor paint. Measured on the public build with a headless
software rasteriser: 3.1k DOM nodes, 56 images, and a full-locale switch in **0.52–0.70 s**
(measured before this change: 4.2–5.0 s with all 255 cards mounted). JavaScript time for a switch is
~45 ms; the remainder is compositing of the glass surfaces, which is cheaper on real GPUs.

### 9.4 Known centralisation

Admin and treasury are a single EOA. An admin key compromise can pause trading and re-rule inside a
dispute window. It cannot mint, cannot move user positions, and cannot pay itself out of a settled
market. Migration to a 2-of-3 Safe is the first operational item before real volume.

---

## 10 · Ecosystem

### 10.1 Integrations in production

| Name | Role | Where it shows up |
| --- | --- | --- |
| Base (8453) | settlement network | every write |
| USDC | collateral, 6 dp | balances, fills, payouts |
| CoinGecko | crypto settlement prices, live spot | market rules, live strip |
| Binance | public aggregated prints | order-flow and whale tapes |
| ESPN · LoL Esports | official scoreboards / series results | sport and esports rules |
| Wikimedia Commons | photography, credited per file | market artwork |

> [!NOTE]
> A name appears here only because an integration exists in this repository. There is no logo wall
> and no implied endorsement; the institutional portal states the same rule to visitors.

### 10.2 Institutional tracks

| Track | Offer | Terms |
| --- | --- | --- |
| Market maker (direct) | depth in a named market | keeps 100% of the 1.5% fee it generates |
| Market maker (curated) | we design, you fund | split in a signed term sheet before launch |
| Oracle / data | settlement feed + named attribution | machine-readable criteria reviewed jointly |
| Audit / security | review engagement | scope, timeline, disclosure agreed in writing |
| Infrastructure | RPC, indexing, monitoring | operational SLA agreed per integration |

### 10.3 Integrators

`@prediction/sdk` (class `CentralPredictionSDK`) quotes, trades and reads positions against the
deployed engine: plain JSON-RPC on Base 8453, no API key, no rate-limit tier.

### 10.4 Community layer

Every market carries a debate wall: a stance (YES / NO / neutral), a written take, one upvote per
browser per take. Takes ride the same encrypted payload as the portfolio; likes merge monotonically
and seeded official prompts cannot be deleted. It is a discussion surface, not a signal product.

### 10.5 Growth layer

Two mechanics, both auditable:

| Surface | What it does | Where the number comes from |
| --- | --- | --- |
| Share poster | 1200×630 PNG with both-side probability, potential return, ref-coded link and QR; one click to the X intent with `#PredictionMarkets #Base #Crypto` | the card's own live quote; the ref code is the connected address |
| Genesis Season 1 | points for on-chain volume, daily check-in and published takes, plus a standings table | `SharesBought` / `SharesSold` for volume; a local ledger for check-ins and takes |

### 10.6 Attribution indexer

A trade's referrer rides in the last 28 bytes of the order calldata — `auraref1` (8 bytes) followed
by the referrer address — which the engine's ABI decoder never reads. `hermes/indexer.py` recovers
it, re-reads the receipt, and only credits a rebate when the engine's own `SharesBought` /
`SharesSold` log matches:

| Step | Rule |
| --- | --- |
| discover | `--scan-blocks N` walks the last N blocks for tagged engine calls; or a queue line from `/v1/attribution` |
| verify | tag in calldata is authoritative; a queue referrer that disagrees is refused |
| decode | volume from `amountIn` (buy) or `amountOut` (sell); trader must match the tx sender |
| credit | `accrue(tradeId = sha3(tx:logIndex), referrer, volume)` signed by the **operator** key |
| fallback | dry-run is the default; `--live` is a deliberate flag |

> [!NOTE]
> While the pool is unfunded the affiliate panel shows a **Genesis Explorer** state instead of an
> error: links, points and attribution all keep working, and claims switch on the moment the pool is
> funded. That state is derived from `poolBalance() == 0`, not from a hard-coded flag.

> [!IMPORTANT]
> Points are a loyalty ledger, not a token. Paper fills earn nothing — only a settled on-chain fill
> scores. The UI says both things next to the number, and the standings table is rebuilt from the
> same public event feed the activity tab shows.

---

## 11 · AI research layer

Market commentary is written by a hosted language model (DeepSeek), not by templates:

```text
inputs  ──▶ question · live probability · delta since last snapshot · depth · volume
            whale prints (≥ $25k, Binance spot) · headline tone · hours to settlement
model   ──▶ one paragraph per market, 60–110 words, dry research-desk register
guards  ──▶ ① the quoted probability must equal the live one
            ② every numeral must exist in the input (2% tolerance for rounding)
            ③ whale claims must match the prints field (none ⇒ "no large-trader read")
            ④ no cross-market superlatives, no refusals, no invented flow
            ⑤ failing any guard ⇒ the market falls back to the deterministic engine
```

> [!NOTE]
> The model writes prose; it never writes prices. If the API is unreachable, or a paragraph fails a
> guard, that market keeps computed commentary marked `source: computed` — no silent substitution,
> no fabricated numbers.

---

## Appendix A · Parameters

| Constant | Value | Meaning |
| --- | --- | --- |
| `TRADE_FEE_BPS` | 150 | 1.5% on notional, per fill |
| `SETTLE_FEE_BPS` | 50 | 0.5% on winning redemption |
| `MAX_IMPACT_BPS_CAP` | 500 | per-fill notional cap = 5% of depth |
| `MIN_BET` / `MAX_BET` | 5 / 10,000 USDC | trade bounds |
| `MIN_SEED` | 10 USDC | seed floor (added to both reserves) |
| `MIN_TRADING_WINDOW` | 1 hour | blocks create-then-refund |
| `MAX_TRADING_WINDOW` | 365 days | longest market lifetime |
| `DISPUTE_WINDOW` | 1 hour | ruling can be corrected |
| `REFUND_DELAY` | 7 days | emergency refund after resolution time |
| `OUTCOME_*` | 0 NO · 1 YES · 2 INVALID | on-chain encoding |

## Appendix B · Repository

```text
src/            engine, fee vault, referral ledger, libraries
test/           unit, fuzz and the invariant harness
sdk/            @prediction/sdk — typed JSON-RPC client
hermes/         market drafter, feeds, insight engine (DeepSeek)
frontend/       Vite + React terminal, five locales, debate wall
docs/           this whitepaper + raw Slither output
```

- Live terminal — <https://peacecoin10.github.io/Aura-AI-Prediction-Market/>
- Source — <https://github.com/PeaceCoin10/Aura-AI-Prediction-Market>
