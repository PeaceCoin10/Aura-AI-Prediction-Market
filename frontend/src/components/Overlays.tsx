import { useEffect, useState } from "react";
import { ENGINE_ADDRESS, EXPLORER, USDC_ADDRESS } from "../lib/config";
import { BRAND } from "./BrandLogo";
import { play } from "../lib/sound";
import { useT } from "../lib/i18n";

const ENGINE = ENGINE_ADDRESS;
const USDC = USDC_ADDRESS;

/** Security matrix data: every figure comes from a real run in this repo (see docs/SECURITY.md). */
export const SECURITY_FACTS = {
  slither: {
    high: 0,
    medium: 0,
    low: 12,
    info: 7,
    note: "Slither 0.10.0, measured: 19 findings = 0 High + 0 Medium + 12 Low (block.timestamp) + 7 Informational (solc version / complexity). Full JSON: docs/security/slither-report.json",
  },
  tests: { forge: 46, invariantCalls: 102400, invariantRuns: 512, invariantDepth: 200 },
  disputeWindow: "1 hour",
  fee: "1.5% trade / 0.5% settlement",
  safe: "the Safe multisig can overrideResolution and overturn the outcome inside the dispute window",
  verified: [ENGINE, USDC],
};

const RISK_KEY = "aura.risk.ack.v1";

