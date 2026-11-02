/**
 * Genesis Predictor Season 1 — copy for the loyalty ledger.
 *
 * Wording rules: every claim here is checkable against `lib/points.ts` (rules) or the engine's
 * events (volume). No promise of a token, no date that has not been announced.
 */
export const genesis = {
  eyebrow: "Genesis Season 1",
  title: "Genesis Predictor Season 1",
  window: "1 Nov – 31 Dec 2026 · points accrue to season close",
  yourPoints: "Your Aura Points",
  pointsUnit: "pts",
  rank: "Rank {{rank}} of {{total}}",
  unranked: "No on-chain fills yet — your first settled trade puts you on the board.",
  connectHint: "Connect a wallet to score on-chain volume.",
  checkIn: "Check in · +{{points}}",
  checkedIn: "Checked in today",
  streak: "{{days}}-day streak",
  breakdownTitle: "Where your points come from",
  breakdownTrade: "On-chain volume",
  breakdownTradeValue: "{{usdc}} USDC → {{points}} pts",
  breakdownCheckin: "Daily check-ins",
  breakdownCheckinValue: "{{count}} × {{points}} pts",
  breakdownTake: "Debate takes",
  breakdownTakeValue: "{{count}} × {{points}} pts",
  breakdownInvite: "Referral rebate",
  breakdownInviteValue: "20% of the 1.5% fee, settled on-chain",
  rulesTitle: "How points accrue",
  ruleTrade: "1 point per 10 USDC of on-chain notional. Paper fills do not score.",
  ruleCheckIn: "25 points per UTC day, tracked as a streak.",
  ruleTake: "40 points per debate take you publish, counted once each.",
  ruleInvite: "150 points per invitee whose first on-chain fill settles through your ref link.",
  boardTitle: "Live standings",
  boardNote: "Volume read directly from SharesBought / SharesSold — nobody self-reports.",
  boardEmpty: "The board opens with the first on-chain fill.",
  boardYou: "you",
  inviteTitle: "Invite a trader, keep 20% of the fee",
  inviteBody:
    "Every link carries your ref code. When an invited trader fills on-chain, ReferralLedger accrues 20% of the 1.5% protocol fee to you in USDC. It settles on-chain once a ledger is configured — until then the invite desk shows the local estimate and says so.",
  inviteCta: "Open the invite desk",
  close: "Close",
  disclaimer:
    "Season 1 points are a loyalty ledger, not a token. No airdrop is promised, scheduled or guaranteed; points are intended to inform a future community allocation if one is ever made.",
} as const;
