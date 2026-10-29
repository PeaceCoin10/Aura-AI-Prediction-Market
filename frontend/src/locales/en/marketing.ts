/**
 * `marketing` namespace — social proof surfaces (leaderboard, trade ticker), the novice prize pool
 * and the hall spotlight.
 *
 * Honesty contract: the leaderboard cohort and the sample ticker are simulations. Every string here
 * must make that unmistakable — no invented "real users", no fake wallet counts.
 */
export const marketing = {
  board: {
    title: "Top predictors",
    badge: "simulated cohort",
    season: "sample book · {{volume}}k volume",
    colPredictor: "predictor",
    colTrades: "trades",
    colHit: "hit",
    colPnl: "PnL (fake)",
    footnote:
      "Ranked from the sample book, not real accounts: 0 live wallets, {{fills}} on-chain fills since deploy. Every number here is simulated FAKE-USDC.",
  },
  ticker: {
    title: "Live fills",
    sample: "sample stream",
    live: "live",
    hint: "simulated book · refreshes every 7s",
  },
  spotlight: {
    eyebrow: "AI desk · spotlight",
    title: "130 markets. Six verticals. One curve.",
    body: "Politics, crypto, sport, esports and frontier tech — priced by the same constant-product market maker that settles on Base.",
    cta: "Browse the full book",
  },
  pool: {
    eyebrow: "Novice pool · season 1",
    title: "You are in the prize pool",
    body: "Every new predictor joins the same 25,000 FAKE-USDC pool. Your share grows each time you take a side — settled locally, never real money.",
    share: "Your share",
    joined: "{{count}} predictors joined this season",
    cta: "Start predicting",
    footnote: "Simulated pool. Chips are local, non-withdrawable and carry no monetary value.",
  },
} as const;
