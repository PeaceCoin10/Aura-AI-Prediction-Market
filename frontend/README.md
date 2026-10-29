# Aura Prediction Market — Frontend

Single-page dApp for the Aura prediction markets on **Base mainnet** (chain id 8453). It talks to the
`CentralPredictionEngine` contract, where one contract hosts many markets, and it imports the SDK
directly from `../sdk/CentralPredictionSDK.ts` through the `@sdk` Vite alias — the SDK is never copied
into this package, so quote maths, calldata encoding and log decoding have a single source of truth.

## Deployed contracts (Base mainnet)

| Role | Address |
| --- | --- |
| `CentralPredictionEngine` | `0xE6056Bc6700F6d7E6fF8779B212655284dc1631C` |
| `ProtocolFeeVault` | `0x29dE563f3059827D00837305FAE2Bbc87c7D9eE1` |
| USDC (native Base, 6 decimals) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

## Stack

- Vite 5 + React 18 + TypeScript 5 (strict, `tsc --noEmit` clean)
- TailwindCSS 3 for styling
- `viem` for RPC reads (`fallback` transport over several public endpoints) and log decoding
- `@tanstack/react-query` for cache/refresh orchestration
- `qrcode`, imported lazily, only when a share poster is generated

## Running it

```bash
cd frontend
npm install
cp .env.example .env     # defaults already point at Base mainnet
npm run dev              # http://localhost:5173
```

Production build and local preview:

```bash
npm run build            # output in frontend/dist
npm run preview
npm run typecheck        # tsc --noEmit
```

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_ENGINE_ADDRESS` | `0xE605…631C` | Engine address; point it at your anvil deployment when testing locally |
| `VITE_USDC_ADDRESS` | `0x8335…2913` | Collateral token (use `MockUSDC` on a local chain) |
| `VITE_RPC_URL` | `https://base-rpc.publicnode.com,https://1rpc.io/base,https://mainnet.base.org` | Comma-separated read endpoints, tried in order |

Reads go through public RPCs; writes always go through the user's wallet (`eth_sendTransaction`).
The frontend never touches a private key.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on `0.0.0.0:5173` |
| `npm run build` / `preview` | Production bundle / serve it |
| `npm run typecheck` | TypeScript check, no emit |
| `npm run smoke` | `scripts/smoke.py` — read-only mainnet smoke test: first paint text, console errors, failed requests |
| `npm run e2e` | `scripts/e2e_local.py` — full local flow against anvil with an injected fake wallet (real transactions) |
| `npm run e2e:ui` | `scripts/e2e_ui.py [url]` — headless UI suite: onboarding, hall, paper trading, overlays, mobile |

The Python scripts drive Playwright; `e2e_local.py` needs anvil plus a deployed engine (see
`../docs/DEVELOPMENT.md`).

## What the app does

- **Wallet connect / network switch** — EIP-6963 discovery of injected wallets; switches to Base and
  falls back to `wallet_addEthereumChain` when the wallet does not know the chain.
- **Market hall** — `marketCount()` → `marketId(i)` → one Multicall3 `marketSnapshots(ids)` call for the
  whole page, refreshed on a timer. Category navigation groups on-chain categories into six sections.
- **Trading** — dual quotes: an offline CPMM preview for instant feedback, then the on-chain
  `previewBuy` / `previewSell` to correct it. Slippage presets 0.5% / 1% / 3% (1% default); price impact
  is shown live and a second confirmation appears at 80% of the contract's 5% impact cap.
- **Portfolio** — per-market share balances plus USDC balance; redemption is disabled (with a
  countdown) while the one-hour post-resolution dispute window is open.
- **Live activity feed** — incremental `eth_getLogs` polling every 8s, decoded with the SDK's
  `decodeLogs`, rendered as toasts plus an expandable event list.
- **Create market** — the panel is available to the deployer EOA, which holds `CREATOR` on mainnet.
- **Paper trading** — a local 10,000 FAKE-USDC balance (`src/lib/paper.ts`) priced with the same SDK
  formulas, so paper quotes match on-chain maths without sending a transaction.
- **AI insights** — reads `public/insights.json` produced by the `hermes/` brain, with a rule-based
  fallback in the UI when no fresh entry matches.
- **Share posters** — 1200×630 canvas image (question, side, probability, payout, QR code) with PNG
  download, X intent and copy-to-clipboard.
- **Debate wall** — per-market comments with YES/NO/neutral stance, stored in `localStorage`.
- **Security and docs overlays** — audit summary, dispute mechanics, verified contract links, an
  integration guide, plus an RPC/brain health indicator.
- **Localisation** — every string lives in `src/locales/en` as a typed tree; adding a locale is one
  module that satisfies `Messages` plus a `registerLocale()` call (`src/lib/i18n.tsx`).

## Project layout

```
frontend/
├── index.html
├── vite.config.ts             @sdk alias → ../sdk/CentralPredictionSDK.ts; parent dir allowed for fs access
├── tailwind.config.js
├── scripts/                   smoke.py, e2e_local.py, e2e_ui.py, asset/market-art generators
└── src/
    ├── main.tsx               Toast provider → App
    ├── App.tsx                hall / portfolio / activity views, detail overlay, connect modal
    ├── index.css              Tailwind layers plus card/button/input primitives
    ├── data/markets.ts        curated demo markets used as the empty-state fallback
    ├── locales/en/            typed message tree, one file per surface
    ├── lib/
    │   ├── config.ts          chain id, addresses, RPC list, slippage presets, impact thresholds
    │   ├── sdk.ts             public client (fallback transport), SDK transport, block-time cache
    │   ├── wallet.tsx         EIP-6963 discovery, chain switch, sendTransaction, USDC approval
    │   ├── paper.ts           paper portfolio, quotes and impact (SDK formulas)
    │   ├── share.ts           canvas poster and share intents
    │   ├── nav.ts / demo.ts   category grouping and demo-market fallback
    │   └── events.ts          event labels and market state machine
    ├── hooks/                 useMarkets, usePortfolio, useEventFeed, useComments, useHealth, useToasts
    └── components/            header, cards, trade panel, portfolio, activity, overlays, share, social
```

## Implementation notes

- A trade plan without a `minSharesOut` is rejected by the SDK (`local/MIN_OUT_REQUIRED`); the UI only
  exposes slippage presets, never a raw minimum.
- The per-trade cap is dynamic: `min(maxBet, depth × 5%)`. The UI reports "5% of depth" rather than the
  contract's absolute ceiling.
- `resolved && !finalized` means the dispute window is still open and `redeem` would revert, so the
  button is disabled instead of letting the user pay gas for a failing transaction.
- Public RPCs rate-limit; the default list has three endpoints and `viem`'s fallback rotates on failure.
- Block timestamps are cached for 8 seconds — asking per build makes `getBlock` the dominant RPC cost.
- Events are polled with `eth_getLogs` rather than filters, because `eth_newFilter` expires on public
  endpoints.

## Known limitations

- Injected wallets only (EIP-6963 / `window.ethereum`); no WalletConnect relay.
- Client-side SPA: no SSR or SEO, and no deep link such as `?market=<id>`.
- Admin/oracle actions (`buildResolveMarket`, `buildOverrideResolution`) exist in the SDK but are not
  exposed as UI controls; only their events are visible.
- Public RPC endpoints will not carry a large number of markets; use a dedicated node or paid provider
  beyond roughly a hundred active markets.