/** First-run risk disclosure modal (compliance). */
export function RiskModal() {
  const t = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(RISK_KEY)) setOpen(true);
    } catch {
      /* ignore */
    }
  }, []);

  const ack = () => {
    try {
      window.localStorage.setItem(RISK_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    play("click");
    setOpen(false);
    // Release the welcome pack (airdrop modal): risk acknowledgement first, chips right after
    try {
      window.dispatchEvent(new CustomEvent("aura:risk-ack"));
    } catch {
      /* ignore */
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4">
      <div className="glass-panel w-full max-w-lg rounded-3xl p-5 animate-fade-in">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-lg">⚠️</span>
          <h2 className="text-base font-semibold text-slate-100">{t.security.risk.title}</h2>
        </div>
        <ul className="space-y-2 text-[12.5px] leading-relaxed text-slate-300">
          <li>· {t.security.risk.bulletProtocol}</li>
          <li>· {t.security.risk.bulletPrice}</li>
          <li>· {t.security.risk.bulletDispute}</li>
          <li>· {t.security.risk.bulletPaper}</li>
          <li>· {t.security.risk.bulletAudit}</li>
        </ul>
        <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-[11px] text-slate-400">
          {t.security.risk.consent}
        </div>
        <button className="btn-primary mt-4 w-full" onClick={ack}>
          {t.security.risk.ack}
        </button>
      </div>
    </div>
  );
}

/** Security center drawer: Slither / invariant tests / dispute window / Safe override. */
export function SecurityDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  if (!open) return null;
  return (
    <Drawer title={t.security.drawer.title} onClose={onClose}>
      <div className="space-y-3">
        <Card title={t.security.drawer.slither.title}>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Metric
              label={t.security.drawer.slither.high}
              value={String(SECURITY_FACTS.slither.high)}
              tone="text-brand"
            />
            <Metric
              label={t.security.drawer.slither.medium}
              value={String(SECURITY_FACTS.slither.medium)}
              tone="text-brand"
            />
            <Metric
              label={t.security.drawer.slither.low}
              value={String(SECURITY_FACTS.slither.low)}
              tone="text-amber-300"
            />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{SECURITY_FACTS.slither.note}</p>
        </Card>

        <Card title={t.security.drawer.tests.title}>
          <ul className="space-y-1.5 text-[12px] text-slate-300">
            <li>
              · {t.security.drawer.tests.forgeLead}
              <span className="mono text-brand">{SECURITY_FACTS.tests.forge}</span>
              {t.security.drawer.tests.forgeTail}
            </li>
            <li>
              · {t.security.drawer.tests.invariantLead}
              <span className="mono text-brand">{SECURITY_FACTS.tests.invariantRuns}</span>
              {t.security.drawer.tests.invariantRunsDepth}
              <span className="mono text-brand">{SECURITY_FACTS.tests.invariantDepth}</span>
              {t.security.drawer.tests.invariantCallsLead}
              <span className="mono text-brand">{SECURITY_FACTS.tests.invariantCalls.toLocaleString()}</span>
              {t.security.drawer.tests.invariantTail}
            </li>
            <li>· {t.security.drawer.tests.coverage}</li>
          </ul>
        </Card>

        <Card title={t.security.drawer.economics.title}>
          <ul className="space-y-1.5 text-[12px] text-slate-300">
            <li>
              · {t.security.drawer.economics.feeLead}
              {SECURITY_FACTS.fee}
              {t.security.drawer.economics.feeTail}
            </li>
            <li>
              · {t.security.drawer.economics.disputeLead}
              {SECURITY_FACTS.disputeWindow}
              {t.security.drawer.economics.disputeTail}
            </li>
            <li>
              · {t.security.drawer.economics.overrideLead}
              {SECURITY_FACTS.safe}
            </li>
            <li>
              · {t.security.drawer.economics.emergencyLead}
              {t.security.drawer.economics.emergencyWindow}
              {t.security.drawer.economics.emergencyMid}
              <span className="mono">emergencyRefund</span>
              {t.security.drawer.economics.emergencyTail}
            </li>
          </ul>
        </Card>

        <Card title={t.security.drawer.verified.title}>
          <div className="space-y-1.5 text-[11.5px]">
            {SECURITY_FACTS.verified.map((a) => (
              <a
                key={a}
                href={`${EXPLORER}/address/${a}#code`}
                target="_blank"
                rel="noreferrer"
                className="mono block truncate rounded-lg border border-white/8 bg-white/[0.02] px-2 py-1.5 text-slate-300 hover:border-brand/40 hover:text-brand"
              >
                {a} <span className="text-brand">{t.security.drawer.verified.badge}</span>
              </a>
            ))}
          </div>
        </Card>
      </div>
    </Drawer>
  );
}

/** Docs portal: getting started / Hermes AI architecture / SDK integration. */
export function DocsPortal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [tab, setTab] = useState<"start" | "brain" | "sdk">("start");
  if (!open) return null;
  return (
    <Drawer title={t.security.docs.title} onClose={onClose} wide>
      <div className="mb-3 flex gap-1.5">
        {(
          [
            ["start", t.security.docs.tabs.start],
            ["brain", t.security.docs.tabs.brain],
            ["sdk", t.security.docs.tabs.sdk],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-lg px-2.5 py-1 text-[12px] transition-colors ${
              tab === k ? "bg-brand/20 text-brand" : "text-slate-400 hover:bg-white/5"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "start" && (
        <div className="space-y-3 text-[12.5px] leading-relaxed text-slate-300">
          <H>{t.security.docs.start.headingPaper}</H>
          <ol className="list-decimal space-y-1 pl-5">
            {t.security.docs.start.paperSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <H>{t.security.docs.start.headingReal}</H>
          <ol className="list-decimal space-y-1 pl-5">
            {t.security.docs.start.realSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <H>{t.security.docs.start.headingFees}</H>
          <p>{t.security.docs.start.feesBody}</p>
        </div>
      )}

      {tab === "brain" && (
        <div className="space-y-3 text-[12.5px] leading-relaxed text-slate-300">
          <H>{t.security.docs.brain.headingEngines}</H>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <b>{t.security.docs.brain.creator}</b>
              {t.security.docs.brain.creatorBody}
            </li>
            <li>
              <b>{t.security.docs.brain.oracle}</b>
              {t.security.docs.brain.oracleBody}
            </li>
            <li>
              <b>{t.security.docs.brain.marketing}</b>
              {t.security.docs.brain.marketingBody}
            </li>
          </ul>
          <H>{t.security.docs.brain.headingConstraints}</H>
          <p>{t.security.docs.brain.constraintsBody}</p>
          <H>{t.security.docs.brain.headingCommentary}</H>
          <p>
            {t.security.docs.brain.commentaryLead}
            <code className="mono text-brand">insights.json</code>
            {t.security.docs.brain.commentaryTail}
          </p>
        </div>
      )}

      {tab === "sdk" && (
        <div className="space-y-3 text-[12.5px] leading-relaxed text-slate-300">
          <H>{t.security.docs.sdk.headingInstall}</H>
          <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/60 p-3 text-[11.5px] leading-relaxed text-slate-200">
{`import { CentralPredictionSDK } from "@prediction/sdk";

// 1) You only supply eth_call; the wallet sends transactions
const transport = {
  ethCall: (to, data) => provider.request({ method: "eth_call", params: [{ to, data }, "latest"] }),
};

const sdk = new CentralPredictionSDK(transport, {
  engine: "${ENGINE}",
  chainId: 8453,
  account,            // optional: pass it to enable role / position prechecks
});`}
          </pre>
          <H>{t.security.docs.sdk.headingRead}</H>
          <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/60 p-3 text-[11.5px] leading-relaxed text-slate-200">
{`const n = await sdk.marketCount();
const ids = await Promise.all([...Array(n)].map((_, i) => sdk.marketId(i)));
// one Multicall3 read returns every market (YES/NO reserves, price, volume)
const snaps = await sdk.marketSnapshots(ids, { withMeta: true });`}
          </pre>
          <H>{t.security.docs.sdk.headingOrder}</H>
          <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/60 p-3 text-[11.5px] leading-relaxed text-slate-200">
{`// outcome: 1 = YES, 0 = NO — matches the contract enum, do not invert
const plan = await sdk.buildBuyShares({
  marketId: ids[0],
  outcome: 1,
  amountIn: 20_000_000n,   // 20 USDC (6 decimals)
  slippageBps: 100n,       // 1% protection, required
});
const hash = await wallet.sendTransaction(plan);`}
          </pre>
          <p className="text-[11px] text-slate-500">{t.security.docs.sdk.footnote}</p>
        </div>
      )}
    </Drawer>
  );
}

function Drawer({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-[65] flex justify-end bg-black/70" onClick={onClose}>
      <aside
        className={`glass-panel h-full w-full ${wide ? "max-w-2xl" : "max-w-md"} overflow-y-auto rounded-none border-y-0 border-r-0 p-4 animate-fade-in`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          <button
            className="btn-ghost ml-auto px-2.5 py-1 text-xs"
            onClick={() => {
              play("click");
              onClose();
            }}
          >
            {t.security.common.close}
          </button>
        </div>
        {children}
        <p className="mt-4 text-center text-[10px] text-slate-600">
          {BRAND.name} · {BRAND.tagline}
        </p>
      </aside>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">{title}</h3>
      {children}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-white/8 bg-black/30 px-2 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mono text-xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h4 className="mt-1 text-[12px] font-semibold text-slate-200">{children}</h4>;
}
