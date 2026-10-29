/**
 * Portfolio, on-chain activity feed, market creation.
 *
 * These surfaces are real-money surfaces: every label has to be unambiguous about
 * what is on-chain (shares, balances, dispute windows) versus what is presentation.
 */
export const portfolio = {
  positions: {
    title: "Positions",
    connectTitle: "Connect a wallet to see positions",
    connectHint:
      "Positions live in the engine's on-chain ERC-1155 ledger (yesOf / noOf). Nothing is cached locally.",
    usdcBalance: "USDC balance",
    unsettled: "Unsettled (shares)",
    sharesUnit: "shares",
    redeemable: "Redeemable markets",
    marketsUnit: "markets",
    disputingUnit: "· {{count}} in dispute",
    disputeTitle: "{{count}} market in the 1-hour dispute window",
    disputeTitlePlural: "{{count}} markets in the 1-hour dispute window",
    disputeBody:
      "The Safe can still overturn the outcome during the 1-hour dispute window, so withdrawals are locked. Redeem opens once the countdown ends or someone calls",
    readingShares: "Reading sharesOf…",
    emptyTitle: "No positions yet",
    emptyHint: "Pick a market in the Hall and buy YES / NO — fills land on-chain immediately.",
    groupRedeemable: "Redeemable",
    groupDisputing: "In dispute",
    groupOpen: "Open",
    untitled: "(untitled market)",
    yesPrice: "YES {{price}}",
    settles: "Settles {{time}}",
    disputeLabel: "Dispute",
    redeem: "Redeem",
    locked: "Locked",
    lockedTitle: "Not redeemable during the dispute window",
    trade: "Trade",
  },
  activity: {
    title: "On-chain event feed",
    subtitle: "SDK decodeLogs parses raw logs · incremental eth_getLogs every 8s",
    error: "Log fetch failed: {{error}}",
    emptyTitle: "No events captured yet",
    emptyHint:
      "If the engine has had no market creations or fills since deploy, the log is empty. The first createMarket / SharesBought shows up here in real time.",
    txLink: "View transaction →",
    decodeTitle: "decodeLog(args)",
  },
  create: {
    open: "+ New market",
    title: "New market",
    subtitle:
      "marketId = keccak256(question|category|timestamp). Requires the CREATOR role; immutable once it is on-chain.",
    questionLabel: "Question (8–280 bytes)",
    questionPlaceholder: "e.g. Will BTC break $81,000 within 24 hours?",
    categoryLabel: "Category",
    hoursLabel: "Resolution window (hours)",
    seedLabel: "Seed liquidity (USDC, optional)",
    cancel: "Cancel",
    submit: "Create",
    noWallet: "Connect a wallet first",
    submittedTitle: "Market creation submitted",
    seededTitle: "Liquidity seeding submitted",
    seededBody: "Seeded {{amount}} USDC",
    liveTitle: "Market live",
    failedTitle: "Market creation failed",
  },
} as const;
