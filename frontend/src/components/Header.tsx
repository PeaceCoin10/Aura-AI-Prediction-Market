import { useEffect, useState } from "react";
import { CHAIN_ID, ENGINE_ADDRESS, EXPLORER } from "../lib/config";
import { shortAddr, usdc } from "../lib/format";
import { usdcBalance } from "../lib/sdk";
import { useWallet } from "../lib/wallet";
import { useToasts } from "../hooks/useToasts";
import { useI18n, useT } from "../lib/i18n";
import { LogoLockup, LogoMark } from "./BrandLogo";
import { ModeSwitch, SoundToggle } from "./ModeSwitch";

const SHORT_ENGINE = shortAddr(ENGINE_ADDRESS);

export type Tab = "feed" | "portfolio" | "activity";

/** Locale chip: renders every registered locale; a second one turns it into a real switcher. */
function LocaleChip() {
  const { locale, setLocale, locales, t } = useI18n();
  const label = locales.find((l) => l.code === locale)?.label ?? locale.toUpperCase();
  if (locales.length <= 1) {
    return (
      <span className="chip mono hidden h-8 items-center text-[11px] lg:inline-flex" title={t.shell.locale.label}>
        {label}
      </span>
    );
  }
  return (
    <select
      className="hidden h-8 rounded-lg border border-white/10 bg-ink-950/70 px-1.5 text-[11px] text-slate-300 lg:block"
      value={locale}
      onChange={(e) => setLocale(e.target.value)}
      title={t.shell.locale.label}
    >
      {locales.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

export function Header({
  tab,
  onTab,
  onConnectClick,
  onOpenSecurity,
  onOpenDocs,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  onConnectClick: () => void;
  onOpenSecurity: () => void;
  onOpenDocs: () => void;
}) {
  const { account, chainId, activeName, disconnect, switchToBase } = useWallet();
  const { push } = useToasts();
  const t = useT();
  const [bal, setBal] = useState<bigint>(0n);
  const wrongChain = account && chainId !== CHAIN_ID;

  useEffect(() => {
    let alive = true;
    if (!account) {
      setBal(0n);
      return;
    }
    const load = () =>
      usdcBalance(account)
        .then((v) => alive && setBal(v))
        .catch(() => alive && setBal(0n));
    void load();
    const timer = window.setInterval(load, 20_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [account]);

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-ink-950/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1240px] items-center gap-4 px-5 py-3">
        <a href="/" className="flex shrink-0 items-center gap-2.5 transition-opacity hover:opacity-90">
          <span className="sm:hidden">
            <LogoMark size={30} />
          </span>
          <span className="hidden sm:block">
            <LogoLockup size={32} />
          </span>
        </a>

        <nav className="ml-2 hidden items-center gap-1 md:flex">
          {(
            [
              ["feed", t.shell.tabs.feed],
              ["portfolio", t.shell.tabs.portfolio],
              ["activity", t.shell.tabs.activity],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => onTab(k)}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                tab === k
                  ? "bg-white/10 text-slate-100"
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span className="chip mono hidden lg:inline-flex" title={`Engine ${ENGINE_ADDRESS}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            <a
              href={`${EXPLORER}/address/${ENGINE_ADDRESS}`}
              target="_blank"
              rel="noreferrer"
              className="hover:text-brand"
            >
              {SHORT_ENGINE}
            </a>
          </span>

          <ModeSwitch
            onSwitch={(m) =>
              push({
                kind: "info",
                title: m === "paper" ? t.shell.mode.switchedPaper : t.shell.mode.switchedReal,
                body: m === "paper" ? t.shell.mode.switchedPaperBody : t.shell.mode.switchedRealBody,
              })
            }
          />
          <SoundToggle />
          <LocaleChip />

          <button
            className="btn-ghost hidden h-8 px-2.5 text-[11px] sm:inline-flex"
            onClick={onOpenSecurity}
            title={t.shell.actions.securityTitle}
          >
            🛡 {t.shell.actions.security}
          </button>
          <button
            className="btn-ghost hidden h-8 px-2.5 text-[11px] sm:inline-flex"
            onClick={onOpenDocs}
            title={t.shell.actions.docsTitle}
          >
            📚 {t.shell.actions.docs}
          </button>

          {!account ? (
            <button className="btn-primary whitespace-nowrap px-3 sm:px-4" onClick={onConnectClick}>
              {t.shell.actions.connect}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              {wrongChain && (
                <button
                  className="btn-danger"
                  onClick={() =>
                    void switchToBase().catch((e) =>
                      push({ kind: "err", title: t.shell.actions.switchFailed, body: String(e) }),
                    )
                  }
                >
                  {t.shell.actions.switchChain}
                </button>
              )}
              <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-right leading-tight">
                <div className="mono text-xs text-slate-300">{shortAddr(account)}</div>
                <div className="mono text-[11px] text-brand">
                  {usdc(bal, 2)} USDC
                  {activeName ? <span className="ml-1 text-slate-500">· {activeName}</span> : null}
                </div>
              </div>
              <button className="btn-ghost" onClick={disconnect} title={t.shell.actions.disconnect}>
                {t.shell.actions.disconnect}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto flex max-w-[1240px] gap-1 px-4 pb-2 md:hidden">
        {(
          [
            ["feed", t.shell.tabs.feedShort],
            ["portfolio", t.shell.tabs.portfolioShort],
            ["activity", t.shell.tabs.activityShort],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => onTab(k)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm ${
              tab === k ? "bg-white/10 text-slate-100" : "text-slate-400"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </header>
  );
}
