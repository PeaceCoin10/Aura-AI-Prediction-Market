<p align="center">
  <img src="assets/banner.png" alt="Aura — agentic prediction markets on Base" width="100%" />
</p>

<h1 align="center">Aura</h1>

<p align="center">
  <b>An agentic prediction market.</b> An AI writes the markets, a constant-product market maker prices them,
  and a dispute window settles them — on Base mainnet, in USDC.
</p>

<p align="center">
  <a href="https://github.com/PeaceCoin10/Aura-AI-Prediction-Market/actions"><img alt="tests" src="https://img.shields.io/badge/test%20suite-250%20passing-34d399?style=flat-square&logo=githubactions&logoColor=white" /></a>
  <a href="https://basescan.org/address/0xE6056Bc6700F6d7E6fF8779B212655284dc1631C#code"><img alt="Base mainnet verified" src="https://img.shields.io/badge/Base%20mainnet-verified-0052FF?style=flat-square&logo=base&logoColor=white" /></a>
  <img alt="active markets" src="https://img.shields.io/badge/active%20markets-130-34d399?style=flat-square" />
  <img alt="simulated volume" src="https://img.shields.io/badge/sample%20volume-9.7M%20USDC-0f172a?style=flat-square" />
  <img alt="locales" src="https://img.shields.io/badge/i18n-EN%20%C2%B7%20extensible-22d3ee?style=flat-square" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-0f172a?style=flat-square" />
</p>

<p align="center">
  <a href="https://peacecoin10.github.io/Aura-AI-Prediction-Market/"><img alt="Open the app" src="https://img.shields.io/badge/%E2%96%B6%20OPEN%20THE%20APP-trade%20130%20markets-34d399?style=for-the-badge&labelColor=05060a" /></a>
</p>

<p align="center">
  <sub>130 sample markets across politics, crypto, sport, esports and frontier tech · 10,000 FAKE-USDC on arrival · no wallet needed to look around</sub>
</p>

<p align="center">
  <a href="https://peacecoin10.github.io/Aura-AI-Prediction-Market/"><b>Live app →</b></a> ·
  <a href="#the-cold-start-problem-solved-mechanically">Why</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#contracts">Contracts</a> ·
  <a href="#economics">Economics</a> ·
  <a href="#quickstart">Quickstart</a> ·
  <a href="#sdk">SDK</a> ·
  <a href="#security">Security</a> ·
  <a href="#deploy">Deploy</a>
</p>

---

## The cold-start problem, solved mechanically

Prediction markets die on a three-way chicken-and-egg: no markets means no traders, no traders means no
liquidity, no liquidity means no markets. Most teams answer that with incentives. Aura answers it with software.

| Problem | Mechanism | Where |
| --- | --- | --- |
| **Who writes the markets?** | A Hermes agent cycle polls CoinGecko/Binance, RSS, ESPN and LoL Esports every 5 minutes and drafts a binary market with an explicit resolution rule | `hermes/hermes_brain.py`, `hermes/verticals.py` |
| **Who prices them?** | A constant-product market maker on-chain — `p_yes = noReserve / (yesReserve + noReserve)`. No order book, no market maker to hire | `src/CentralPredictionEngine.sol` |
| **Who settles them?** | Price markets: 3×30s sampling to resist wicks. Sports/esports: official results only. News: **never auto-resolved** — routed to a Safe | `OracleEngine` |
| **What about first-time users?** | Paper mode: 10,000 FAKE-USDC credited on arrival, 130 sample markets across six verticals, quoted with the same CPMM maths and settled locally | `frontend/src/lib/paper.ts` |
| **Can settlement be gamed?** | 1-hour dispute window after resolution, withdrawals locked, Safe multisig can override | `DISPUTE_WINDOW = 1 hours` |
| **Can the admin run away?** | After 7 days unsettled, anyone can call `emergencyRefund` for a full refund | `REFUND_DELAY = 7 days` |

> **AI supplies the content, the AMM supplies the liquidity, the dispute window supplies the correction,
> and paper trading supplies the users.**

---

## Architecture

