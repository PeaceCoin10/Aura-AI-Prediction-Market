/**
 * `content` namespace — market copy and data-layer strings.
 *
 * Owns:
 *   - demo market questions and their objective resolution criteria (keyed by market id,
 *     the same ids the UI uses when seeding the debate wall);
 *   - seeded debate-wall posts (cold-start prompts, flagged as official topics);
 *   - local insight commentary templates (rule engine output, never passed off as the brain);
 *   - on-chain event labels plus feed/toast bodies;
 *   - market lifecycle phases and outcome wording;
 *   - poster + share copy, and the error strings surfaced by the paper engine,
 *     the wallet layer and the formatting helpers.
 *
 * Templates use `{{var}}` and are rendered with `format()` from `lib/i18n`.
 * Nothing here is fetched or mutated at runtime — it is a static message tree.
 */

export type SeedStance = "YES" | "NO" | "NEUTRAL";

/** Uniform seed shape, so `Object.entries` over the seeded threads stays typed. */
const seed = (author: string, stance: SeedStance, text: string) => ({ author, stance, text });

export const content = {
  /** Demo markets: the question a user reads, plus the criteria that settles it. */
  demoMarkets: {
    "demo-btc-88k": {
      question: "Will BTC break $88,000 within 24 hours?",
      criteria:
        "Resolves YES if the BTC/USD spot price at settlement is ≥ $88,000 (CoinGecko primary, Binance fallback); otherwise NO.",
    },
    "demo-eth-etf": {
      question: "Will a spot ETH ETF post more than $500M of single-day net inflows this week?",
      criteria:
        "Resolves YES if official flow data from Farside / SoSoValue shows any single day of net inflows above $500M.",
    },
    "demo-defi-tvl": {
      question: "Will total DeFi TVL reclaim $120B within 48 hours?",
      criteria: "Resolves YES if the all-chain TVL snapshot at settlement is ≥ $120B per DefiLlama.",
    },
    "demo-fed-cut": {
      question: "Will the Fed explicitly mention a rate cut in the next FOMC statement?",
      criteria:
        "Resolves YES if the FOMC statement published on the Federal Reserve website contains any reference to a rate cut; otherwise NO.",
    },
    "demo-ceasefire": {
      question: "Will at least two major outlets confirm a ceasefire deal this week?",
      criteria:
        "Resolves YES if at least two of Reuters, AP and BBC report the ceasefire independently before settlement; a single wire story republished does not count as a second outlet.",
    },
    "demo-ai-act": {
      question: "Will the EU AI Act implementing rules enter into force this month?",
      criteria:
        "Resolves YES only if the text is published in the Official Journal (OJ); Commission approval without OJ publication resolves NO.",
    },
    "demo-nba-celtics": {
      question: "Will the Boston Celtics beat the Brooklyn Nets in tonight's NBA game?",
      criteria:
        "Settles on the official ESPN final score (overtime included): Celtics win → YES; loss or tie → NO; postponed more than 24 hours → INVALID and refunded.",
    },
    "demo-epl-derby": {
      question: "Will Arsenal beat Chelsea in this Premier League round?",
      criteria:
        "Settles on the official Premier League final score (stoppage time included): Arsenal win → YES; draw or loss → NO.",
    },
    "demo-nfl-chiefs": {
      question: "Will the Kansas City Chiefs win on the road?",
      criteria: "Settles on the official NFL final score: Chiefs win → YES; tie or loss → NO.",
    },
    "demo-lol-t1": {
      question: "Will T1 beat Movistar KOI in the Worlds knockout stage?",
      criteria:
        "Settles on the official LoL Esports result (gameWins): T1 takes the series → YES; otherwise NO.",
    },
    "demo-cs2-major": {
      question: "Will the European region win more than 60% of its matches in the CS2 Major group stage?",
      criteria: "Per official HLTV event stats: Europe's win rate at settlement above 60% → YES; otherwise NO.",
    },
    "demo-valorant": {
      question: "Will Sentinels win their next VCT match 2:0?",
      criteria: "Per the official VCT result: exactly 2:0 → YES; any other scoreline → NO.",
    },
  },

  /**
   * Seeded debate-wall posts. Cold-start filler for the built-in demo markets only,
   * labelled as official topics in the UI — never passed off as real users.
   */
  seedComments: {
    "demo-btc-88k": [
      seed("0xWhale", "YES", "ETF inflows keep stacking. 88k is a matter of time, and 24h is plenty."),
      seed("Satoshi_Cat", "NO", "There is a fat liquidation wall at 86k. It does not get through."),
    ],
    "demo-eth-etf": [
      seed("defi_researcher", "YES", "If a staking ETF clears, $500M in a single day is nothing."),
    ],
    "demo-fed-cut": [
      seed("MacroHound", "NO", "Dot plot is still hawkish. The statement will not use the word cut."),
      seed("Bond_Trader", "YES", "Inflation prints rolled over. Odds of softer language are already 40%."),
    ],
    "demo-nba-celtics": [
      seed("courtside_vet", "YES", "Home court against a team on a back-to-back. Not close."),
    ],
    "demo-lol-t1": [
      seed("RiftAnalyst", "YES", "T1's draft prep is deeper. The BO5 experience gap is real."),
      seed("KOI_faithful", "NO", "This patch favors KOI's early tempo. Upset incoming."),
    ],
  },

  /** Local rule-engine commentary. Only uses pool state: probability, depth, volume, time left. */
  insights: {
    flavor: {
      crypto: "on-chain flow",
      news: "the news wire",
      tech: "the tech narrative",
      sports: "the sports book",
      esports: "the esports meta",
      fallback: "the book",
    },
    crowded:
      "YES is already at {{prob}}% — the long side is extremely crowded. Buying here means the odds no longer favor you; one large sell can print a double-digit drawdown.",
    edge:
      "Longs hold a slight edge at {{prob}}%, but {{flavor}} has not given a decisive signal yet — scale in rather than taking one shot.",
    neutral:
      "Probability is pinned at {{prob}}%, dead center of the neutral band: both sides are waiting for new information. Liquidity providers are most comfortable here; takers get whipsawed both ways.",
    fade:
      "Shorts lead marginally (YES {{prob}}%). This is a cheap-but-needs-a-catalyst structure — only a small reversal bet has the right payoff.",
    priced:
      "YES is down to {{prob}}% — the market has priced this outcome almost completely. Barring a black-swan reversal in {{flavor}}, there is little left in the residual.",
    thinPool: " Pool depth is only {{depth}} USDC, so 100 USDC moves the price — mind the impact cost.",
    heavyVolume: " Volume ({{vol}} USDC) is already {{multiple}}x pool depth — turnover is heavy.",
    closingSoon: " Less than 1 hour to settlement — once the dispute window opens, withdrawals are locked.",
    finalHours: " {{hours}} hours to settlement; the final stretch usually carries the most volatility.",
    basis: "Prob {{prob}}% · Depth {{depth}} USDC · Vol {{vol}} USDC",
  },

  /** Event names as shown on toasts and the activity feed. */
  eventLabels: {
    MarketCreated: "Market created",
    MarketCategoryUpdated: "Category updated",
    LiquiditySeeded: "Liquidity seeded",
    SharesBought: "Buy filled",
    SharesSold: "Sell filled",
    MarketResolved: "Market resolved",
    DisputeWindowOpened: "Dispute window opened",
    ResolutionOverridden: "Resolution overridden",
    ResolutionFinalized: "Resolution finalized",
    Redeemed: "Redemption paid",
    ResidualSwept: "Residual swept",
    FeeVaultUpdated: "Fee vault updated",
    TreasuryUpdated: "Treasury updated",
    CreatorUpdated: "Creator permission changed",
    OracleUpdated: "Oracle permission changed",
    Paused: "Protocol paused",
    Unpaused: "Protocol resumed",
    AdminTransferStarted: "Admin transfer started",
    AdminTransferred: "Admin transferred",
  },

  /** Feed / toast bodies. `{{var}}` is substituted from decoded event args. */
  eventFeed: {
    createdTitle: "{{label}}: {{question}}",
    createdBody: "Category {{category}} · settles {{when}}",
    liquidityBody: "{{amount}} USDC seeded into the pool",
    tradeTitle: "{{label}} · {{outcome}}",
    buyBody: "Paid {{amount}} USDC → received {{shares}} shares (fee {{fee}})",
    sellBody: "Sold {{shares}} shares → received {{amount}} USDC",
    resolvedTitle: "{{label}}: {{outcome}}",
    resolvedBody: "1h dispute window — Safe can override",
    resolvedBodyEmergency: "Emergency refund path",
    disputeBody: "Dispute window until {{when}}; redemptions locked while it runs",
    overrideTitle: "{{label}}: {{from}} → {{to}}",
    overrideBody: "Outcome overridden {{count}} times",
    redeemedBody: "Payout {{payout}} USDC (burned YES {{yes}} / NO {{no}})",
    pausedBody: "Trading and redemptions paused (emergency withdrawal window excepted)",
  },

  /** Resolution wording, shared by the feed and the market cards. */
  outcomes: {
    yesWins: "YES wins",
    noWins: "NO wins",
    invalid: "Invalid (0.5 paid per share)",
  },

  /** Market lifecycle labels; keys mirror `MarketPhase`. */
  phase: {
    trading: "Trading",
    awaiting: "Awaiting resolution",
    disputing: "In dispute window",
    final: "Finalized",
    closed: "Closed",
    empty: "Not found",
  },

  /** Paper-trading failures, shown inline next to the trade button. */
  paper: {
    amountPositive: "Amount must be greater than 0",
    insufficientBalance: "Insufficient paper balance — claim your 10,000 FAKE-USDC first",
    noShares: "This amount buys no shares — pool too thin or amount too small",
    noPosition: "No paper position on this market",
    exceedsPosition: "Sell size exceeds your position",
    depthTooThin: "Current depth cannot absorb this sell",
  },

  /** Wallet errors surfaced through the connect flow. */
  wallet: {
    noProvider: "No wallet extension detected — install MetaMask or Coinbase Wallet",
    noAccounts: "Wallet returned no accounts",
    notConnected: "Wallet not connected",
    fallbackName: "Browser wallet",
    hookOutsideProvider: "useWallet must be used inside <WalletProvider>",
  },

  mode: {
    hookOutsideProvider: "useMode must be used inside <ModeProvider>",
  },

  /** Shared formatting strings. */
  format: {
    expired: "Expired",
    unknownError: "Unknown error",
    dayUnit: "d",
  },

  /** Slippage preset hints. */
  slippage: {
    conservative: "Conservative",
    default: "Default",
    aggressive: "Aggressive",
  },

  /** Share poster + X intent copy. */
  poster: {
    tagline: "AGENTIC DEFI · AI PREDICTION MARKETS",
    modePaper: "Paper",
    modeReal: "Live",
    sideNeutral: "Watching",
    sideBet: "Bet {{side}}",
    probLabel: "Current YES probability",
    returnLabel: "Potential return",
    scanQr: "Scan to open market",
    footer: "Base mainnet · contracts verified · 1h dispute window · 1.5% trade fee",
    canvasUnavailable: "Canvas unavailable",
    tweetLeadNeutral: "Watching",
    tweetLeadBet: "Betting {{side}}",
    tweet: '{{lead}} "{{question}}" | YES at {{prob}}%{{potential}} #AIPredictionMarkets #Base #Aura',
    tweetPotential: ", potential return {{ret}}",
  },
};
