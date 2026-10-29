# Asset inventory

Everything this project actually owns: deployed contracts, source size, live endpoints, feature surface
and the numbers behind the claims. Updated 2026-10-29.

## 1. Deployed contracts · Base mainnet (chain 8453)

| Contract | Address | Verified | Notes |
| --- | --- | --- | --- |
| `CentralPredictionEngine` | `0xE6056Bc6700F6d7E6fF8779B212655284dc1631C` | ✅ Basescan + Sourcify exact match | CPMM, 1.5% trade fee, 5% per-trade impact cap |
| `ProtocolFeeVault` | `0x29dE563f3059827D00837305FAE2Bbc87c7D9eE1` | ✅ same | Settlement + trade fees, Safe-gated withdrawals |
| `USDC` (collateral) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | canonical | 6 decimals |

Constructor arguments, for bytecode reproduction:

```
CentralPredictionEngine(usdc=0x8335…2913, feeVault=0x29dE…9eE1, admin=0x436b…5Ba1, creator=0x436b…5Ba1)
ProtocolFeeVault      (usdc=0x8335…2913, treasury=0x436b…5Ba1, admin=0x436b…5Ba1)
```

Compiler solc 0.8.24, optimizer on (200 runs), no proxy, no upgrade path, MIT.

Economics: **1.5%** on trade notional → vault; **0.5%** on settlement payout → vault; dispute window
**1 hour**; `emergencyRefund` opens **7 days** after an unresolved settlement time.

## 2. Code size

| Surface | Lines | Language |
| --- | --- | --- |
| Contracts (`src/`) | ~970 | Solidity 0.8.24 |
| Tests (`test/`) | ~1,150 | Solidity (forge) |
| SDK (`sdk/`) | ~1,834 | TypeScript |
| dApp (`frontend/src/`) | ~6,400 | TSX + CSS |
| Agent (`hermes/`) | ~2,545 | Python 3.8+ |
| i18n copy (`frontend/src/locales/en/`) | ~960 | typed TS message tree |
| Scripts (deploy / e2e / brand) | ~1,000 | Bash + Python |

## 3. Live endpoints

| What | URL |
| --- | --- |
| dApp (permanent) | `https://peacecoin10.github.io/Aura-AI-Prediction-Market/` |
| Repository | `https://github.com/PeaceCoin10/Aura-AI-Prediction-Market` |
| Engine on Basescan | `https://basescan.org/address/0xE6056Bc6700F6d7E6fF8779B212655284dc1631C#code` |
| Vault on Basescan | `https://basescan.org/address/0x29dE563f3059827D00837305FAE2Bbc87c7D9eE1#code` |
| Brand banner (repo) | `assets/banner.png`, `assets/banner.svg` |
| Social card | served at `/og.png` (1200×630, absolute URL in `og:image`) |

## 4. Feature surface

**Hall** — **130 sample markets** across six verticals (Politics, Crypto & Macro, Sports & F1, Esports,
AI & Tech), each with generated vector artwork, live simulated ticks every 7 s, YES/NO probability bars,
depth, volume, settlement countdown, AI commentary and a debate count. A live-fill ticker and a
predictor leaderboard (explicitly labelled *simulated cohort*) give the book a social shape; on-chain
markets render in their own section so real and sample liquidity never blur together.

Artwork: one SVG per market plus five vertical banners and a spotlight scene, generated deterministically
by `frontend/scripts/gen_market_art.py` (136 files, ~3 KB each, no external CDN).

**Growth** — one-click X share per market (`#PredictionMarkets #Base #AI #Crypto`) with a rendered 1200×630
poster that includes the market's artwork, question, probability and a QR code; novice prize-pool beat in
the onboarding flow.

**Trading**
- *Paper* (default for every new visitor): 10,000 FAKE-USDC credited automatically, quotes computed with
  the same CPMM formulas as the contract, fills and PnL tracked locally.