```mermaid
flowchart TB
  subgraph Brain["Hermes agent · Python"]
    CR["Crypto feed<br/>CoinGecko + Binance"]
    NW["News feed<br/>RSS"]
    SP["Sports feed<br/>ESPN scoreboard"]
    ES["Esports feed<br/>LoL Esports"]
    PL["Planner<br/>vertical rotation + dedupe"]
    CR --> PL
    NW --> PL
    SP --> PL
    ES --> PL
  end

  PL -->|createMarketWithMeta| ENG
  PL -->|seedLiquidity| ENG
  PL -->|resolve after sampling| ENG

  subgraph Base["Base mainnet · chain 8453"]
    ENG["CentralPredictionEngine<br/>CPMM · 1.5% trade fee"]
    VLT["ProtocolFeeVault<br/>0.5% settlement fee · Safe-gated"]
    USDC["USDC"]
    ENG -->|fees| VLT
    ENG <--> USDC
  end

  subgraph Client["Client"]
    SDK["CentralPredictionSDK<br/>Multicall3 · offline quotes · log decoding"]
    UI["Aura dApp<br/>Real + Paper · AI takes · debate wall"]
    SDK --> UI
  end

  UI -->|read: 1 multicall per refresh| ENG
  UI -->|write: user wallet signs| ENG
  SDK --> ENG
  VLT -->|withdraw requires Safe| TRE["Treasury"]
```

<details>
<summary>ASCII version</summary>

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Aura · Agentic prediction market                                            │
│                                                                              │
│   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐               │
│   │   Creator    │      │    Oracle    │      │ Distribution │               │
│   │ market draft │      │ sample/result│      │ share cards  │               │
│   └──────┬───────┘      └──────┬───────┘      └──────┬───────┘               │
│          └──────────── Hermes agent (5 min) ─────────┘                       │
│                                    │ cast / RPC                              │
│                                    ▼                                         │
│   ┌───────────────────────────────────────────────────────────────┐          │
│   │  CentralPredictionEngine (Solidity 0.8.24, CPMM, 1.5% fee)    │          │
│   │  createMarket · buyShares · sellShares · resolve · redeem     │          │
│   └───────────────┬───────────────────────────────┬───────────────┘          │
│                   │ 0.5% settlement               │ 1.5% trade              │
│                   ▼                               ▼                          │
│          ┌──────────────────┐          ┌────────────────────┐               │
│          │ ProtocolFeeVault │◀─────────│   USDC (Base)      │               │
│          └──────────────────┘          └────────────────────┘               │
│                   ▲                                                          │
│   ┌───────────────┴───────────────┐        ┌──────────────────────────┐      │
│   │  CentralPredictionSDK (TS)    │◀──────▶│  dApp (Vite + React)     │      │
│   │  Multicall3 · offline quotes  │        │  Real / Paper · AI takes │      │
│   └───────────────────────────────┘        └──────────────────────────┘      │
└──────────────────────────────────────────────────────────────────────────────┘
```
</details>

---

## Contracts

Base mainnet · chainId **8453** · settled in USDC (6 decimals)

| Contract | Address | Status | Verification |
| --- | --- | --- | --- |
| `CentralPredictionEngine` | [`0xE6056Bc6700F6d7E6fF8779B212655284dc1631C`](https://basescan.org/address/0xE6056Bc6700F6d7E6fF8779B212655284dc1631C#code) | live | Etherscan V2 API, exact match, solc 0.8.24, MIT |
| `ProtocolFeeVault` | [`0x29dE563f3059827D00837305FAE2Bbc87c7D9eE1`](https://basescan.org/address/0x29dE563f3059827D00837305FAE2Bbc87c7D9eE1#code) | live | same |
| `USDC` | [`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`](https://basescan.org/address/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) | — | canonical token |

Constructor arguments — reproducible, no proxy, no upgrade path:

```
CentralPredictionEngine(usdc, feeVault, admin, creator)
  = (0x8335…2913, 0x29dE…9eE1, 0x436b…5Ba1, 0x436b…5Ba1)

ProtocolFeeVault(usdc, admin, treasury)
  = (0x8335…2913, 0x436b…5Ba1, 0x436b…5Ba1)
```

Source check that does not trust this README:

```bash
curl -s "https://api.etherscan.io/v2/api?chainid=8453&module=contract&action=getsourcecode\
&address=0xE6056Bc6700F6d7E6fF8779B212655284dc1631C&apikey=$ETHERSCAN_API_KEY" \
  | jq -r '.result[0].ContractName'
