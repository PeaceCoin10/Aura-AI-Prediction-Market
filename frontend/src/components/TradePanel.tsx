import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  OUTCOME_NO,
  OUTCOME_YES,
  SLIPPAGE_CONSERVATIVE,
  SLIPPAGE_DEGEN,
  SLIPPAGE_NORMAL,
  SdkError,
  decodeRevert,
  formatUsdc,
  parseUsdc,
  previewBuyOffline,
  previewSellOffline,
  priceYesOffline,
  type Hex,
  type MarketSnapshot,
  type Outcome,
  type TxPlan,
} from "@sdk";
import { EXPLORER, IMPACT_WARN_BPS, MAX_IMPACT_BPS, USDC_ADDRESS } from "../lib/config";
import { bps, errText, pct, toProb, usdc } from "../lib/format";
import { publicClient, makeSdk } from "../lib/sdk";
import { useWallet } from "../lib/wallet";
import { useToasts } from "../hooks/useToasts";
import { format, useT } from "../lib/i18n";
import { tagOrderData, useReferral } from "../lib/referral";
import { Countdown, ProbabilityBar, Spinner } from "./ui";

type Side = "buy" | "sell";

const SLIPPAGES = [
  { bps: SLIPPAGE_CONSERVATIVE, label: "0.5%" },
  { bps: SLIPPAGE_NORMAL, label: "1%" },
  { bps: SLIPPAGE_DEGEN, label: "3%" },
] as const;

interface QuoteState {
  sharesOut?: bigint;
  amountOut?: bigint;
  source: "chain" | "offline";
  error?: string;
  loading: boolean;
}

