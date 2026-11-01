# Aura — System Architecture & Market Model

A prediction-market terminal on Base: AI-drafted binary markets, a constant-product
market maker, five languages, and a trading hall that runs on **real public data** —
real spot prices, real exchange prints, real settlement rules — while trading itself
stays on paper chips until the on-chain book is funded.

This is the only design document. Everything that used to live in separate guides is
folded in here.

---

## 1. The model

- **Binary, objective, dated.** Every market is a YES/NO question with an explicit
  resolution time and a written resolution rule. No scalar markets, no vague wording.
- **AI-drafted, human-auditable.** The Hermes brain drafts from live feeds, validates
  each question against a binary-question linter, and stores the source so anyone can
  replay the decision. News markets are never auto-settled.
- **One curve, not an order book.** Prices come from a constant-product market maker;
  the same formula prices the UI quote, the paper fill and the on-chain trade.
- **Paper by default, real on demand.** A visitor gets 10,000 FAKE-USDC and can trade
  the entire flow with zero wallet and zero risk. Switching to Real connects an
  EIP-6963 wallet and trades USDC on Base mainnet.
- **Honest labelling.** Paper fills are paper, sample cohorts are simulated, and the
  order-flow tape says which venue printed each trade. Nothing simulated is dressed up
  as settled money.

## 2. Market supply (real feeds)

| Vertical | Source | Drafting | Settlement |
| --- | --- | --- | --- |
| Crypto | CoinGecko / Binance spot | threshold from the live price, fixed UTC close | automatic: 3×30 s sampling |
| News / politics | public RSS (Reuters, BBC, ECB, SEC, …) | headline → binary question | manual: Oracle / Safe |
| Sports | ESPN public scoreboard (NBA/NFL/EPL/UCL/… ) | next fixture / result | automatic: official final score |
| Esports | LoL Esports schedule | next series | automatic: official `gameWins` |
| Tech | vendor / lab RSS, release notes | shipping or regulatory event | manual or announcement-based |

Rules enforced before anything ships: question ends with `?`, is binary-aligned, has
no “how much / which / when will” wording, carries objective criteria ≥ 12 chars, and
resolves at least 30 minutes out. If a feed is down, the cycle skips — it never invents
a headline or a score.

**Live lane.** The hall's top strip is generated in the browser from real CoinGecko
quotes: six majors, strike derived from spot, close at the next UTC midnight + 1 day,
probability a logistic function of the distance to strike, refreshed every 60 s. If the
API is unreachable the strip disappears rather than showing a stale or invented price.

## 3. Pricing, fees and order flow

- YES price = `noReserve / (yesReserve + noReserve)`; buys and sells move the same two
  reserves, so the quote is path-consistent.
- Trading fee **1.5%** on notional to the fee vault; **0.5%** on settlement payout.
- Per-trade price impact is capped at **5%**; slippage guards are mandatory on writes.
- **Order-flow tape is real.** Rows are Binance spot aggregated trades (side, notional,
  price, age, venue). The whale tape shows the same prints filtered to ≥ $25k notional.
  If the venue is unreachable the tapes hide; no fabricated prints are ever rendered.
- Market cards state their source (`CoinGecko`, `ESPN`, `SEC.gov`, …) and a settlement
  countdown, so the hall reads as a book with real references behind it.

## 4. Languages and coverage

Five locales ship: **EN / ZH / JA / KO / DE**. Three layers are translated:

1. **UI chrome** — a typed message tree (`src/locales/*`), one namespace per surface;
   a locale that misses a key fails `tsc` instead of rendering `undefined`.
2. **Market copy** — all 255 catalogue questions and resolution criteria live in
   `src/locales/markets.<code>.json` (one row per market id), so switching language
   never leaves an English headline behind.
3. **Live copy** — the live strip is built from translated templates with numbers and
   dates formatted by `Intl` for the active locale.

