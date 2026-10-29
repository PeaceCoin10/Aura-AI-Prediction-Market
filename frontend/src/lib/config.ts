import { en } from "../locales/en";

/** Global config: Base mainnet + the deployed CentralPredictionEngine */

export const CHAIN_ID = 8453;
export const CHAIN_ID_HEX = "0x2105";

/** Mainnet deployment of 2026-10-27 (see docs/MAINNET-DEPLOYED.md) */
export const ENGINE_ADDRESS = (
  import.meta.env.VITE_ENGINE_ADDRESS ?? "0xE6056Bc6700F6d7E6fF8779B212655284dc1631C"
) as `0x${string}`;

/** Base native USDC (6 decimals) */
export const USDC_ADDRESS = (
  import.meta.env.VITE_USDC_ADDRESS ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
) as `0x${string}`;

export const USDC_DECIMALS = 6;

/** Public RPCs (override with VITE_RPC_URL, comma-separated for several) */
export const RPC_URLS: string[] = (
  import.meta.env.VITE_RPC_URL ??
  "https://base-rpc.publicnode.com,https://1rpc.io/base,https://mainnet.base.org"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const EXPLORER = "https://basescan.org";

export const SLIPPAGE_PRESETS = [
  { label: "0.5%", bps: 50n, hint: en.content.slippage.conservative },
  { label: "1%", bps: 100n, hint: en.content.slippage.default },
  { label: "3%", bps: 300n, hint: en.content.slippage.aggressive },
] as const;

/** Matches the contract's MAX_IMPACT_BPS = 500; the SDK raises impact_near_limit from 400 (80%) */
export const MAX_IMPACT_BPS = 500n;
export const IMPACT_WARN_BPS = 400n;

export const CATEGORIES = ["crypto", "macro", "sports", "tech", "politics", "general"] as const;

/**
 * ReferralLedger: accrues and pays affiliate rebates (20% of the 1.5% trading fee).
 * Unset until the ledger is deployed for this chain — the affiliate panel then shows accrual
 * without offering a claim button, instead of pretending a payout exists.
 */
export const REFERRAL_LEDGER = (import.meta.env.VITE_REFERRAL_LEDGER ?? "") as `0x${string}` | "";

export function hasReferralLedger(): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(REFERRAL_LEDGER);
}

/** Share of the trading fee paid to the referrer, mirrors ReferralLedger.rebateBps() */
export const REBATE_SHARE = 0.2;
/** Protocol trading fee, mirrors CentralPredictionEngine.TRADE_FEE_BPS */
export const TRADE_FEE = 0.015;