# → CentralPredictionEngine
```

Bytecode/source consistency is also `exact_match` on Sourcify (1798 B / 13196 B, differing only in immutable slots).

---

## Economics

### Price is a reserve ratio

Each market holds two USDC reserves: `Y` (YES) and `N` (NO). **The price of YES is the NO share of the pool.**

```
p_yes = N / (Y + N)        p_no = Y / (Y + N)        p_yes + p_no = 1
```

Buying YES grows `Y`, which raises `p_yes` — the same intuition as betting odds, without needing a counterparty.

### What one buy gets you

The 1.5% fee is taken first, then the net amount moves the curve while `Y·N` is held (approximately) constant:

```
fee    = ceil(amountIn × 150 / 10000)          // 1.5%, rounded up in the protocol's favour
net    = amountIn − fee
Y'     = ceil(Y × N / (N + net))                // YES reserve consumed by the buy
shares = net + (Y − Y')                         // shares are USDC-denominated, 6 decimals
```

Selling mirrors it: shares are burned, reserves restored, proceeds net of the fee. Every quote can be computed
**offline** — `previewBuyOffline` / `previewSellOffline` in the SDK are wei-for-wei identical to the on-chain
path, which is what makes paper trading honest rather than a mock.

### Where the money goes

| Flow | Rate | Destination |
| --- | --- | --- |
| Trade fee | 1.5% of notional | `ProtocolFeeVault` |
| Settlement fee | 0.5% of the losing side | `ProtocolFeeVault` |
| Vault withdrawal | — | requires a Safe signature |
| Emergency | after 7 days unsettled | `emergencyRefund` → full refund to holders |

---

## Quickstart

```bash
git clone https://github.com/PeaceCoin10/Aura-AI-Prediction-Market.git
cd Aura-AI-Prediction-Market

# contracts
forge test                                              # 46 tests

# SDK (offline unit tests, no RPC needed)
cd sdk && npm install && npm test && cd ..               # 70 tests

# agent
python3 -m unittest discover -s hermes -p 'test_*.py'    # 49 tests

# dApp
cd frontend && npm install && npm run dev
# → http://127.0.0.1:5173   paper mode by default: 10,000 FAKE-USDC, no wallet
```

End-to-end suites:

```bash
cd frontend
python3 scripts/e2e_ui.py        # 55 headless UI assertions
python3 scripts/shots.py         # regenerate README screenshots
python3 scripts/e2e_local.py     # 11 real-chain assertions against anvil (see docs)
```

<details>
<summary>Screenshots (generated by <code>scripts/shots.py</code>)</summary>

| | |
| --- | --- |
| ![Market hall](reports/shots/03-hall-paper.png) | ![Novice pool](reports/shots/02b-novice-pool.png) |
| Market hall — 130 sample markets, artwork, live ticker and leaderboard | Novice pool — the second beat of onboarding |

</details>

---

## SDK

```ts
import { CentralPredictionSDK, SLIPPAGE_NORMAL, parseUsdc } from "@sdk";

// The SDK is transport-agnostic: you hand it one `eth_call` function.
const sdk = new CentralPredictionSDK(
  { ethCall: (to, data) => publicClient.call({ to, data }).then((r) => r.data!) },
  { engine: "0xE6056Bc6700F6d7E6fF8779B212655284dc1631C", chainId: 8453, account },
);

// One RPC round-trip for the whole board (Multicall3 aggregate3, 4 views per market)
const count = await sdk.marketCount();
const ids = await Promise.all([...Array(count).keys()].map((i) => sdk.marketId(i)));
const markets = await sdk.marketSnapshots(ids, { withMeta: true });

// Offline quote — identical maths to the contract, zero RPC
const shares = previewBuyOffline(markets[0], 1, parseUsdc("25"));

// Real trade: the plan is preflighted locally before anything is signed
const plan = await sdk.buildBuyShares({
  marketId: markets[0].marketId,
  outcome: 1,                        // 0 = NO, 1 = YES  (contract order — not UI order)
  amountIn: parseUsdc("25"),
  slippageBps: SLIPPAGE_NORMAL,      // 1%: a hard 1…500 bps bound, never "0"
});
await wallet.sendTransaction({ to: plan.to, data: plan.data });

// Decode what actually happened
const events = sdk.decodeReceiptLogs(receipt.logs);
```

Full API tables: [`docs/CENTRAL-SDK-GUIDE.md`](docs/CENTRAL-SDK-GUIDE.md).

> **Outcome encoding caveat:** the contract uses `0 = NO, 1 = YES`; the UI's side index is the reverse
> (`0 = YES`). The mapping lives in exactly one place — `frontend/src/lib/paper.ts` — and is covered by tests.

---

## Distribution: Telegram Mini App

The dApp is the Mini App — the same bundle runs in a browser and inside a Telegram chat.

| Surface | Implementation |
| --- | --- |
| Host chrome | `frontend/src/lib/telegram.ts` reads `themeParams`, exposes them as `--tg-theme-*`, pushes the app background into `setHeaderColor` / `setBackgroundColor` so the nav bar never flashes white |
| Layout | `initTelegram()` pins the shell to `viewportStableHeight`, applies `safeAreaInset` + `contentSafeAreaInset`, disables vertical swipes and bumps form fields to 16px so iOS does not zoom |
| Back button | the host Back button is bound to the open sheet (market detail / affiliate panel) via `bindBackButton` |
| Deep links | every market card, market detail and share modal renders a **Telegram** button: `https://t.me/<bot>/app?startapp=market_<id>` |
| Referral links | `?startapp=ref_<address>` survives the Telegram hop and is captured by the referral provider |
| Haptics | `haptic("tap" / "success")` on copy and fill actions, silent outside the host |

Set `VITE_TG_BOT` (and optionally `VITE_TG_APP`) to your registered bot to mint links for it.

## Zero-friction entry: social login + sponsored gas (ERC-4337)

No extension, no seed phrase, no ETH on Base.

- **Google / email login** — the connect modal offers both. `loginWithSocial()` opens the Web3Auth
  modal and returns an EIP-1193 provider plus the smart-account address; the wallet context
  registers it as a normal provider, so approval, trading and log decoding all reuse the same path.
- **Paymaster** — set `VITE_PAYMASTER_URL` (Pimlico / Biconomy / Alchemy) and `VITE_BUNDLER_URL`; they
  are handed to Web3Auth as `bundlerConfig` / `paymasterConfig`, which wraps every
  `eth_sendTransaction` in a sponsored user operation. `gaslessReady()` is the switch; without it
  the same account behaves as a plain EOA, and the UI says so instead of failing at signing time.

Builds without credentials still work: both integrations are lazily imported, so nothing is
downloaded and no button lies about what it can do.

## Affiliate program (real attribution, real payouts)

1. **Capture** — `?ref=0x…` or `startapp=ref_0x…`; the first referrer wins and is persisted in
   `localStorage` (`frontend/src/lib/referral.tsx`).
2. **Attribution** — each attributed order appends `"auraref1" || referrer` to its calldata. Solidity
   decoders stop at the declared parameters, so the engine fills the trade exactly as if the tag were
   absent — proven by `testReferralTagDoesNotDisturbTheOrder` — while the indexer can recover the
   referrer from the transaction input.
3. **Settlement** — `hermes/referral_indexer.py` reads the engine's `SharesBought` / `SharesSold`
   events, recovers the tag, and calls `ReferralLedger.accrue()` as the operator. Rebate is 20% of
   the 1.5% trading fee, deduplicated per trade id.
4. **Payout** — `ReferralLedger.claim()` transfers USDC from the rebate pool. The affiliate drawer
   shows the invite link, invites opened, attributed volume, and — once `VITE_REFERRAL_LEDGER` is
   set — the on-chain claimable balance with a working Claim button.

```bash
python3 hermes/referral_indexer.py                      # dry run: what would be credited
REFERRAL_OPERATOR_KEY=0x… python3 hermes/referral_indexer.py --post --ledger 0x…
```

The ledger is **not deployed yet** (the deploy script is ready: `script/DeployReferralLedger.s.sol`).
Until it is, the drawer labels its numbers as a local estimate and renders no claim button.

## Growth bot: X (Twitter)

`hermes/x_marketing_bot.py` ranks the catalogue by volume-per-hour-left, writes a sub-280-character
post leading with the live probability, renders a 1200×675 poster in the dApp's visual language, and
queues both as JSONL.

```bash
python3 hermes/x_marketing_bot.py --limit 3      # queue + render, no credentials needed
X_USER_ACCESS_TOKEN=… python3 hermes/x_marketing_bot.py --post   # publish what it queued
python3 hermes/x_marketing_bot.py --loop 3600 --limit 1          # one post an hour
```

Without credentials it prints `[dry]` and never claims a tweet went out.

---

## Security

| Layer | Result |
| --- | --- |
| Static analysis (Slither 0.10.0) | **0 High, 0 Medium**, 12 Low (`block.timestamp`, intended), 7 Informational |
| Invariant testing | 512 runs × depth 200 = **102,400 handler calls, 0 invariant breaks** |
| Unit + integration | 62 forge tests (46 engine + 16 referral ledger) |
| Settlement | 3×30s sampling for price markets; official results only for sports/esports; news never auto-resolves |
| Dispute | 1-hour window, withdrawals locked, Safe multisig can override resolution |
| Escape hatch | after 7 days unsettled → permissionless `emergencyRefund` |

Raw Slither JSON: [`docs/security/slither-report.json`](docs/security/slither-report.json).
**No audit has been performed.** Static analysis is not an audit.

---

## Deploy

Live now at **https://peacecoin10.github.io/Aura-AI-Prediction-Market/** (GitHub Pages, HTTPS, permanent).

```bash
# permanent static host, one command each
GITHUB_TOKEN=ghp_xxx ./deploy/gh-pages.sh       # → https://<owner>.github.io/<repo>/   (default)
VERCEL_TOKEN=xxx     ./deploy/vercel.sh         # → https://<project>.vercel.app
NETLIFY_TOKEN=xxx    ./deploy/netlify.sh --build # → https://<site>.netlify.app (pure REST, no CLI)

# publish this repo to GitHub with a PAT (no browser session needed)
GITHUB_TOKEN=ghp_xxx ./scripts/github_push.sh   # add --force to rewrite remote history
```

`deploy/gh-pages.sh` builds with `--base=/<repo>/`, publishes an orphan `gh-pages` branch (with `404.html`
and `.nojekyll`), enables Pages over REST, polls until the build is live, then verifies the page **and** the
hashed bundle return 200.

CI runs from [`.github/workflows/ci.yml`](.github/workflows/ci.yml) on every push to `main` and every
pull request: contracts (forge + invariant stress), SDK (TypeScript), agent (unittest), dApp
(typecheck + build + headless UI e2e). A `public_repo`-only PAT is refused for workflow files by
design, so the file was published over an SSH deploy key instead; day-to-day pushes need nothing
special.

Both hosts build the whole repo (`cd frontend && npm run build`), so the `@sdk` path alias resolves.
The agent is a long-running Python process — it is not part of the static deployment.

Guides: [`docs/GITHUB-PUSH.md`](docs/GITHUB-PUSH.md) · [`docs/DEPLOY-PERMANENT.md`](docs/DEPLOY-PERMANENT.md) ·
[`docs/ASSETS.md`](docs/ASSETS.md)

---

## Repository layout

```
src/                Solidity: engine, fee vault, referral ledger, CPMM library
test/               forge tests + invariant handlers (62)
sdk/                TypeScript SDK (Multicall3, offline quotes, log decoding)
hermes/             agent: planners, verticals, insights, referral indexer, X bot
frontend/           dApp (Vite + React + Tailwind + viem)
  src/locales/en/   message tree — one namespace per surface
deploy/             gh-pages / vercel / netlify / tunnel / basescan verification
scripts/            github_push + repo tooling
docs/               engineering notes, security matrix, deploy guides
assets/             brand: logo, banner
```

---

## Roadmap

- [ ] Fund the agent wallet (≥100 USDC) so it seeds markets on mainnet automatically
- [ ] Deploy `ReferralLedger` on Base and fund the rebate pool (script + 16 tests are ready)
- [ ] Move the debate wall off `localStorage` (indexer or on-chain)
- [ ] Hand `admin` to a Safe multisig (currently a single EOA)
- [ ] Independent audit
- [ ] More locales — the i18n runtime is namespace-based; add one file under `frontend/src/locales/`

---

## Disclaimer

Aura is experimental software. Markets are resolved by an oracle with a dispute window; the operator can
override a resolution during that window. Nothing here is investment advice. Prediction shares can go to
zero. Use only what you can afford to lose, and check that prediction markets are legal where you live.

<p align="center"><sub>MIT licensed · built on Base · the AI writes, the curve prices, the chain settles</sub></p>
