import { useCallback, useEffect, useRef, useState } from "react";
import { decodeLogs, formatUsdc, type DecodedEvent, type EventName } from "@sdk";
import { publicClient } from "../lib/sdk";
import { ENGINE_ADDRESS } from "../lib/config";
import { eventLabel, shortTime, outcomeText } from "../lib/events";
import { errText } from "../lib/format";
import { format } from "../lib/i18n";
import { en } from "../locales/en";
import { useToasts } from "./useToasts";

export interface FeedItem {
  key: string;
  at: number;
  blockNumber?: number;
  event: DecodedEvent;
}

/** viem Log (bigint block number) → SDK RawLog (string|number) */
function toRawLogs(logs: readonly { address: string; topics: readonly string[]; data: string; logIndex: number | null; blockNumber: bigint | null; transactionHash: string | null }[]) {
  return logs.map((l) => ({
    address: l.address,
    topics: [...l.topics],
    data: l.data,
    logIndex: l.logIndex ?? 0,
    blockNumber: l.blockNumber === null ? undefined : Number(l.blockNumber),
    transactionHash: l.transactionHash ?? undefined,
  }));
}

/** Event → (title, body), shared by toasts and the activity feed */
export function describeEvent(ev: DecodedEvent): { title: string; body: string; kind: "ok" | "info" | "trade" } {
  const a = ev.args;
  const n = ev.name as EventName;
  const name = eventLabel(n);
  const num = (v: unknown) => (typeof v === "bigint" ? v : 0n);
  const c = en.content.eventFeed;
  switch (n) {
    case "MarketCreated":
      return {
        title: format(c.createdTitle, { label: name, question: String(a.question ?? "").slice(0, 46) }),
        body: format(c.createdBody, { category: String(a.category ?? "general"), when: shortTime(num(a.resolutionTime)) }),
        kind: "info",
      };
    case "LiquiditySeeded":
      return { title: name, body: format(c.liquidityBody, { amount: formatUsdc(num(a.amount)) }), kind: "info" };
    case "SharesBought":
      return {
        title: format(c.tradeTitle, { label: name, outcome: outcomeText(Number(a.outcome)) }),
        body: format(c.buyBody, {
          amount: formatUsdc(num(a.amountIn)),
          shares: formatUsdc(num(a.sharesOut)),
          fee: formatUsdc(num(a.fee)),
        }),
        kind: "trade",
      };
    case "SharesSold":
      return {
        title: format(c.tradeTitle, { label: name, outcome: outcomeText(Number(a.outcome)) }),
        body: format(c.sellBody, {
          shares: formatUsdc(num(a.sharesIn)),
          amount: formatUsdc(num(a.amountOut)),
        }),
        kind: "trade",
      };
    case "MarketResolved":
      return {
        title: format(c.resolvedTitle, { label: name, outcome: outcomeText(Number(a.outcome)) }),
        body: a.emergency ? c.resolvedBodyEmergency : c.resolvedBody,
        kind: "info",
      };
    case "DisputeWindowOpened":
      return {
        title: name,
        body: format(c.disputeBody, { when: shortTime(num(a.disputeEndsAt)) }),
        kind: "info",
      };
    case "ResolutionOverridden":
      return {
        title: format(c.overrideTitle, {
          label: name,
          from: outcomeText(Number(a.oldOutcome)),
          to: outcomeText(Number(a.newOutcome)),
        }),
        body: format(c.overrideBody, { count: String(num(a.disputes)) }),
        kind: "trade",
      };
    case "Redeemed":
      return {
        title: name,
        body: format(c.redeemedBody, {
          payout: formatUsdc(num(a.payout)),
          yes: formatUsdc(num(a.yesBurned)),
          no: formatUsdc(num(a.noBurned)),
        }),
        kind: "ok",
      };
    case "Paused":
      return { title: name, body: c.pausedBody, kind: "trade" };
    default:
      return { title: name, body: "", kind: "info" };
  }
}

/**
 * Live event stream: incremental eth_getLogs → SDK decodeLogs → toasts + feed list.
 * Not using eth_getLogs filters: public RPC filters expire, polling is more reliable.
 */
export function useEventFeed(enabled = true, pollMs = 8_000) {
  const { push } = useToasts();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [error, setError] = useState<string | undefined>();
  const lastBlock = useRef<bigint | null>(null);
  const seen = useRef<Set<string>>(new Set());

  const ingest = useCallback(
    (events: DecodedEvent[], blockNumber?: number) => {
      if (!events.length) return;
      const fresh: FeedItem[] = [];
      for (const ev of events) {
        const key = `${ev.transactionHash ?? ""}:${ev.logIndex ?? 0}`;
        if (seen.current.has(key)) continue;
        seen.current.add(key);
        fresh.push({ key, at: Date.now(), blockNumber: ev.blockNumber ?? blockNumber, event: ev });
      }
      if (!fresh.length) return;
      setItems((prev) => [...fresh, ...prev].slice(0, 200));
      for (const item of fresh.slice(0, 3)) {
        const d = describeEvent(item.event);
        push({ kind: d.kind, title: d.title, body: d.body, hash: item.event.transactionHash }, 8000);
      }
    },
    [push],
  );

  const tick = useCallback(async () => {
    try {
      const latest = await publicClient.getBlockNumber();
      if (lastBlock.current === null) {
        // First load: backfill the last 1800 blocks
        const from = latest > 1800n ? latest - 1800n : 0n;
        const logs = await publicClient.getLogs({ address: ENGINE_ADDRESS, fromBlock: from, toBlock: latest });
        const decoded = decodeLogs(toRawLogs(logs));
        ingest(decoded.reverse());
        lastBlock.current = latest;
        return;
      }
      if (latest <= lastBlock.current) return;
      const from = lastBlock.current + 1n;
      const logs = await publicClient.getLogs({ address: ENGINE_ADDRESS, fromBlock: from, toBlock: latest });
      lastBlock.current = latest;
      const decoded = decodeLogs(toRawLogs(logs));
      ingest(decoded);
      setError(undefined);
    } catch (e) {
      setError(errText(e));
    }
  }, [ingest]);

  useEffect(() => {
    if (!enabled) return;
    void tick();
    const t = window.setInterval(() => void tick(), pollMs);
    return () => window.clearInterval(t);
  }, [enabled, tick, pollMs]);

  /** Append a local row (immediate feedback after a send, before the block lands) */
  const pushLocal = useCallback((item: Omit<FeedItem, "key" | "at">) => {
    const key = `local:${Date.now()}`;
    setItems((prev) => [{ key, at: Date.now(), ...item }, ...prev].slice(0, 200));
  }, []);

  return { items, error, pushLocal };
}
