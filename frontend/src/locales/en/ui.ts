/** Shared UI atoms: countdown, probability bar, loader, empty states, spinner. */
export const ui = {
  countdown: {
    expired: "Expired",
  },
  loader: {
    connecting: "Connecting to Base mainnet…",
  },
  wordmark: {
    subtitle: "AI prediction markets · Base",
  },
  toast: {
    explorerLink: "View on Basescan →",
  },
  empty: {
    fallbackTitle: "Nothing here yet",
  },
} as const;