export function TradePanel({
  market,
  holding,
  onDone,
}: {
  market: MarketSnapshot;
  holding?: { yes: bigint; no: bigint };
  onDone: () => void;
}) {
  const t = useT();
  const { account, ensureUsdcAllowance, sendTransaction } = useWallet();
  const { push } = useToasts();
  const { referrer, addVolume } = useReferral();
  const [side, setSide] = useState<Side>("buy");
  const [outcome, setOutcome] = useState<Outcome>(OUTCOME_YES);
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState<bigint>(SLIPPAGE_NORMAL);
  const [quote, setQuote] = useState<QuoteState>({ source: "offline", loading: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const [warnOpen, setWarnOpen] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<TxPlan | null>(null);
  const reqId = useRef(0);

  const depth = market.yesReserve + market.noReserve;
  const amountIn = useMemo(() => {
    try {
      return amount.trim() ? parseUsdc(amount) : 0n;
    } catch {
      return 0n;
    }
  }, [amount]);

  const impactBps = depth === 0n ? 0n : (amountIn * 10_000n) / depth;
  const impactPct = Number(impactBps) / 100;
  const nearLimit = impactBps >= IMPACT_WARN_BPS;
  const overLimit = impactBps > MAX_IMPACT_BPS;

  /* ---------------- Quote: offline number first, then corrected by on-chain preview ---------------- */
  useEffect(() => {
    if (amountIn <= 0n) {
      setQuote({ source: "offline", loading: false });
      return;
    }
    const offline =
      side === "buy"
        ? previewBuyOffline(market, outcome, amountIn)
        : previewSellOffline(market, outcome, amountIn);
    setQuote({
      source: "offline",
      loading: true,
      ...(side === "buy" ? { sharesOut: offline } : { amountOut: offline }),
    });

    const my = ++reqId.current;
    const timer = window.setTimeout(async () => {
      try {
        const sdk = makeSdk(account);
        const q =
          side === "buy"
            ? await sdk.previewBuy(market.marketId as Hex, outcome, amountIn)
            : await sdk.previewSell(market.marketId as Hex, outcome, amountIn);
        if (my !== reqId.current) return;
        setQuote({
          source: "chain",
          loading: false,
          ...(side === "buy" ? { sharesOut: q } : { amountOut: q }),
        });
      } catch (e) {
        if (my !== reqId.current) return;
        setQuote({ source: "offline", loading: false, error: errText(e) });
      }
    }, 420);
    return () => window.clearTimeout(timer);
  }, [amountIn, side, outcome, market, account]);

  const quoted = side === "buy" ? quote.sharesOut : quote.amountOut;
  const avgPrice =
    side === "buy" && quoted && quoted > 0n && amountIn > 0n
      ? Number(amountIn) / Number(quoted)
      : side === "sell" && quoted && amountIn > 0n
        ? Number(quoted) / Number(amountIn)
        : 0;

  const maxBetHint = usdc(depth * MAX_IMPACT_BPS / 10_000n);
  const held = outcome === OUTCOME_YES ? holding?.yes ?? 0n : holding?.no ?? 0n;

  /* ---------------- Execution ---------------- */
  const runPlan = useCallback(
    async (plan: TxPlan) => {
      if (!account) return;
      setBusy(true);
      setErr(undefined);
      try {
        const sdk = makeSdk(account);
        if (side === "buy") {
          push({ kind: "info", title: t.trade.toasts.allowanceChecking, body: t.trade.toasts.allowanceBody });
          await ensureUsdcAllowance(amountIn);
        }
        // The referrer travels in the order's calldata tail: the engine ignores it, the indexer
        // credits the rebate. Nothing about pricing or slippage depends on it.
        const data = tagOrderData(plan.data, referrer);
        const hash = await sendTransaction({ to: plan.to as `0x${string}`, data });
        push({ kind: "trade", title: t.trade.toasts.submitted, hash });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(t.trade.toasts.reverted);
        // Attributed volume for the affiliate panel (browser-local ledger until the indexer settles)
        addVolume(Number(side === "buy" ? amountIn : quoted ?? 0n) / 1e6);
        const events = sdk.decodeReceiptLogs(
          receipt.logs.map((l) => ({
            address: l.address,
            topics: [...l.topics],
            data: l.data,
            logIndex: l.logIndex ?? 0,
            blockNumber: Number(l.blockNumber),
            transactionHash: l.transactionHash ?? hash,
          })),
        );
        const main = events.find((e) => e.name === "SharesBought" || e.name === "SharesSold" || e.name === "Redeemed");
        push({
          kind: "ok",
          title: main ? format(t.trade.toasts.confirmedEvent, { event: main.name }) : t.trade.toasts.confirmed,
          body: plan.summary,
          hash,
        });
        setAmount("");
        setWarnOpen(false);
        setPendingPlan(null);
        onDone();
      } catch (e) {
        const msg = e instanceof SdkError ? e.message : decodeRevertSafe(e);
        setErr(msg);
        push({ kind: "err", title: t.trade.toasts.tradeFailed, body: msg });
      } finally {
        setBusy(false);
      }
    },
    [account, side, amountIn, quoted, referrer, addVolume, onDone, push, t],
  );

  const submit = useCallback(async () => {
    if (!account) {
      push({ kind: "info", title: t.trade.toasts.connectFirst });
      return;
    }
    if (amountIn <= 0n) {
      setErr(t.trade.toasts.amountRequired);
      return;
    }
    setBusy(true);
    setErr(undefined);
    try {
      const sdk = makeSdk(account);
      const plan =
        side === "buy"
          ? await sdk.buildBuyShares({ marketId: market.marketId as Hex, outcome, amountIn, slippageBps })
          : await sdk.buildSellShares({ marketId: market.marketId as Hex, outcome, sharesIn: amountIn, slippageBps });
      setBusy(false);
      if (plan.warning === "impact_near_limit") {
        setPendingPlan(plan);
        setWarnOpen(true); // second confirmation dialog
        return;
      }
      await runPlan(plan);
    } catch (e) {
      setBusy(false);
      const msg = e instanceof SdkError ? e.message : decodeRevertSafe(e);
      setErr(msg);
    }
  }, [account, amountIn, side, market.marketId, outcome, slippageBps, push, runPlan, t]);

  const redeem = useCallback(async () => {
    if (!account) return;
    setBusy(true);
    setErr(undefined);
    try {
      const sdk = makeSdk(account);
      const plan = await sdk.buildRedeem({ marketId: market.marketId as Hex });
      const hash = await sendTransaction({ to: plan.to as `0x${string}`, data: plan.data as Hex });
      push({ kind: "trade", title: t.trade.toasts.redeemSubmitted, body: plan.summary, hash });
      await publicClient.waitForTransactionReceipt({ hash });
      push({ kind: "ok", title: t.trade.toasts.redeemConfirmed, hash });
      onDone();
    } catch (e) {
      const msg = e instanceof SdkError ? e.message : decodeRevertSafe(e);
      setErr(msg);
      push({ kind: "err", title: t.trade.toasts.redeemFailed, body: msg });
    } finally {
      setBusy(false);
    }
  }, [account, market.marketId, push, sendTransaction, onDone, t]);

  const tradingOpen = market.tradingOpen;
  const disputing = market.resolved && !market.finalized;
  const redeemable = market.resolved && market.finalized && ((holding?.yes ?? 0n) > 0n || (holding?.no ?? 0n) > 0n);

  return (
    <div className="space-y-3">
      {/* Market status strip */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl border border-white/5 bg-white/[0.03] px-2 py-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">YES</div>
          <div className="mono text-lg font-semibold text-brand">{pct(market.priceYes)}</div>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.03] px-2 py-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">{t.trade.panel.poolDepth}</div>
          <div className="mono text-lg font-semibold text-slate-200">{usdc(depth)}</div>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.03] px-2 py-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">
            {market.resolved ? t.trade.panel.disputeLeft : t.trade.panel.settlesIn}
          </div>
          <div className="mono text-lg font-semibold text-slate-200">
            {market.resolved ? (
              market.finalized ? (
                <span className="text-sky-300">{t.trade.panel.finalized}</span>
              ) : (
                <Countdown target={market.disputeEndsAt} doneText={t.trade.panel.awaitingFinalize} />
              )
            ) : (
              <Countdown target={market.resolutionTime} />
            )}
          </div>
        </div>
      </div>

      <ProbabilityBar prob={toProb(market.priceYes)} height={10} />

      {/* Dispute window callout */}
      {disputing && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-xs leading-relaxed text-amber-200">
          <b>{t.trade.panel.disputeTitle}</b>
          <br />
          {t.trade.panel.disputeBodyLead}
          <Countdown target={market.disputeEndsAt} className="text-amber-100" />
          {t.trade.panel.disputeBodyMid}
          <span className="mono">finalize()</span>
          {t.trade.panel.disputeBodyTail}
        </div>
      )}

      {/* Resolved: redeem */}
      {market.resolved && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
            <span>{t.trade.panel.position}</span>
            <span className="mono">
              YES {usdc(holding?.yes ?? 0n)} / NO {usdc(holding?.no ?? 0n)}
            </span>
          </div>
          <button
            className="btn-primary w-full"
            disabled={!redeemable || busy}
            onClick={() => void redeem()}
            title={disputing ? t.trade.panel.redeemTitleClosed : undefined}
          >
            {busy ? <Spinner /> : null}
            {disputing ? t.trade.panel.redeemDispute : redeemable ? t.trade.panel.redeemReady : t.trade.panel.redeemEmpty}
          </button>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{t.trade.panel.redeemNote}</p>
        </div>
      )}

      {/* Trade panel */}
      <div className={`rounded-xl border border-white/10 bg-white/[0.02] p-3 ${tradingOpen ? "" : "opacity-60"}`}>
        <div className="mb-3 flex rounded-lg bg-ink-850 p-1">
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
                side === s ? "bg-brand text-ink-950" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {s === "buy" ? t.trade.panel.buyShares : t.trade.panel.sellShares}
            </button>
          ))}
        </div>

        <div className="mb-2 grid grid-cols-2 gap-2">
          <button
            onClick={() => setOutcome(OUTCOME_YES)}
            className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
              outcome === OUTCOME_YES
                ? "border-brand/60 bg-brand/15 text-brand"
                : "border-white/10 bg-white/5 text-slate-400"
            }`}
          >
            YES · {pct(market.priceYes)}
          </button>
          <button
            onClick={() => setOutcome(OUTCOME_NO)}
            className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
              outcome === OUTCOME_NO
                ? "border-danger/60 bg-danger/15 text-danger"
                : "border-white/10 bg-white/5 text-slate-400"
            }`}
          >
            NO · {pct(market.priceNo)}
          </button>
        </div>

        <label className="label">
          {side === "buy" ? t.trade.panel.amountInLabel : t.trade.panel.sellLabel}
          {side === "sell" && held > 0n ? format(t.trade.panel.sellable, { amount: usdc(held) }) : ""}
        </label>
        <div className="relative">
          <input
            className="input mono pr-16 text-lg"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
            {side === "buy" ? t.trade.panel.unitUsdc : t.trade.panel.unitShares}
          </span>
        </div>

        <div className="mt-2 flex gap-1.5">
          {(side === "buy" ? [10n, 50n, 100n] : [held / 4n, held / 2n, held]).map((v, i) => {
            const val = side === "buy" ? v : v;
            if (val <= 0n) return null;
            return (
              <button
                key={i}
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10"
                onClick={() => setAmount(formatUsdc(val))}
              >
                {side === "buy" ? `${v}` : i === 2 ? t.trade.panel.max : `${i === 0 ? "25%" : "50%"}`}
              </button>
            );
          })}
          {side === "sell" && held > 0n && (
            <button
              className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10"
              onClick={() => setAmount(formatUsdc(held))}
            >
              {t.trade.panel.max}
            </button>
          )}
        </div>

        <div className="mt-3 flex items-center gap-1.5">
          <span className="text-[11px] text-slate-500">{t.trade.panel.slippage}</span>
          {SLIPPAGES.map((s) => (
            <button
              key={s.label}
              onClick={() => setSlippageBps(s.bps)}
              className={`rounded-md px-2 py-0.5 text-[11px] ${
                slippageBps === s.bps ? "bg-brand/20 text-brand" : "bg-white/5 text-slate-400"
              }`}
            >
              {s.label}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-slate-500">
            {format(t.trade.panel.capHint, { amount: maxBetHint })}
          </span>
        </div>

        {/* Live quote */}
        <div className="mt-3 space-y-1 rounded-lg bg-ink-850/80 px-3 py-2 text-xs">
          <Row
            label={side === "buy" ? t.trade.panel.quoteReceive : t.trade.panel.quoteReturn}
            value={
              quoted === undefined || amountIn === 0n ? (
                "—"
              ) : (
                <>
                  {side === "buy"
                    ? `${usdc(quoted)}${t.trade.panel.unitSharesSuffix}`
                    : `${usdc(quoted)} ${t.trade.panel.unitUsdc}`}
                  <span className="ml-1 text-[10px] text-slate-500">
                    {quote.source === "chain" ? t.trade.panel.quoteChain : t.trade.panel.quoteOffline}
                  </span>
                </>
              )
            }
            busy={quote.loading}
          />
          <Row
            label={t.trade.panel.avgFill}
            value={
              avgPrice
                ? `${avgPrice.toFixed(4)} ${side === "buy" ? t.trade.panel.pricePerShare : t.trade.panel.pricePerShare}`
                : "—"
            }
          />
          <Row
            label={t.trade.panel.priceImpact}
            value={
              <span className={nearLimit ? "text-amber-300" : "text-slate-300"}>
                {impactPct.toFixed(2)}%{t.trade.panel.impactCap}
              </span>
            }
          />
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full ${overLimit ? "bg-danger" : nearLimit ? "bg-amber-400" : "bg-brand-dim"}`}
              style={{ width: `${Math.min(100, (Number(impactBps) / 500) * 100).toFixed(1)}%` }}
            />
          </div>
          <Row label={t.trade.panel.tradingFee} value={`${bps(150n)}${t.trade.panel.feeOnChain}`} />
          <Row
            label={t.trade.panel.protectedPrice}
            value={
              quoted
                ? format(t.trade.panel.protectedPriceValue, {
                    amount: usdc((quoted * (10_000n - slippageBps)) / 10_000n),
                    slip: bps(slippageBps, 1),
                  })
                : "—"
            }
          />
        </div>

        {nearLimit && (
          <div className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
            {t.trade.panel.impactWarnLead}
            <span className="mono">impact_near_limit</span>
            {t.trade.panel.impactWarnMid}
            <span className="mono">ImpactTooHigh()</span>
            {t.trade.panel.impactWarnTail}
          </div>
        )}

        {err && (
          <div className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] leading-relaxed text-danger">
            {err}
          </div>
        )}

        <button
          className="btn-primary mt-3 w-full"
          disabled={!tradingOpen || busy || amountIn === 0n}
          onClick={() => void submit()}
        >
          {busy ? <Spinner /> : null}
          {!tradingOpen
            ? market.resolved
              ? t.trade.panel.submitSettled
              : t.trade.panel.submitClosed
            : side === "buy"
              ? format(t.trade.panel.buy, { side: outcome === OUTCOME_YES ? "YES" : "NO" })
              : format(t.trade.panel.sell, { side: outcome === OUTCOME_YES ? "YES" : "NO" })}
        </button>
        {!account && <p className="mt-2 text-center text-[11px] text-slate-500">{t.trade.panel.connectToTrade}</p>}
      </div>

      {/* impact_near_limit second confirmation */}
      {warnOpen && pendingPlan && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" role="dialog">
          <div className="card w-full max-w-md border-amber-400/30 p-5">
            <h4 className="mb-2 text-base font-semibold text-amber-300">{t.trade.panel.confirmTitle}</h4>
            <p className="mb-3 text-xs leading-relaxed text-slate-300">
              {t.trade.panel.confirmBodyLead}
              <span className="mono">warning: "impact_near_limit"</span>
              {t.trade.panel.confirmBodyMid}
              <b className="mono text-amber-300">{impactPct.toFixed(2)}</b>
              {t.trade.panel.confirmBodyTail}
            </p>
            <div className="mb-4 rounded-lg bg-ink-850 px-3 py-2 text-[11px] leading-relaxed text-slate-400">
              {pendingPlan.summary}
            </div>
            <div className="flex gap-2">
              <button
                className="btn-ghost flex-1"
                onClick={() => {
                  setWarnOpen(false);
                  setPendingPlan(null);
                }}
              >
                {t.trade.panel.confirmReduce}
              </button>
              <button
                className="btn-primary flex-1"
                disabled={busy}
                onClick={() => {
                  setWarnOpen(false);
                  void runPlan(pendingPlan);
                }}
              >
                {busy ? <Spinner /> : null} {t.trade.panel.confirmProceed}
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="text-center text-[10px] text-slate-600">
        {t.trade.panel.footerUsdc} {USDC_ADDRESS.slice(0, 6)}… · {t.trade.panel.footerEngine}{" "}
        {market.marketId.slice(0, 8)}… ·{" "}
        <a href={`${EXPLORER}/address/${market.marketId}`} className="hover:text-slate-400" />
        {t.trade.panel.footerNote}
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  busy,
}: {
  label: string;
  value: React.ReactNode;
  busy?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className="mono flex items-center gap-1 text-right text-slate-200">
        {busy ? <Spinner className="h-3 w-3" /> : null}
        {value}
      </span>
    </div>
  );
}

function decodeRevertSafe(e: unknown): string {
  try {
    const d = decodeRevert(e);
    if (d?.message) return d.message;
  } catch {
    /* ignore */
  }
  return errText(e);
}

/** The sell side also needs the current YES price (exposed for the parent view). */
export function offlineYesPrice(m: MarketSnapshot): bigint {
  return priceYesOffline(m);
}
