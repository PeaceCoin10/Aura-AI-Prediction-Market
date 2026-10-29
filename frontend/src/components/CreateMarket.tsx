import { useState } from "react";
import { keccak256, toHex, encodeFunctionData } from "viem";
import { SdkError, parseUsdc, type TxPlan } from "@sdk";
import { CATEGORIES } from "../lib/config";
import { makeSdk, publicClient, ENGINE_EXTRA_ABI } from "../lib/sdk";
import { useWallet } from "../lib/wallet";
import { useToasts } from "../hooks/useToasts";
import { errText } from "../lib/format";
import { Spinner } from "./ui";
import { ENGINE_ADDRESS } from "../lib/config";
import { format, useT } from "../lib/i18n";

/** Create a market, optionally seeding it (CREATOR only; on mainnet CREATOR = the deployer EOA). */
export function CreateMarket({ onDone }: { onDone: () => void }) {
  const { account, sendTransaction, ensureUsdcAllowance } = useWallet();
  const { push } = useToasts();
  const t = useT();
  const [question, setQuestion] = useState("");
  const [category, setCategory] = useState<string>("crypto");
  const [hours, setHours] = useState(24);
  const [seed, setSeed] = useState("100");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const [open, setOpen] = useState(false);

  const submit = async () => {
    if (!account) {
      setErr(t.portfolio.create.noWallet);
      return;
    }
    setBusy(true);
    setErr(undefined);
    try {
      const sdk = makeSdk(account);
      const marketId = keccak256(toHex(`${question}|${category}|${Date.now()}`));
      const resolutionTime = BigInt(Math.floor(Date.now() / 1000) + hours * 3600);
      const plan: TxPlan = await sdk.buildCreateMarket({
        marketId,
        question,
        resolutionTime,
        meta: { category },
      });
      const h1 = await sendTransaction({ to: plan.to as `0x${string}`, data: plan.data });
      push({ kind: "trade", title: t.portfolio.create.submittedTitle, body: plan.summary, hash: h1 });
      await publicClient.waitForTransactionReceipt({ hash: h1 });

      const seedAmount = seed.trim() ? parseUsdc(seed) : 0n;
      if (seedAmount > 0n) {
        await ensureUsdcAllowance(seedAmount);
        const data = encodeFunctionData({
          abi: ENGINE_EXTRA_ABI,
          functionName: "seedLiquidity",
          args: [marketId, seedAmount],
        });
        const h2 = await sendTransaction({ to: ENGINE_ADDRESS, data });
        push({
          kind: "trade",
          title: t.portfolio.create.seededTitle,
          body: format(t.portfolio.create.seededBody, { amount: seed }),
          hash: h2,
        });
        await publicClient.waitForTransactionReceipt({ hash: h2 });
      }
      push({ kind: "ok", title: t.portfolio.create.liveTitle, body: question, hash: h1 });
      setQuestion("");
      setOpen(false);
      onDone();
    } catch (e) {
      const msg = e instanceof SdkError ? e.message : errText(e);
      setErr(msg);
      push({ kind: "err", title: t.portfolio.create.failedTitle, body: msg });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="btn-ghost" onClick={() => setOpen(true)}>
        {t.portfolio.create.open}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4">
      <div className="card w-full max-w-lg p-5">
        <h3 className="mb-1 text-base font-semibold text-slate-100">{t.portfolio.create.title}</h3>
        <p className="mb-3 text-[11px] text-slate-500">{t.portfolio.create.subtitle}</p>

        <label className="label">{t.portfolio.create.questionLabel}</label>
        <textarea
          className="input h-20 resize-none"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t.portfolio.create.questionPlaceholder}
        />

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="label">{t.portfolio.create.categoryLabel}</label>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t.portfolio.create.hoursLabel}</label>
            <input
              className="input mono"
              type="number"
              min={1}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value) || 1)}
            />
          </div>
        </div>

        <label className="label mt-3">{t.portfolio.create.seedLabel}</label>
        <input className="input mono" value={seed} onChange={(e) => setSeed(e.target.value)} />

        {err && (
          <div className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger">
            {err}
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button className="btn-ghost flex-1" onClick={() => setOpen(false)} disabled={busy}>
            {t.portfolio.create.cancel}
          </button>
          <button className="btn-primary flex-1" onClick={() => void submit()} disabled={busy}>
            {busy ? <Spinner /> : null} {t.portfolio.create.submit}
          </button>
        </div>
      </div>
    </div>
  );
}
