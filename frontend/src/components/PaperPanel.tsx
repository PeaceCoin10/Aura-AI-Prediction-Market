import { useMemo, useState } from "react";
import { useMode } from "../lib/mode";
import {
  formatFake,
  paperBuy,
  paperImpactBps,
  paperPriceYes,
  paperQuoteBuy,
  paperQuoteSell,
  paperSell,
  paperValue,
  type MarketRef,
  type Side,
} from "../lib/paper";
import { play } from "../lib/sound";
import { usdc } from "../lib/format";
import { useToasts } from "../hooks/useToasts";
import { format, useT } from "../lib/i18n";

const SLIPPAGE = [
  { label: "0.5%", bps: 50 },
  { label: "1%", bps: 100 },
  { label: "3%", bps: 300 },
];

/**
 * Paper trading panel: same CPMM quote, slippage tiers and impact warning as the live TradePanel,
 * but the money is local FAKE-USDC — 10,000 chips on tap, no wallet, no real USDC.
 */
export function PaperPanel({ market }: { market: MarketRef }) {
  const { paper, claim, reset } = useMode();
  const { push } = useToasts();
  const t = useT();
  const [side, setSide] = useState<Side>(0);
  const [amount, setAmount] = useState("100");
  const [slip, setSlip] = useState(100);

  const pos = paper.positions[market.id];
  const pxYes = paperPriceYes(market);
  const amountRaw = useMemo(() => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return 0n;
    return BigInt(Math.round(n * 1_000_000));
  }, [amount]);

  const shares = amountRaw > 0n ? paperQuoteBuy(market, side, amountRaw) : 0n;
  const impactBps = amountRaw > 0n ? paperImpactBps(market, side, amountRaw) : 0;
  const minOut = (shares * BigInt(10_000 - slip)) / 10_000n;
  const avgPrice = shares > 0n ? Number(amountRaw) / Number(shares) : 0;
  const curPrice = Number(side === 0 ? pxYes : 10n ** 18n - pxYes) / 1e18;
  const impactWarn = impactBps >= 400;

  const value = paperValue(market, pos);
  const held = pos ? (side === 0 ? pos.yes : pos.no) : 0n;
  const sellOut = held > 0n ? paperQuoteSell(market, side, held) : 0n;

  const balanceLow = paper.balance < amountRaw;

  const submit = () => {
    const r = paperBuy(market, side, amountRaw);
    if (!r.ok) {
      play("error");
      push({ kind: "err", title: t.paper.panel.errorTitleBuy, body: r.reason });
      return;
    }
    play("success");
    push({
      kind: "trade",
      title: format(t.paper.panel.toastBuyTitle, { side: side === 0 ? "YES" : "NO" }),
      body: format(t.paper.panel.toastBuyBody, {
        amount,
        shares: usdc(r.shares),
        price: avgPrice.toFixed(4),
      }),
    });
  };

  const doSell = () => {
    if (held === 0n) return;
    const r = paperSell(market, side, held);
    if (!r.ok) {
      play("error");
      push({ kind: "err", title: t.paper.panel.errorTitleSell, body: r.reason });
      return;
    }
    play("claim");
    push({
      kind: "ok",
      title: format(t.paper.panel.toastSellTitle, { side: side === 0 ? "YES" : "NO" }),
      body: format(t.paper.panel.toastSellBody, {
        shares: usdc(held),
        proceeds: usdc(r.proceeds),
      }),
    });
  };

  return (
    <div className="flow-border card rounded-2xl p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-medium text-cyan-300">
          {t.paper.panel.badge}
        </span>
        <span className="mono text-[11px] text-slate-500">
          {format(t.paper.panel.balance, { amount: formatFake(paper.balance) })}
        </span>
        <div className="ml-auto flex gap-1">
          {!paper.claimed && paper.balance === 0n ? (
            <button className="btn-primary px-2.5 py-1 text-[11px]" onClick={claim}>
              {t.paper.panel.claim}
            </button>
          ) : (
            <button
              className="btn-ghost px-2 py-1 text-[10.5px]"
              onClick={() => {
                reset();
                push({ kind: "info", title: t.paper.panel.resetTitle, body: t.paper.panel.resetBody });
              }}
            >
              {t.paper.panel.reset}
            </button>
          )}
        </div>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-1.5">
        <button
          onClick={() => {
            setSide(0);
            play("click");
          }}
          className={`rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
            side === 0
              ? "border-brand bg-brand/20 text-brand shadow-[0_0_24px_-10px_rgba(52,211,153,0.9)]"
              : "border-white/10 text-slate-400 hover:border-brand/40"
          }`}
        >
          {format(t.paper.panel.buyYes, { prob: `${(Number(pxYes) / 1e18 * 100).toFixed(1)}%` })}
        </button>
        <button
          onClick={() => {
            setSide(1);
            play("click");
          }}
          className={`rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
            side === 1 ? "border-danger bg-danger/20 text-danger" : "border-white/10 text-slate-400 hover:border-danger/40"
          }`}
        >
          {format(t.paper.panel.buyNo, { prob: `${(100 - (Number(pxYes) / 1e18) * 100).toFixed(1)}%` })}
        </button>
      </div>

      <label className="label">{t.paper.panel.amountLabel}</label>
      <input
        className="input mono"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
        placeholder={t.paper.panel.amountPlaceholder}
      />
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {[10, 50, 100, 500, 1000].map((v) => (
          <button
            key={v}
            className="chip hover:border-brand/40 hover:text-brand"
            onClick={() => {
              setAmount(String(v));
              play("click");
            }}
          >
            {v}
          </button>
        ))}
        <button
          className="chip hover:border-brand/40 hover:text-brand"
          onClick={() => setAmount(formatFake(paper.balance, 0).replace(/,/g, ""))}
        >
          {t.paper.panel.max}
        </button>
      </div>

      <div className="mt-2.5 flex items-center gap-1.5">
        <span className="text-[11px] text-slate-500">{t.paper.panel.slippage}</span>
        {SLIPPAGE.map((s) => (
          <button
            key={s.bps}
            onClick={() => setSlip(s.bps)}
            className={`rounded-full border px-2 py-0.5 text-[11px] ${
              slip === s.bps ? "border-brand bg-brand/20 text-brand" : "border-white/10 text-slate-400"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="mt-2.5 space-y-1 rounded-lg border border-white/5 bg-ink-950/60 p-2.5 text-[11.5px]">
        <Row k={t.paper.panel.estShares} v={`${usdc(shares)}`} strong />
        <Row k={t.paper.panel.avgPrice} v={avgPrice > 0 ? `$${avgPrice.toFixed(4)}` : "—"} />
        <Row k={t.paper.panel.marginalPrice} v={`$${curPrice.toFixed(4)}`} />
        <Row k={t.paper.panel.minReceived} v={`${usdc(minOut)}`} />
        <Row k={t.paper.panel.impact} v={`${(impactBps / 100).toFixed(2)}%`} danger={impactWarn} />
      </div>

      {impactWarn && (
        <div className="mt-2 animate-fade-in rounded-lg border border-amber-400/40 bg-amber-400/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-200">
          {format(t.paper.panel.impactWarning, { impact: `${(impactBps / 100).toFixed(2)}%` })}
        </div>
      )}

      <button className="btn-primary mt-2.5 w-full" onClick={submit} disabled={shares === 0n}>
        {format(t.paper.panel.buy, { side: side === 0 ? "YES" : "NO" })}
      </button>
      {balanceLow && (
        <div className="mt-1.5 text-center text-[10.5px] text-amber-300">
          {format(t.paper.panel.insufficientChips, { amount: formatFake(paper.balance) })}
        </div>
      )}

      <div className="mt-3 rounded-lg border border-white/5 bg-white/[0.02] p-2.5">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[11px] font-medium text-slate-300">{t.paper.panel.boardTitle}</span>
          {pos && (
            <span
              className={`mono rounded px-1.5 text-[10px] ${
                value.pnl >= 0n ? "bg-brand/15 text-brand" : "bg-danger/15 text-danger"
              }`}
            >
              {value.pnl >= 0n ? "+" : ""}
              {formatFake(value.pnl)} USDC
            </span>
          )}
        </div>
        {!pos ? (
          <p className="text-[10.5px] text-slate-600">{t.paper.panel.boardEmpty}</p>
        ) : (
          <div className="space-y-1 text-[11.5px]">
            <Row k={t.paper.panel.yesShares} v={usdc(pos.yes)} />
            <Row k={t.paper.panel.noShares} v={usdc(pos.no)} />
            <Row k={t.paper.panel.invested} v={`${formatFake(pos.spent)} USDC`} />
            <Row k={t.paper.panel.markValue} v={`${formatFake(value.value)} USDC`} strong />
            <div className="flex gap-1.5 pt-1">
              <button className="btn-ghost flex-1 px-2 py-1 text-[11px]" onClick={doSell} disabled={held === 0n}>
                {format(t.paper.panel.sell, { side: side === 0 ? "YES" : "NO", shares: usdc(sellOut) })}
              </button>
            </div>
          </div>
        )}
      </div>
      <p className="mt-2 text-center text-[10px] text-slate-600">{t.paper.panel.disclaimer}</p>
    </div>
  );
}

function Row({ k, v, strong, danger }: { k: string; v: string; strong?: boolean; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{k}</span>
      <span className={`mono ${danger ? "text-amber-300" : strong ? "text-slate-100" : "text-slate-300"}`}>{v}</span>
    </div>
  );
}
