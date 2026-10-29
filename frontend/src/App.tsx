import { useEffect, useMemo, useState } from "react";
import type { MarketSnapshot } from "@sdk";
import { Header, type Tab } from "./components/Header";
import { MarketGrid } from "./components/MarketCard";
import { MarketDetail } from "./components/MarketDetail";
import { PortfolioView } from "./components/PortfolioView";
import { ActivityView } from "./components/ActivityView";
import { CreateMarket } from "./components/CreateMarket";
import { CategoryNav } from "./components/CategoryNav";
import { DemoDetail, DemoMarketCard } from "./components/DemoMarketCard";
import { Empty, Spinner } from "./components/ui";
import { DocsPortal, RiskModal, SecurityDrawer } from "./components/Overlays";
import { StatusBar } from "./components/StatusBar";
import { PaperPortfolio } from "./components/PaperPortfolio";
import { useMode } from "./lib/mode";
import { ToastStack } from "./hooks/useToasts";
import { useMarkets } from "./hooks/useMarkets";
import { usePortfolio } from "./hooks/usePortfolio";
import { useEventFeed } from "./hooks/useEventFeed";
import { useWallet, WalletProvider } from "./lib/wallet";
import { makeSdk } from "./lib/sdk";
import { ENGINE_ADDRESS, EXPLORER } from "./lib/config";
import { shortAddr, usdc } from "./lib/format";
import { DEMO_MARKETS, DEMO_VOLUME_USDC } from "./data/markets";
import type { DemoMarket } from "./lib/demo";
import { startLiveFeed } from "./lib/demoLive";
import { ensureSeeded } from "./lib/comments";
import { formatFake } from "./lib/paper";
import { WelcomeAirdrop } from "./components/WelcomeAirdrop";
import { groupOf, NAV, NAV_LABEL, type NavKey } from "./lib/nav";
import { format, useT } from "./lib/i18n";
import { LiveTicker } from "./components/LiveTicker";
import { PredictorBoard } from "./components/PredictorBoard";

function ConnectModal({ onClose }: { onClose: () => void }) {
  const { providers, connect, connecting, error } = useWallet();
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="card w-full max-w-sm p-5 animate-fade-in">
        <h3 className="mb-1 text-base font-semibold text-slate-100">{t.hall.connect.title}</h3>
        <p className="mb-3 text-[11px] text-slate-500">{t.hall.connect.body}</p>
        <div className="space-y-2">
          {providers.length === 0 && (
            <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">
              {t.hall.connect.empty}
            </div>
          )}
          {providers.map((p) => (
            <button
              key={p.info.uuid}
              className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-200 hover:border-brand/40 hover:bg-brand/10"
              onClick={async () => {
                await connect(p);
                onClose();
              }}
              disabled={connecting}
            >
              {p.info.icon ? (
                <img src={p.info.icon} alt="" className="h-5 w-5 rounded" />
              ) : (
                <span className="text-brand">◈</span>
              )}
              <span className="flex-1 text-left">{p.info.name}</span>
              {connecting ? <Spinner /> : null}
            </button>
          ))}
        </div>
        {error && <div className="mt-3 text-[11px] text-danger">{error}</div>}
        <button className="btn-ghost mt-4 w-full" onClick={onClose}>
          {t.shell.actions.close}
        </button>
      </div>
    </div>
  );
}

function StatStrip({ items }: { items: Array<{ k: string; v: string; tone?: string }> }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.k} className="card relative overflow-hidden px-3 py-2">
          <div className="pointer-events-none absolute -right-6 -top-6 h-14 w-14 rounded-full bg-brand/10 blur-xl" />
          <div className="text-[10px] uppercase tracking-wide text-slate-500">{it.k}</div>
          <div className={`mono text-lg font-semibold ${it.tone ?? "text-slate-100"}`}>{it.v}</div>
        </div>
      ))}
    </div>
  );
}

