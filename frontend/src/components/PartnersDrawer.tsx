import { useState } from "react";
import { useT } from "../lib/i18n";
import { Drawer } from "./Overlays";

const REPO = "https://github.com/PeaceCoin10/Aura-AI-Prediction-Market";
const ENGINE = "0xE6056Bc6700F6d7E6fF8779B212655284dc1631C";

type Kind = "lp" | "oracle" | "dapp" | "dev";

/**
 * Partners portal: the commercial and integration front door.
 *
 * Every claim here is one the protocol actually keeps: LP depth trades on the same curve as
 * public flow, fees route to ProtocolFeeVault, and the SDK is the typed client in `sdk/`.
 * The application form has no backend — it opens a pre-filled GitHub issue on the public repo,
 * which is the channel we really triage from, so no data goes to a mailbox nobody reads.
 */
export function PartnersDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const p = t.shell.partners;
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [kind, setKind] = useState<Kind>("lp");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"" | "need" | "bad" | "ready">("");

  const kinds: Array<{ key: Kind; label: string }> = [
    { key: "lp", label: p.kindLp },
    { key: "oracle", label: p.kindOracle },
    { key: "dapp", label: p.kindDapp },
    { key: "dev", label: p.kindDev },
  ];

  const submit = () => {
    if (!name.trim() || !org.trim() || !email.trim()) {
      setState("need");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setState("bad");
      return;
    }
    const kindLabel = kinds.find((k) => k.key === kind)?.label ?? kind;
    const title = `[Partnership] ${org.trim()} — ${kindLabel}`;
    const body = [
      `**Name:** ${name.trim()}`,
      `**Organisation:** ${org.trim()}`,
      `**Type:** ${kindLabel}`,
      `**Email:** ${email.trim()}`,
      "",
      note.trim() ? `**Notes:**\n${note.trim()}` : "**Notes:** —",
      "",
      `_Filed from the Partners portal · engine ${ENGINE}_`,
    ].join("\n");
    const url = `${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=partnership`;
    setState("ready");
    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (!open) return null;

  return (
    <Drawer title={p.title} onClose={onClose} wide>
      <p className="text-[12.5px] leading-relaxed text-slate-400">{p.subtitle}</p>

      <div className="mt-4 space-y-3">
        {/* Liquidity providers */}
        <section data-testid="partners-lp" className="rounded-xl border border-brand/25 bg-brand/[0.06] p-3">
          <h3 className="text-[13px] font-semibold text-brand">{p.lpTitle}</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-300">{p.lpBody}</p>
          <ul className="mt-2 space-y-1 text-[11.5px] leading-relaxed text-slate-400">
            {[p.lpBullet1, p.lpBullet2, p.lpBullet3].map((line) => (
              <li key={line} className="flex gap-1.5">
                <span className="text-brand">▸</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 mono text-[10.5px] text-slate-500">{p.lpMin}</p>
          <a
            href="#partners-form"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById("partners-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
            className="mt-2 inline-flex rounded-lg border border-brand/40 bg-brand/15 px-2.5 py-1 text-[11px] font-medium text-brand transition hover:bg-brand/25"
          >
            {p.lpApply}
          </a>
        </section>

        {/* Data & oracles */}
        <section data-testid="partners-oracle" className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
          <h3 className="text-[13px] font-semibold text-slate-200">{p.oracleTitle}</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-400">{p.oracleBody}</p>
          <ul className="mt-2 space-y-1 text-[11.5px] leading-relaxed text-slate-500">
            {[p.oracleBullet1, p.oracleBullet2, p.oracleBullet3].map((line) => (
              <li key={line} className="flex gap-1.5">
                <span className="text-sky-400">▸</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Builders */}
        <section data-testid="partners-dev" className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
          <h3 className="text-[13px] font-semibold text-slate-200">{p.devTitle}</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-400">{p.devBody}</p>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-white/10 bg-ink-950/60 p-2 text-[10.5px] leading-relaxed text-slate-300">
{`import { CentralPredictionSDK } from "@prediction/sdk";

const sdk = new CentralPredictionSDK(transport, {
  engine: "${ENGINE.slice(0, 10)}…${ENGINE.slice(-6)}",
  chainId: 8453,
});
const quote = await sdk.previewBuyYes(marketId, 1_000_000n);`}
          </pre>
          <div className="mt-1.5 flex flex-wrap gap-2 text-[10.5px] text-slate-500">
            <span className="mono">{p.devSdk}</span>
            <span className="mono text-slate-600">·</span>
            <span className="mono">{p.devApi}</span>
          </div>
          <div className="mt-2 flex gap-3 text-[11px]">
            <a href={REPO} target="_blank" rel="noreferrer" className="text-brand underline-offset-2 hover:underline">
              {p.devRepo}
            </a>
            <a
              href={`${REPO}/blob/main/docs/WHITEPAPER.md`}
              target="_blank"
              rel="noreferrer"
              className="text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
            >
              {p.devDocs}
            </a>
          </div>
        </section>

        {/* Economics */}
        <section className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
          <h3 className="text-[13px] font-semibold text-slate-200">{p.feeTitle}</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-400">{p.feeBody}</p>
        </section>

        {/* Form */}
        <section id="partners-form" data-testid="partners-form" className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <h3 className="text-[13px] font-semibold text-slate-200">{p.formTitle}</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="text-[10.5px] uppercase tracking-wide text-slate-500">
              {p.formName}
              <input
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 60))}
                className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950/50 px-2 py-1.5 text-[12px] normal-case tracking-normal text-slate-200 focus:border-brand/40 focus:outline-none"
              />
            </label>
            <label className="text-[10.5px] uppercase tracking-wide text-slate-500">
              {p.formOrg}
              <input
                value={org}
                onChange={(e) => setOrg(e.target.value.slice(0, 80))}
                className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950/50 px-2 py-1.5 text-[12px] normal-case tracking-normal text-slate-200 focus:border-brand/40 focus:outline-none"
              />
            </label>
            <label className="text-[10.5px] uppercase tracking-wide text-slate-500">
              {p.formKind}
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950/50 px-2 py-1.5 text-[12px] normal-case tracking-normal text-slate-200 focus:border-brand/40 focus:outline-none"
              >
                {kinds.map((k) => (
                  <option key={k.key} value={k.key} className="bg-ink-950">
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[10.5px] uppercase tracking-wide text-slate-500">
              {p.formEmail}
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value.slice(0, 120))}
                inputMode="email"
                className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950/50 px-2 py-1.5 text-[12px] normal-case tracking-normal text-slate-200 focus:border-brand/40 focus:outline-none"
              />
            </label>
          </div>
          <label className="mt-2 block text-[10.5px] uppercase tracking-wide text-slate-500">
            {p.formNote}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 600))}
              rows={3}
              className="mt-1 w-full resize-none rounded-lg border border-white/10 bg-ink-950/50 px-2 py-1.5 text-[12px] normal-case tracking-normal leading-relaxed text-slate-200 focus:border-brand/40 focus:outline-none"
            />
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={submit}
              data-testid="partners-submit"
              className="rounded-lg border border-brand/40 bg-brand/15 px-3 py-1.5 text-[11.5px] font-medium text-brand transition hover:bg-brand/25"
            >
              {p.formSubmit}
            </button>
            {state === "need" && <span className="text-[10.5px] text-danger">{p.formNeed}</span>}
            {state === "bad" && <span className="text-[10.5px] text-danger">{p.formBadEmail}</span>}
            {state === "ready" && <span className="text-[10.5px] text-brand">{p.formReady}</span>}
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-slate-600">{p.formHint}</p>
        </section>
      </div>
    </Drawer>
  );
}
