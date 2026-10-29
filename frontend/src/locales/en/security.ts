/**
 * `security` namespace — the overlay surfaces rendered by
 * `src/components/Overlays.tsx`: the first-run risk disclosure modal, the
 * security matrix drawer and the docs portal.
 *
 * This block is a compliance surface. Wording stays literal and unambiguous —
 * it is a risk disclosure, not marketing. Every figure here is a real result
 * from this repository (see `docs/SECURITY.md`); never round or restate them
 * as ranges.
 *
 * Templates use `{{var}}` and are rendered with `format()` from `lib/i18n`.
 */
export const security = {
  common: {
    close: "Close",
  },

  /** First-run risk acknowledgement. Shown once, keyed by `aura.risk.ack.v1`. */
  risk: {
    title: "Risk disclosure and terms of use",
    bulletProtocol:
      "Aura is a decentralised prediction market protocol. It is not an investment adviser and nothing here constitutes investment advice.",
    bulletPrice:
      "Share prices are set by an AMM curve and can go to zero. Only commit USDC you can afford to lose.",
    bulletDispute:
      "Settlement carries a 1-hour dispute window. Withdrawals are closed during it, and the Safe multisig can overturn the outcome inside that window.",
    bulletPaper:
      "Paper mode runs on local virtual chips. No real assets are involved and chips cannot be redeemed.",
    bulletAudit:
      "The contracts are open source and verified on Base mainnet, but no audit can guarantee zero risk.",
    consent:
      "By continuing you confirm that you have read and accept these terms, and that your jurisdiction permits participation in products of this kind.",
    ack: "I understand the risk — enter markets",
  },

  /** Security matrix drawer: Slither, invariants, dispute window, Safe override. */
  drawer: {
    title: "Security matrix",
    slither: {
      title: "Static analysis · Slither",
      high: "High",
      medium: "Medium",
      low: "Low",
    },
    tests: {
      title: "Test matrix",
      forgeLead: "forge test — ",
      forgeTail: " tests green (unit + invariant)",
      invariantLead: "Invariant testing: ",
      invariantRunsDepth: " runs × depth ",
      invariantCallsLead: ", ",
      invariantTail:
        " handler calls executed (≈12,800 per selector across 8 selectors), 0 reverts, 0 invariant breaks",
      coverage: "SDK: 70/70 offline cases · frontend: 11/11 live-chain e2e + 55/55 UI e2e",
    },
    economics: {
      title: "Economic and governance controls",
      feeLead: "Fees: ",
      feeTail: " — all of it routes to ProtocolFeeVault; withdrawals need a Safe signature",
      disputeLead: "Dispute window: ",
      disputeTail: ", opening the moment a market resolves; withdrawals stay closed for the duration",
      overrideLead: "Override: ",
      emergencyLead: "Emergency: ",
      emergencyWindow: "7 days",
      emergencyMid: " after the settlement time anyone can call ",
      emergencyTail: " for a full refund",
    },
    verified: {
      title: "Verified contracts (Base mainnet)",
      badge: "✓ Verified",
    },
  },

  /** Docs portal: getting started, AI architecture, SDK integration. */
  docs: {
    title: "Docs portal",
    tabs: {
      start: "Getting started",
      brain: "Hermes AI architecture",
      sdk: "SDK integration",
    },

    start: {
      headingPaper: "Zero to position in 3 seconds (no wallet)",
      paperSteps: [
        "Switch the top-right toggle to Paper → claim 10,000 chips.",
        "Pick any market in the hall and buy YES or NO — shares, average price and price impact are computed live.",
        "The position panel tracks unrealised PnL in real time; selling settles straight back to your balance.",
      ],
      headingReal: "Live trading",
      realSteps: [
        "Switch to Real → connect a wallet (it switches to Base, chain 8453).",
        "Pick a market → enter a USDC amount → the first trade needs an approve, which the panel handles for you.",
        "A toast returns the transaction hash; open it on Basescan.",
        "Once a market resolves it enters a 1-hour dispute window; redeem opens when the window closes.",
      ],
      headingFees: "Fees and settlement",
      feesBody:
        "1.5% is taken on trades and 0.5% on settlement payouts. Price = NO reserve / total reserve, and a single trade is hard-capped at 5% of pool depth.",
    },

    brain: {
      headingEngines: "Three engines, one loop",
      creator: "Creator",
      creatorBody:
        ": multi-venue ingest (CoinGecko/Binance, RSS news, ESPN scoreboard, LoL Esports) → YES/NO binary questions → market creation with market-making liquidity",
      oracle: "Oracle",
      oracleBody:
        ": price markets take 3×30s multi-sample reads to resist wicks; sports and esports resolve only on official results; news markets are never auto-settled — they wait for the Safe or a manual call",
      marketing: "Marketing",
      marketingBody:
        ": every new market gets Twitter / Telegram copy from a template engine, with an optional LLM pass",
      headingConstraints: "Hard constraints on question writing",
      constraintsBody:
        "Binary framing (will it / won't it), settlement 30 minutes to 8 days out, and an objective resolution criterion. Anything else is discarded.",
      headingCommentary: "Commentary",
      commentaryLead:
        "Each cycle the brain writes commentary on real markets into ",
      commentaryTail:
        "; the frontend polls every 60 seconds. When the brain is offline the frontend falls back to its rule engine and labels the output Local inference.",
    },

    sdk: {
      headingInstall: "Install and connect",
      headingRead: "Read markets (one Multicall3)",
      headingOrder: "Place an order",
      footnote:
        "Offline quoting ships in the SDK as previewBuyOffline / previewSellOffline, aligned with on-chain previewBuy to the wei; decodeLogs turns raw events into structured notifications.",
    },
  },
} as const;
