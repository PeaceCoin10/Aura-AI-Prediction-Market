/** Hall (feed tab) copy: hero, stat strip, section headers, empty states, paper bar. */
export const hall = {
  heroTitleA: "AI prediction markets",
  heroTitleB: "with a brain that writes its own order book",
  heroBody:
    "Hermes drafts markets every five minutes from live crypto, news, sports and esports feeds. Pricing is a constant-product market maker on Base — one Multicall3 read per refresh, 15-second cadence.",
  statsPaper: {
    featured: "Featured markets",
    cadence: "Tick cadence",
    cadenceValue: "7s",
    volume: "Simulated volume",
    chain: "On-chain markets",
  },
  statsReal: {
    chain: "On-chain markets",
    active: "Trading",
    liquidity: "Pool liquidity",
    featured: "Featured markets",
  },
  paperBar: {
    label: "Paper trading",
    balance: "Balance",
    hint: "No wallet needed — 12 featured markets, live simulated ticks, AI takes and the debate wall are all running.",
    hintCount:
      "No wallet needed — {{count}} featured markets, live simulated ticks, AI takes and the debate wall are all running.",
  },
  sections: {
    featuredTitle: "Featured markets",
    featuredBadge: "Off-chain · fully tradable",
    featuredNote: "Simulated ticks every 7s · quotes reuse the real CPMM math",
    chainTitle: "Live on-chain markets",
    chainNote:
      "CentralPredictionEngine is deployed and unpaused, but no market has been seeded yet. The Hermes brain needs USDC in its wallet to create and seed markets.",
    chainEmptyTitle: "No on-chain markets yet",
    chainEmptyBody:
      "Everything below is a featured market: same CPMM maths, same trade flow — just settled locally so you can go from zero to a position in seconds.",
    demoEmptyTitle: "Nothing in this vertical yet",
    demoEmptyHint: "Switch back to Trending or pick another vertical.",
    refreshFailed: "Refresh failed — showing the last good snapshot:",
  },
  portfolio: {
    title: "Portfolio",
    subtitle: "Positions are the engine's internal yesOf / noOf ledger (ERC-1155 semantics); withdraw with redeem().",
  },
  connect: {
    title: "Connect a wallet",
    body:
      "EIP-6963 discovery covers every injected wallet — MetaMask, Coinbase, Rabby, any EOA. Connecting prompts a switch to Base mainnet (8453).",
    empty:
      "No wallet extension detected. Install MetaMask or Coinbase Wallet and reload — or trade the featured markets above with paper chips.",
    connecting: "Connecting…",
    failed: "Connection failed",
  },
  paused:
    "Protocol is paused: new trades are rejected. Only settlement and post-dispute withdrawals are processed.",
} as const;
