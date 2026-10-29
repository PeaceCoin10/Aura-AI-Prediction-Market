/**
 * `trade` namespace — on-chain market detail and the real trading panel
 * (`src/components/MarketDetail.tsx`, `src/components/TradePanel.tsx`).
 *
 * Copy is crypto-native and terse: venue vocabulary (depth, impact, slippage,
 * CPMM) over consumer phrasing, no exclamation marks. Numbers, fees and
 * windows are contract facts and must match the engine, not be rounded.
 *
 * Templates use `{{var}}` and are rendered with `format()` from `lib/i18n`.
 */
export const trade = {
  common: {
    close: "Close",
  },

  /** Market detail sheet: header chips, on-chain data table, settlement rules. */
  market: {
    onChainChip: "On-chain market",
    settlesPrefix: "Settles ",
    inPrefix: "in ",
    untitled: "Untitled market",
    shareFallbackQuestion: "AI prediction market",
    dataTitle: "Market data (read directly on-chain)",
    yesProb: "YES probability",
    noProb: "NO probability",
    yesReserve: "YES reserve",
    noReserve: "NO reserve",
    cash: "Pool cash",
    owed: "Total owed",
    volume: "Cumulative volume",
    tradable: "Tradable",
    yes: "Yes",
    no: "No",
    status: "Settlement status",
    statusFinalized: "Finalized",
    statusDispute: "In dispute",
    statusUnresolved: "Unresolved",
    outcome: "Outcome",
    rulesTitle: "Rules",
    rulePricing:
      "Price = NO reserve / total reserve. Trades run through the CPMM, and a single order is hard-capped at 5% of pool depth.",
    ruleFees: "A 1.5% fee is taken from trade notional; a 0.5% fee is taken from settlement payouts.",
    ruleDispute:
      "Resolution opens a 1-hour dispute window. The Safe (admin) can overturn the outcome, and withdrawals are closed throughout.",
    ruleEmergency:
      "If a market is still unresolved 7 days past its settlement time, anyone can call emergencyRefund for a full refund.",
  },

  /** Trade panel: quote strip, dispute banner, redeem block, order form, confirm dialog. */
  panel: {
    poolDepth: "Pool depth",
    disputeLeft: "Dispute ends in",
    settlesIn: "Settles in",
    finalized: "Finalized",
    awaitingFinalize: "Awaiting finalize",

    disputeTitle:
      "Inside the 1-hour dispute window. The Safe can still overturn the outcome and withdrawals are closed.",
    disputeBodyLead: "Dispute closes in ",
    disputeBodyMid:
      ", then finalizes automatically — anyone can call ",
    disputeBodyTail: " to write the finalization event.",

    position: "Your position",
    redeemTitleClosed: "Withdrawals are closed during the dispute window",
    redeemDispute: "Withdrawals closed during dispute",
    redeemReady: "Redeem winnings",
    redeemEmpty: "No redeemable position",
    redeemNote:
      "Settlement fee 0.5%. An INVALID market pays 0.5 USDC per YES and per NO share. While the protocol is paused, forced withdrawal unlocks 7 days after the settlement time.",

    buyShares: "Buy shares",
    sellShares: "Sell shares",
    amountInLabel: "USDC in",
    sellLabel: "Shares to sell",
    sellable: " (max {{amount}})",
    unitUsdc: "USDC",
    unitShares: "Shares",
    max: "Max",

    slippage: "Slippage",
    capHint: "Per-trade cap ≈ {{amount}} USDC (5% of depth)",

    quoteReceive: "You receive",
    quoteReturn: "You get back",
    quoteChain: "· on-chain quote",
    quoteOffline: "· offline estimate",
    unitSharesSuffix: " shares",
    avgFill: "Average fill",
    pricePerShare: "USDC/share",
    priceImpact: "Price impact",
    impactCap: " / 5% cap",
    tradingFee: "Trading fee",
    feeOnChain: " (deducted on-chain)",
    protectedPrice: "Protected price",
    protectedPriceValue: "{{amount}} (-{{slip}})",
    impactWarnLead: "Impact is at 80% of the cap (SDK warning ",
    impactWarnMid: "). A larger order is rejected by ",
    impactWarnTail: " — size down or split the order.",

    submitSettled: "Market settled",
    submitClosed: "Trading closed",
    buy: "Buy {{side}}",
    sell: "Sell {{side}}",
    connectToTrade: "Connect a wallet to trade",

    confirmTitle: "Price impact near the hard cap",
    confirmBodyLead: "The SDK returned ",
    confirmBodyMid: " — this order takes ",
    confirmBodyTail:
      "% of pool depth (contract cap 5%). The fill will be materially worse and it moves real funds.",
    confirmReduce: "Reduce the size",
    confirmProceed: "Execute anyway",

    footerUsdc: "USDC",
    footerEngine: "Engine",
    footerNote: "on-chain settlement, irreversible",
  },

  /** Toast titles and bodies emitted while a transaction is in flight. */
  toasts: {
    allowanceChecking: "Checking USDC allowance",
    allowanceBody: "spender = CentralPredictionEngine",
    submitted: "Transaction submitted, awaiting confirmation…",
    reverted: "Transaction reverted (status = reverted)",
    confirmedEvent: "Confirmed on-chain: {{event}}",
    confirmed: "Confirmed on-chain",
    tradeFailed: "Trade failed",
    connectFirst: "Connect a wallet first",
    amountRequired: "Enter an amount",
    redeemSubmitted: "Redemption submitted",
    redeemConfirmed: "Redemption confirmed",
    redeemFailed: "Redemption failed",
  },
} as const;
