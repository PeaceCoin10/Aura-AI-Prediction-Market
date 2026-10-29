import type { MarketSnapshot } from "@sdk";
import type { DemoMarket } from "../lib/demo";
import { useMode } from "../lib/mode";
import { formatFake, paperPriceYes, paperValue, type MarketRef } from "../lib/paper";
import { usdc } from "../lib/format";
import { ShareButton } from "./ShareButton";
import { format, useT } from "../lib/i18n";

/** Paper account: balance, per-market mark value and unrealized PnL, one-tap position share. */
export function PaperPortfolio({ chain, demo }: { chain: MarketSnapshot[]; demo: DemoMarket[] }) {
  const { paper, claim, reset } = useMode();
  const t = useT();

  const refs: MarketRef[] = [
    ...demo.map((d) => ({
      id: d.id,
      question: d.question,
      category: d.category,
      yesReserve: d.yesReserve,
      noReserve: d.noReserve,
      resolutionTime: d.resolutionAt,
      isDemo: true,
    })),
    ...chain.map((m) => ({
      id: m.marketId,
      question: m.question ?? "",
      category: m.category ?? "",
      yesReserve: m.yesReserve,
      noReserve: m.noReserve,
      resolutionTime: Number(m.resolutionTime),
    })),
  ];
  const byId = new Map(refs.map((r) => [r.id, r]));
  const rows = Object.entries(paper.positions)
    .map(([id, pos]) => {
      const ref = byId.get(id);
      const val = ref ? paperValue(ref, pos) : { value: 0n, pnl: 0n };
      return { id, pos, ref, ...val };
    })
    .filter((r) => r.pos.yes > 0n || r.pos.no > 0n || r.pos.spent > 0n)
    .sort((a, b) => Number(b.value - a.value));

  const totalValue = rows.reduce((s, r) => s + r.value, 0n);
  const totalPnl = rows.reduce((s, r) => s + r.pnl, 0n);

  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-100">{t.paper.account.title}</h2>
        <span className="chip border-cyan-400/40 bg-cyan-400/10 text-[10px] text-cyan-300">{t.paper.account.badge}</span>
        <span className="mono text-[11px] text-slate-500">
          {format(t.paper.account.summary, {
            balance: formatFake(paper.balance),
            value: formatFake(totalValue),
          })}
        </span>
        <span
          className={`mono rounded px-1.5 py-0.5 text-[11px] ${
            totalPnl >= 0n ? "bg-brand/15 text-brand" : "bg-danger/15 text-danger"
          }`}
        >
          {t.paper.account.unrealized} {totalPnl >= 0n ? "+" : ""}
          {formatFake(totalPnl)}
        </span>
        <div className="ml-auto flex gap-1.5">
          {!paper.claimed && paper.balance === 0n && (
            <button className="btn-primary px-2.5 py-1 text-[11px]" onClick={claim}>
              {t.paper.account.claim}
            </button>
          )}
          <button className="btn-ghost px-2.5 py-1 text-[11px]" onClick={reset}>
            {t.paper.account.reset}
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-[11.5px] text-slate-600">{t.paper.account.empty}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const prob = r.ref ? Number(paperPriceYes(r.ref)) / 1e18 : 0;
            return (
              <div
                key={r.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] text-slate-200">{r.ref?.question ?? r.id}</div>
                  <div className="mono text-[10.5px] text-slate-500">
                    {format(t.paper.account.rowMeta, {
                      yes: usdc(r.pos.yes),
                      no: usdc(r.pos.no),
                      spent: formatFake(r.pos.spent),
                      value: formatFake(r.value),
                    })}
                  </div>
                </div>
                <span
                  className={`mono text-[11.5px] ${r.pnl >= 0n ? "text-brand" : "text-danger"}`}
                >
                  {r.pnl >= 0n ? "+" : ""}
                  {formatFake(r.pnl)}
                </span>
                {r.ref && (
                  <ShareButton
                    compact
                    input={{
                      question: r.ref.question,
                      category: r.ref.category,
                      side: r.pos.yes >= r.pos.no ? "YES" : "NO",
                      prob,
                      potentialReturn: prob > 0 ? `${(1 / prob).toFixed(2)}x` : undefined,
                      mode: "paper",
                      marketId: r.id,
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-2.5 text-[10px] text-slate-600">{t.paper.account.footnote}</p>
    </section>
  );
}