function Dashboard() {
  const { account } = useWallet();
  const t = useT();
  const [tab, setTab] = useState<Tab>("feed");
  const [selected, setSelected] = useState<MarketSnapshot | null>(null);
  const [demoSelected, setDemoSelected] = useState<DemoMarket | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [paused, setPaused] = useState<boolean | null>(null);
  const [q, setQ] = useState("");
  const [nav, setNav] = useState<NavKey>("hot");

  const { markets, total, loading, error, refresh } = useMarkets(15_000);
  const { positions, balance, refresh: refreshPortfolio } = usePortfolio(markets, account);
  const { items, error: feedError } = useEventFeed(true, 8_000);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () =>
      makeSdk()
        .paused()
        .then((v) => alive && setPaused(v))
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const holdings = useMemo(() => {
    const map: Record<string, { yes: bigint; no: bigint }> = {};
    for (const p of positions) map[p.market.marketId] = { yes: p.yes, no: p.no };
    return map;
  }, [positions]);

  /** Search matches question or category, shared by on-chain and featured markets. */
  const matchesQuery = (question: string, category: string) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return question.toLowerCase().includes(s) || category.toLowerCase().includes(s);
  };

  const chainFiltered = useMemo(
    () =>
      markets.filter((m) => {
        const g = groupOf(m.category);
        const navOk = nav === "hot" || g === nav;
        return navOk && matchesQuery(m.question ?? "", m.category ?? "");
      }),
    [markets, nav, q],
  );

  const demoFiltered = useMemo(
    () =>
      DEMO_MARKETS.filter((d) => {
        const g = groupOf(d.category);
        const navOk = nav === "hot" || g === nav;
        return navOk && matchesQuery(d.question, d.category);
      }),
    [nav, q],
  );

  /** Nav counts: on-chain and featured markets counted together. */
  const counts = useMemo(() => {
    const c: Record<string, number> = { hot: markets.length + DEMO_MARKETS.length };
    for (const key of NAV.map((n) => n.key)) if (key !== "hot") c[key] = 0;
    for (const m of markets) {
      const g = groupOf(m.category);
      if (g !== "other") c[g] = (c[g] ?? 0) + 1;
    }
    for (const d of DEMO_MARKETS) {
      const g = groupOf(d.category);
      if (g !== "other") c[g] = (c[g] ?? 0) + 1;
    }
    return c;
  }, [markets]);

  const stats = useMemo(() => {
    const chainDepth = markets.reduce((acc, m) => acc + m.yesReserve + m.noReserve, 0n);
    return {
      total: markets.length,
      demo: DEMO_MARKETS.length,
      depth: chainDepth,
      active: markets.filter((m) => m.tradingOpen && !m.resolved).length,
    };
  }, [markets]);

  /** Simulated volume across the sample book (first-screen stat, excludes on-chain). */
  const demoVolume = DEMO_VOLUME_USDC;

  const refreshAll = () => {
    void refresh();
    void refreshPortfolio();
  };

  const selectedLive = selected
    ? markets.find((m) => m.marketId === selected.marketId) ?? selected
    : null;

  const showEmptyChain = !loading && markets.length === 0;
  const [secOpen, setSecOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const { mode, paper, claim, reset } = useMode();

  // Hall liveness: featured markets tick every 7s, seeded debate takes land in local storage.
  useEffect(() => {
    const stop = startLiveFeed(DEMO_MARKETS);
    ensureSeeded(DEMO_MARKETS.map((m) => m.id));
    return stop;
  }, []);

  const demoHall = (
    <section id="featured-hall" className="space-y-2 scroll-mt-24" data-testid="demo-hall">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-200">{t.hall.sections.featuredTitle}</h2>
        <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10px] text-brand">
          {t.hall.sections.featuredBadge}
        </span>
        <span className="mono text-[11px] text-slate-500">{demoFiltered.length}</span>
        <span className="ml-auto hidden items-center gap-1.5 text-[10.5px] text-slate-600 sm:flex">
          <span className="live-ring h-1.5 w-1.5 rounded-full bg-brand" />
          {t.hall.sections.featuredNote}
        </span>
      </div>
      {demoFiltered.length === 0 ? (
        <Empty title={t.hall.sections.demoEmptyTitle} hint={t.hall.sections.demoEmptyHint} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {demoFiltered.map((d) => (
            <DemoMarketCard key={d.id} market={d} onOpen={() => setDemoSelected(d)} />
          ))}
        </div>
      )}
    </section>
  );

  const chainHall = (
    <section className="space-y-2" data-testid="chain-hall">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-200">{t.hall.sections.chainTitle}</h2>
        <span className="chip text-[10px]">{NAV_LABEL[nav]}</span>
        <span className="mono text-[11px] text-slate-500">{chainFiltered.length}</span>
        {loading && <Spinner />}
      </div>

      {showEmptyChain ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-4 text-center">
          <div className="text-[13px] font-medium text-slate-300">{t.hall.sections.chainEmptyTitle}</div>
          <p className="mx-auto mt-1 max-w-xl text-[11px] leading-relaxed text-slate-500">
            {t.hall.sections.chainNote}
          </p>
        </div>
      ) : (
        <MarketGrid
          markets={chainFiltered}
          loading={loading}
          error={error}
          onSelect={setSelected}
          now={now}
          holdings={holdings}
        />
      )}
    </section>
  );

  return (
    <div className="relative min-h-screen">
      <div className="aurora" aria-hidden />
      <Header
        tab={tab}
        onTab={setTab}
        onConnectClick={() => setConnectOpen(true)}
        onOpenSecurity={() => setSecOpen(true)}
        onOpenDocs={() => setDocsOpen(true)}
      />

      {paused && (
        <div className="border-b border-danger/30 bg-danger/10 px-4 py-2 text-center text-xs text-danger">
          {t.hall.paused}
        </div>
      )}

      {mode === "paper" && (
        <div className="border-b border-cyan-400/25 bg-cyan-400/[0.06] px-4 py-2">
          <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-2 text-[11.5px] text-cyan-200">
            <span className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 text-[10px]">
              {t.hall.paperBar.label}
            </span>
            <span className="mono">
              {t.hall.paperBar.balance} <b className="text-brand">{formatFake(paper.balance, 0)}</b> FAKE-USDC
            </span>
            {(!paper.claimed || paper.balance === 0n) && (
              <button className="btn-primary px-3 py-1 text-[11px]" onClick={claim}>
                {t.shell.actions.claimChips}
              </button>
            )}
            <span className="hidden text-cyan-200/70 sm:inline">{format(t.hall.paperBar.hintCount, { count: DEMO_MARKETS.length })}</span>
            <button
              className="btn-ghost ml-auto px-3 py-1 text-[11px]"
              onClick={reset}
              title={t.shell.actions.resetChipsTitle}
            >
              {t.shell.actions.resetChips}
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[1240px] px-4 py-5">
        {tab === "feed" && (
          <div className="space-y-4">
            <div className="card hero-panel relative overflow-hidden p-4">
              <div className="grid-bg pointer-events-none absolute inset-0 opacity-40" />
              <div className="relative flex flex-wrap items-end gap-3">
                <div className="min-w-0">
                  <h1 className="text-xl font-semibold tracking-tight">
                    <span className="bg-gradient-to-r from-brand-glow via-brand to-cyan-300 bg-clip-text text-transparent">
                      {t.hall.heroTitleA}
                    </span>
                    <span className="text-slate-600"> · </span>
                    <span className="text-slate-100">{t.hall.heroTitleB}</span>
                  </h1>
                  <p className="mt-0.5 max-w-xl text-[11.5px] leading-relaxed text-slate-400">{t.hall.heroBody}</p>
                </div>
                <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">
                  <input
                    className="input min-w-0 flex-1 sm:w-56 sm:flex-none"
                    placeholder={t.shell.actions.search}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                  <button className="btn-ghost" onClick={refreshAll}>
                    {t.shell.actions.refresh}
                  </button>
                  <CreateMarket onDone={refreshAll} />
                </div>
              </div>
            </div>

            <StatStrip
              items={
                mode === "paper"
                  ? [
                      { k: t.hall.statsPaper.featured, v: String(stats.demo), tone: "text-brand" },
                      { k: t.hall.statsPaper.cadence, v: t.hall.statsPaper.cadenceValue, tone: "text-cyan-300" },
                      {
                        k: t.hall.statsPaper.volume,
                        v: `${demoVolume.toLocaleString()} USDC`,
                      },
                      { k: t.hall.statsPaper.chain, v: String(stats.total) },
                    ]
                  : [
                      { k: t.hall.statsReal.chain, v: String(stats.total), tone: "text-brand" },
                      { k: t.hall.statsReal.active, v: String(stats.active) },
                      { k: t.hall.statsReal.liquidity, v: `${usdc(stats.depth, 0)} USDC` },
                      { k: t.hall.statsReal.featured, v: String(stats.demo), tone: "text-sky-300" },
                    ]
              }
            />

            <CategoryNav value={nav} onChange={setNav} counts={counts} />

            <LiveTicker />

            <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
              <section className="card relative overflow-hidden" data-testid="spotlight">
                <img
                  src={`${import.meta.env.BASE_URL}art/spotlight.svg`}
                  alt=""
                  aria-hidden
                  className="absolute inset-0 h-full w-full object-cover opacity-90"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-[#05060a] via-[#05060a]/70 to-transparent" />
                <div className="relative p-4">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-brand/80">{t.marketing.spotlight.eyebrow}</div>
                  <h2 className="mt-1 max-w-md text-lg font-semibold leading-snug text-slate-100">
                    {t.marketing.spotlight.title}
                  </h2>
                  <p className="mt-1 max-w-md text-[11.5px] leading-relaxed text-slate-400">
                    {t.marketing.spotlight.body}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[10.5px]">
                    <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-brand">
                      {t.hall.sections.featuredBadge}
                    </span>
                    <span className="chip">{DEMO_MARKETS.length} markets</span>
                    <span className="chip">{demoVolume.toLocaleString()} USDC simulated</span>
                    <a
                      href="#featured-hall"
                      className="btn-primary px-3 py-1 text-[11px]"
                    >
                      {t.marketing.spotlight.cta}
                    </a>
                  </div>
                </div>
              </section>
              <PredictorBoard realFillCount={items.length} />
            </div>

            {error && markets.length > 0 && (
              <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">
                {t.hall.sections.refreshFailed} {error}
              </div>
            )}

            {mode === "paper" ? (
              <>
                {demoHall}
                {chainHall}
              </>
            ) : (
              <>
                {chainHall}
                {demoHall}
              </>
            )}
          </div>
        )}

        {tab === "portfolio" && (
          <div className="space-y-4">
            <div>
              <h1 className="text-lg font-semibold text-slate-100">{t.hall.portfolio.title}</h1>
              <p className="text-[11px] text-slate-500">{t.hall.portfolio.subtitle}</p>
            </div>
            <PaperPortfolio chain={markets} demo={DEMO_MARKETS} />
            <PortfolioView
              positions={positions}
              balance={balance}
              loading={loading}
              account={account}
              onSelect={setSelected}
              onRedeem={(m) => setSelected(m)}
            />
          </div>
        )}

        {tab === "activity" && <ActivityView items={items} error={feedError} />}

        {tab === "activity" && items.length === 0 && (
          <div className="mt-4 text-center text-[11px] text-slate-600">
            {t.shell.footer.engine} {shortAddr(ENGINE_ADDRESS)} ·{" "}
            <a className="hover:text-slate-400" href={`${EXPLORER}/address/${ENGINE_ADDRESS}`}>
              Basescan
            </a>
          </div>
        )}
      </main>

      <footer className="mt-6 border-t border-white/[0.06] px-4 py-5 text-[11px] text-slate-600">
        <div className="mx-auto mb-3 max-w-[1240px]">
          <StatusBar onOpenSecurity={() => setSecOpen(true)} onOpenDocs={() => setDocsOpen(true)} />
        </div>
        <div className="text-center">
          {t.shell.footer.engine}{" "}
          <a
            className="mono hover:text-slate-400"
            href={`${EXPLORER}/address/${ENGINE_ADDRESS}`}
            target="_blank"
            rel="noreferrer"
          >
            {ENGINE_ADDRESS}
          </a>{" "}
          · {t.shell.footer.chain} · {t.shell.footer.fees} · {t.shell.footer.dispute}
        </div>
      </footer>

      {selectedLive && (
        <MarketDetail
          market={selectedLive}
          holding={holdings[selectedLive.marketId]}
          onClose={() => setSelected(null)}
          onDone={refreshAll}
        />
      )}
      {demoSelected && <DemoDetail market={demoSelected} onClose={() => setDemoSelected(null)} />}
      {connectOpen && <ConnectModal onClose={() => setConnectOpen(false)} />}
      <SecurityDrawer open={secOpen} onClose={() => setSecOpen(false)} />
      <DocsPortal open={docsOpen} onClose={() => setDocsOpen(false)} />
      <RiskModal />
      <WelcomeAirdrop />
      {!account && tab === "portfolio" && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 flex justify-center">
          <span className="pointer-events-auto chip">{t.shell.actions.connectToView}</span>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <WalletProvider>
      <Dashboard />
      <ToastStack />
    </WalletProvider>
  );
}
