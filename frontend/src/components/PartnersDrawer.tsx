import { useState } from "react";
import { useT } from "../lib/i18n";
import { Drawer } from "./Overlays";

const REPO = "https://github.com/PeaceCoin10/Aura-AI-Prediction-Market";
const ENGINE = "0xE6056Bc6700F6d7E6fF8779B212655284dc1631C";

type Kind = "mm" | "oracle" | "dapp" | "audit";

/**
 * Institutional ecosystem portal.
 *
 * Two zones, deliberately separated: what is actually integrated in this repository (verifiable by
 * reading the code), and the commercial tracks that are open for engagement. No logo wall and no
 * implied endorsement — a name appears in the first zone only when an integration exists.
 *
 * The desk form has no backend: it opens a pre-filled GitHub issue on the public repo, the channel
 * we really triage from.
 */
export function PartnersDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const p = t.shell.partners;
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [kind, setKind] = useState<Kind>("mm");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"" | "need" | "bad" | "ready">("");

  const kinds: Array<{ key: Kind; label: string }> = [
    { key: "mm", label: p.kindMm },
    { key: "oracle", label: p.kindOracle },
    { key: "dapp", label: p.kindDapp },
    { key: "audit", label: p.kindAudit },
  ];

  const integrations = [
    { name: p.intBase, role: p.intBaseRole },
    { name: p.intUsdc, role: p.intUsdcRole },
    { name: p.intOracle, role: p.intOracleRole },
    { name: p.intTape, role: p.intTapeRole },
    { name: p.intSports, role: p.intSportsRole },
    { name: p.intArt, role: p.intArtRole },
  ];

  const tracks = [
    {
      id: "mm",
      title: p.mmTitle,
      body: p.mmBody,
      bullets: [p.mmBullet1, p.mmBullet2, p.mmBullet3],
      cls: "text-brand",
    },
    {
      id: "oracle",
      title: p.oracleTitle,
      body: p.oracleBody,
      bullets: [p.oracleBullet1, p.oracleBullet2, p.oracleBullet3],
      cls: "text-sky-300",
    },
    {
      id: "audit",
      title: p.auditTitle,
      body: p.auditBody,
      bullets: [p.auditBullet1, p.auditBullet2, p.auditBullet3],
      cls: "text-amber-300",
    },
    { id: "infra", title: p.infraTitle, body: p.infraBody, bullets: [] as string[], cls: "text-slate-200" },
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
    const title = `[Institutional] ${org.trim()} — ${kindLabel}`;
    const body = [
      `**Name:** ${name.trim()}`,
      `**Organisation:** ${org.trim()}`,
      `**Type:** ${kindLabel}`,
      `**Work email:** ${email.trim()}`,
      "",
      note.trim() ? `**Mandate / scope:**\n${note.trim()}` : "**Mandate / scope:** —",
      "",
      `_Filed from the institutional portal · engine ${ENGINE}_`,
    ].join("\n");
    const url = `${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=institutional`;
    setState("ready");
    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (!open) return null;

  return (
    <Drawer title={p.title} onClose={onClose} wide>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[12.5px] leading-relaxed text-slate-400">{p.subtitle}</p>
        <span className="chip text-[9.5px] text-brand">{p.liveBadge}</span>
      </div>

      <div className="mt-4 space-y-3">
        <section data-testid="partners-integrations" className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
          <h3 className="text-[13px] font-semibold text-slate-100">{p.integrationsTitle}</h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500">{p.integrationsBody}</p>
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {integrations.map((row) => (
              <li key={row.name} className="rounded-lg border border-white/5 bg-ink-950/40 px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                  <span className="text-[11.5px] font-medium text-slate-200">{row.name}</span>
                </div>
                <p className="mt-0.5 pl-3 text-[10px] leading-snug text-slate-500">{row.role}</p>
              </li>
            ))}
          </ul>
        </section>

        <section data-testid="partners-tracks" className="space-y-2">
          <h3 className="text-[13px] font-semibold text-slate-100">{p.tracksTitle}</h3>
          {tracks.map((track) => (
            <article key={track.id} data-testid={`partners-${track.id}`} className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
              <h4 className={`text-[12.5px] font-semibold ${track.cls}`}>{track.title}</h4>
              <p className="mt-1 text-[11.5px] leading-relaxed text-slate-400">{track.body}</p>
              {track.bullets.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-[11px] leading-relaxed text-slate-500">
                  {track.bullets.map((line) => (
                    <li key={line} className="flex gap-1.5">
                      <span className="text-slate-600">▸</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </section>

        <section id="partners-form" data-testid="partners-form" className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <h3 className="text-[13px] font-semibold text-slate-100">{p.deskTitle}</h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-slate-400">{p.deskBody}</p>
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

        <p className="px-1 text-[10px] leading-relaxed text-slate-600">{p.disclaimer}</p>
      </div>
    </Drawer>
  );
}