The switcher is a five-row frosted dropdown (never a native `<select>`): Up/Down move,
Home/End jump, Enter commits, Escape and outside-click dismiss. Switching is in-place,
writes `<html lang>`, persists to `localStorage` and mirrors to the cloud.

Acceptance rule: after switching away from English the rendered hall must contain no
English question titles; units and proper nouns (`USDC`, `BTC`, `ESPN`) stay as-is.

## 5. Contracts (Base mainnet, chain 8453)

| Contract | Address |
| --- | --- |
| `CentralPredictionEngine` | `0xE6056Bc6700F6d7E6fF8779B212655284dc1631C` |
| `ProtocolFeeVault` | `0x29dE563f3059827D00837305FAE2Bbc87c7D9eE1` |
| USDC (canonical, 6 dp) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

One engine hosts many markets; no proxy, no upgrade path. Outcome encoding is
`0 = NO, 1 = YES` on-chain while the UI's side index is the reverse — the single
mapping lives in `src/lib/paper.ts` and is covered by tests.

Lifecycle: `createMarket` → `seedLiquidity` → `buy/sell` → `proposeResolution` →
1-hour dispute window → settle → `redeem`. If a market stays unresolved 7 days past
its settlement time anyone may call `emergencyRefund`.

Roles: `DEFAULT_ADMIN` (pause, role grants), `CREATOR`, `ORACLE`, `FEE_MANAGER`.
Admin and treasury are a single EOA today — a deliberate bootstrap setting, to be moved
to a Safe before real volume.

## 6. Cloud sync (wallet-bound, encrypted)

State travels between devices without an account:

1. `personal_sign` a fixed message with the wallet → deterministic signature.
2. PBKDF2-SHA256 (120k iterations) over that signature + a tag derived from the
   address → AES-256-GCM key.
3. The payload (`{updatedAt, device, blob:{iv, ct}}`) is pushed to one of: a
   self-hosted store (`VITE_SYNC_ENDPOINT`), Supabase PostgREST, or the ntfy relay
   (`aura-sync-v1-<sha256(address)[:24]>`, 12 h retention, 3 KB chunks).

Merge rules: money is last-writer-wins; fills and comments union by id; the first
device on a new browser pushes with `force` so a fresh profile cannot wipe a ledger.
The server never sees plaintext, and the header chip reports the real round-trip:
`Local only → Syncing → Synced`.

## 7. Security posture

- Slither 0.10.0: **0 High, 0 Medium**; 12 Low (`block.timestamp`, used only for
  deadlines and the dispute window); 7 Informational. Raw output:
  `docs/security/slither-report.json`.
- Invariant campaign: 512 runs × depth 200 = **102,400 handler calls**, 0 breaks.
- No third-party audit has been performed. Static analysis and invariants reduce risk;
  they do not eliminate it.
- Client-side keys are derived, never stored in plaintext; the relay only ever holds
  AES-GCM ciphertext.

## 8. Build, test, deploy

```bash
forge test                                              # 62 contracts
cd sdk && npm test                                      # 70 SDK
python3 -m unittest discover -s hermes -p 'test_*.py'    # 64 agent
node server/sync-server.mjs & node server/sync-selftest.mjs   # 11 crypto
cd frontend && npx tsc --noEmit && npm run build         # types + bundle
python3 scripts/e2e_ui.py http://127.0.0.1:4173/         # 91 UI
python3 scripts/e2e_sync.py http://127.0.0.1:4188/       # 13 two-device sync
```

Deploy is one command: `./deploy/gh-pages.sh` builds with the project base path,
force-pushes `gh-pages`, refreshes Pages and verifies the page plus a hashed asset
return 200 at `https://peacecoin10.github.io/Aura-AI-Prediction-Market/`.

Artwork: curated 1200×675 photography per vertical (Wikimedia Commons, credited in
`frontend/public/art/photos/CREDITS.md`) with the deterministic per-market SVG as
fallback; market art never depends on an external CDN at runtime.
