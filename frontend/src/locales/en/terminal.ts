/**
 * Terminal surface copy — the global headline carousel, the whale-flow tape, the live depth
 * chart and the cloud-sync status chip.
 *
 * Kept in its own namespace so the institutional-terminal layer can be reviewed (and
 * translated) without touching the hall, trading or onboarding copy.
 */
export const terminal = {
  locale: {
    label: "Language",
    hint: "Interface language",
    current: "Active language",
    saved: "Language preference saved",
  },
  hero: {
    eyebrow: "Global headlines",
    title: "Where the world is pricing tomorrow",
    body: "Live probability across geopolitics, central banks, frontier tech, esports and culture.",
    previous: "Previous story",
    next: "Next story",
    pause: "Pause rotation",
    play: "Resume rotation",
    slide: "{{index}} / {{total}}",
    probability: "YES",
    move: "{{delta}} over the last hour",
    cta: "Open the book",
    depth: "{{amount}} USDC depth",
    settling: "Settles in {{hours}}h",
  },
  whale: {
    title: "Whale flow",
    hint: "$25k+ tickets · Binance spot",
    sample: "Simulated tape",
    live: "Live tape",
    bought: "bought",
    sold: "sold",
    ago: "{{mins}}m ago",
    justNow: "just now",
    note: "Real exchange prints, not fills on this book.",
  },
  depth: {
    title: "Market depth",
    yes: "YES book",
    no: "NO book",
    price: "Mid price",
    sweep: "Fill for {{amount}}",
    capacity: "Depth",
    unit: "USDC",
    levels: "{{count}} levels",
    axis: "Price",
  },
  sync: {
    title: "Cloud sync",
    local: "Local only",
    ready: "Ready to sync",
    syncing: "Syncing",
    synced: "Synced",
    error: "Sync failed",
    connectWallet: "Connect a wallet to sync",
    body: "Paper balance, positions, trade history, referral ledger and debate takes follow your wallet across devices. The payload is sealed with AES-GCM under a key derived from your signature before it leaves the browser.",
    lastSync: "Last sync {{time}}",
    push: "Push now",
    pull: "Pull now",
    device: "This device",
    cipher: "AES-GCM · wallet-derived key",
    provider: "Provider",
  },
} as const;
