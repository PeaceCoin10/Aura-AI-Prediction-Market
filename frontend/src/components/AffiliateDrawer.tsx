import { useEffect, useState } from "react";
import { encodeFunctionData } from "viem";
import { REFERRAL_LEDGER_ABI, referralLink, useReferral } from "../lib/referral";
import { REFERRAL_LEDGER, hasReferralLedger } from "../lib/config";
import { shareToTelegram, referralDeepLink } from "../lib/telegram";
import { useWallet } from "../lib/wallet";
import { publicClient } from "../lib/sdk";
import { usdc } from "../lib/format";

/**
 * Affiliate panel.
 *
 * Three layers, deliberately separated so nothing here overstates what exists:
 *  1. attribution — the `?ref=` / `startapp=ref_` code captured by ReferralProvider (browser-local);
 *  2. on-chain settlement — ReferralLedger.accrued(referrer) once the ledger is deployed and the
 *     indexer has written the attributed trades this address generated;
 *  3. payout — ReferralLedger.claim(), which is a real USDC transfer from the rebate pool.
 *
 * Without VITE_REFERRAL_LEDGER the panel shows the local estimate and says so; it never renders a
 * claim button that cannot settle.
 */
export function AffiliateDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useReferral();
  const wallet = useWallet();
  const [copied, setCopied] = useState<"link" | "tg" | null>(null);
  const [onchain, setOnchain] = useState<{ claimable: bigint; pool: bigint } | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);

  const address = wallet.account ?? null;
  const link = address ? referralLink(address) : `${window.location.origin}${import.meta.env.BASE_URL}?ref=0x…`;
  const tgLink = address ? referralDeepLink(address) : link;
  const ledgerReady = hasReferralLedger();

  /* Read the referrer's settled balance straight from the ledger. */
  useEffect(() => {
    if (!open || !address || !ledgerReady) return;
    let alive = true;
    void (async () => {
      try {
        const [claimable, pool] = await Promise.all([
          publicClient.readContract({
            address: REFERRAL_LEDGER as `0x${string}`,
            abi: REFERRAL_LEDGER_ABI,
            functionName: "claimable",
            args: [address],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: REFERRAL_LEDGER as `0x${string}`,
            abi: REFERRAL_LEDGER_ABI,
            functionName: "poolBalance",
          }) as Promise<bigint>,
        ]);
        if (alive) setOnchain({ claimable, pool });
      } catch {
        if (alive) setOnchain(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, address, ledgerReady, claimMsg]);

  const copy = async (value: string, kind: "link" | "tg") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  };

  const claim = async () => {
    if (!address || !ledgerReady) return;
    setClaiming(true);
    setClaimMsg(null);
    try {
      const data = encodeFunctionData({ abi: REFERRAL_LEDGER_ABI, functionName: "claim" });
      const hash = await wallet.sendTransaction({ to: REFERRAL_LEDGER as `0x${string}`, data });
      await publicClient.waitForTransactionReceipt({ hash });
      setClaimMsg("Rebate claimed — USDC is in your wallet.");
    } catch (e) {
      setClaimMsg(e instanceof Error ? e.message : "Claim failed.");
    } finally {
      setClaiming(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="affiliate-drawer">
      <button aria-label="Close affiliate panel" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <aside className="glass-panel relative h-full w-full max-w-md overflow-y-auto p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-brand/80">Affiliate</div>
            <h2 className="mt-1 text-lg font-semibold text-slate-100">Earn 20% of the protocol fee</h2>
          </div>
          <button onClick={onClose} className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-slate-400">
            Close
          </button>
        </div>

        <p className="mt-2 text-[11.5px] leading-relaxed text-slate-400">
          Share your link. Every trade it attributes pays you 20% of the 1.5% trading fee, straight from the
          protocol&apos;s cut.
        </p>

        <div className="mt-4 space-y-2">
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
            <div className="text-[9.5px] uppercase tracking-wide text-slate-500">Your invite link</div>
            <div className="mono mt-1 break-all text-[11px] text-slate-300">{link}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                data-testid="copy-invite"
                onClick={() => copy(link, "link")}
                className="rounded-lg border border-brand/30 bg-brand/10 px-2.5 py-1 text-[10.5px] font-medium text-brand"
              >
                {copied === "link" ? "Copied" : "Copy link"}
              </button>
              <button
                onClick={() => copy(tgLink, "tg")}
                className="rounded-lg border border-sky-400/30 bg-sky-400/10 px-2.5 py-1 text-[10.5px] text-sky-300"
              >
                {copied === "tg" ? "Copied" : "Copy Telegram link"}
              </button>
              <button
                onClick={() => shareToTelegram(tgLink, "Trade AI-written prediction markets on Base — 130 markets live.")}
                className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10.5px] text-slate-300"
              >
                Share
              </button>
            </div>
            {!address && (
              <div className="mt-2 text-[10px] text-amber-300/80">
                Connect a wallet to mint your personal link — until then the address slot stays empty.
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
              <div className="mono text-lg text-slate-100">{ref.invites}</div>
              <div className="text-[9.5px] uppercase tracking-wide text-slate-500">Invites opened</div>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
              <div className="mono text-lg text-slate-100">{ref.volumeUsdc.toLocaleString()}</div>
              <div className="text-[9.5px] uppercase tracking-wide text-slate-500">Attributed volume</div>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
              <div className="mono text-lg text-brand">{ref.rebateUsdc.toLocaleString()}</div>
              <div className="text-[9.5px] uppercase tracking-wide text-slate-500">Est. rebate (USDC)</div>
            </div>
          </div>

          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
            <div className="flex items-center justify-between">
              <div className="text-[9.5px] uppercase tracking-wide text-slate-500">On-chain balance</div>
              <span className="mono text-[9.5px] text-slate-600">
                pool {onchain ? `${usdc(onchain.pool)} USDC` : "—"}
              </span>
            </div>
            <div className="mt-1 flex items-end justify-between gap-2">
              <div className="mono text-xl text-brand" data-testid="claimable">
                {ledgerReady ? (onchain ? `${usdc(onchain.claimable)} USDC` : "…") : "Ledger not deployed"}
              </div>
              {ledgerReady && (
                <button
                  data-testid="claim-rebate"
                  onClick={claim}
                  disabled={claiming || !onchain || onchain.claimable === 0n}
                  className="rounded-lg border border-brand/30 bg-brand/10 px-3 py-1.5 text-[11px] font-medium text-brand disabled:opacity-40"
                >
                  {claiming ? "Claiming…" : "Claim"}
                </button>
              )}
            </div>
            {claimMsg && <div className="mt-1.5 text-[10.5px] text-slate-400">{claimMsg}</div>}
            {ledgerReady && onchain && onchain.claimable > 0n && onchain.claimable > onchain.pool && (
              <div className="mt-1.5 text-[10px] text-amber-300/80">
                The rebate pool is being topped up — the claim settles as soon as it covers your balance.
              </div>
            )}
          </div>

          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3 text-[10.5px] leading-relaxed text-slate-500">
            {ref.referrer ? (
              <>
                You arrived through <span className="mono text-slate-300">{ref.referrer.slice(0, 6)}…{ref.referrer.slice(-4)}</span>.
                Their address travels with your real orders as calldata metadata.
              </>
            ) : (
              <>No referrer captured on this browser yet.</>
            )}
            <div className="mt-1.5 text-slate-600">
              {ledgerReady
                ? "Invites and volume above are local to this device; the on-chain balance is settled by the ReferralLedger."
                : "Invites and volume above are local to this device. On-chain payout switches on once ReferralLedger is deployed and VITE_REFERRAL_LEDGER is set."}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