- *Real*: wallet connect (EIP-6963), USDC approve + buy/sell with slippage guard, 5% impact cap,
  on-chain quote and receipt decoding.

**Agent** — Hermes drafts markets from CoinGecko/Binance, RSS news, ESPN scoreboards and LoL Esports;
price markets resolve by 3×30 s sampling, sports/esports by official result, news never auto-resolves
(routed to a human Safe).

**Surfaces** — security matrix drawer (Slither, invariants, dispute mechanics), docs portal, first-run
risk disclosure, wallet portfolio, on-chain event feed, market creation, share poster.

**Internationalisation** — English is the only shipped locale, but the runtime is a typed namespace tree:
adding a language is one file plus one `registerLocale()` call.

## 5. Test matrix (all green as of this build)

| Suite | Command | Result |
| --- | --- | --- |
| Contracts | `forge test` | **46 passed** |
| SDK | `cd sdk && npm test` | **70 passed** |
| Agent | `python3 -m unittest discover -s hermes -p 'test_*.py'` | **49 passed** |
| UI e2e (headless) | `python3 scripts/e2e_ui.py` | **73 passed** |
| Real-chain e2e (anvil) | `python3 scripts/e2e_local.py` | **12 passed** |
| Type check | `npx tsc --noEmit` | 0 errors |
| Build | `npm run build` | 0 errors, ~1.4k modules |

Security tooling: Slither **0 High / 0 Medium**, 12 Low (`block.timestamp`, intended), 7 Informational.
Invariant campaign: 512 runs × depth 200 = **102,400 handler calls, 0 invariant breaks**.

## 6. Sample market book

130 markets, catalogue in `frontend/src/data/markets.ts` (id, vertical, question, criteria, source,
probability, depth, hours to settle, volume, topic).

| Vertical | Markets | Example markets |
| --- | --- | --- |
| Crypto & macro | 26 | BTC above $90k this week · spot ETH ETF inflows > $500M · Fed cut at the next FOMC |
| Global politics | 26 | Republicans hold the House · US government shutdown this quarter · Ukraine ceasefire signed |
| Sports & F1 | 28 | Celtics win tonight · Arsenal beat Chelsea · Verstappen wins the next GP · McLaren constructors' title |
| Esports | 24 | T1 beat KOI at Worlds · European roster wins the CS2 Major · Sentinels win 2:0 |
| AI & tech frontiers | 26 | Frontier lab ships a GPT-5-class model · Nvidia beats consensus · Starship reaches orbit |
| **Total** | **130** | simulated depth and volume, quoted with the real CPMM formula |

## 7. Brand assets

| File | Size | Use |
| --- | --- | --- |
| `assets/banner.png` | 1280×400 | GitHub README header |
| `assets/banner.svg` | vector | anywhere a scalable banner is needed |
| `assets/logo.svg` | 512×512 | mark only, transparent |
| `frontend/public/favicon.svg` | 64×64 | browser tab |
| `frontend/public/apple-touch-icon.png` | 512×512 | iOS home screen |
| `frontend/public/og.png` | 1200×630 | Open Graph / X card |

All of them are generated from one source of truth: `frontend/scripts/gen_brand_assets.py`. The mark
(hexagonal shield + oracle eye) is drawn once in `frontend/src/components/BrandLogo.tsx` and reused by the
header, the favicon, the banner and the share poster.

## 8. Generated evidence

| Path | What |
| --- | --- |
| `reports/shots/01-risk-modal.png` | first-run compliance surface |
| `reports/shots/02-welcome-airdrop.png` | 10,000 FAKE-USDC bonus, mid animation |
| `reports/shots/03-hall-paper.png` | hall, paper mode, featured markets |
| `reports/shots/04-hall-paper-full.png` | full-page hall |
| `reports/shots/05-demo-detail.png` | sample market detail with paper panel |
| `reports/shots/06-mobile-home.png` | 390×844 mobile layout |
| `docs/security/slither-report.json` | raw Slither output |
