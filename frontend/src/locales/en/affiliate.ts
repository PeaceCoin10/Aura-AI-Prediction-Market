/**
 * Affiliate / referral panel copy.
 *
 * The panel separates three things that must never blur: browser-local attribution, the settled
 * on-chain balance, and the payout. Every string here keeps that distinction explicit.
 */
export const affiliate = {
  eyebrow: "Affiliate",
  title: "Earn 20% of the protocol fee",
  body: "Share your link. Every trade it attributes pays you 20% of the 1.5% trading fee, straight from the protocol's cut.",
  close: "Close",
  closeAria: "Close affiliate panel",
  explorerTitle: "Genesis Explorer",
  explorerPhase: "Early access",
  explorerBody: "The rebate pool is not funded yet — that is the genesis phase, not an error. Your link already works: invites, points and attribution all accrue before a single dollar moves.",
  explorerPoint1: "Aura Points accrue from real on-chain fills, daily check-ins and published takes.",
  explorerPoint2: "Rebate entitlements are recorded on-chain by the indexer as trades settle.",
  explorerPoint3: "The pool opens when external flow or a market maker funds it; claims then pay out in USDC.",
  explorerCta: "Copy invite link",
  explorerClaimNote: "Claims open with the pool",
  inviteLabel: "Your invite link",
  copy: "Copy link",
  copyTg: "Copy Telegram link",
  copied: "Copied",
  share: "Share",
  shareText: "Trade AI-written prediction markets on Base — 255 markets live.",
  connectHint: "Connect a wallet to mint your personal link — until then the address slot stays empty.",
  invites: "Invites opened",
  volume: "Attributed volume",
  rebate: "Est. rebate (USDC)",
  onchain: "On-chain balance",
  pool: "pool {{amount}} USDC",
  ledgerMissing: "Ledger not deployed",
  claim: "Claim",
  claiming: "Claiming…",
  claimed: "Rebate claimed — USDC is in your wallet.",
  claimFailed: "Claim failed.",
  poolTopping: "The rebate pool is being topped up — the claim settles as soon as it covers your balance.",
  arrived: "You arrived through {{addr}}. Their address travels with your real orders as calldata metadata.",
  noReferrer: "No referrer captured on this browser yet.",
  noteReady: "Invites and volume above are local to this device; the on-chain balance is settled by the ReferralLedger.",
  noteLocal:
    "Invites and volume above are local to this device. On-chain payout switches on once ReferralLedger is deployed and VITE_REFERRAL_LEDGER is set.",
};
