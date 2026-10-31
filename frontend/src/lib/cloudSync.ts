/**
 * Cloud sync — wallet-bound, end-to-end encrypted state.
 *
 * Why this exists: the paper ledger, the debate wall and the referral journal used to live in one
 * browser's localStorage, which made a "portfolio" a property of a device instead of a user. This
 * module turns them into an account-owned record that follows the wallet (or the Web3Auth
 * ERC-4337 smart account minted from a Google / email login) onto any device.
 *
 * Design:
 *   1. Identity  — the wallet address, plus an EIP-191 `personal_sign` over a fixed, human-readable
 *                  challenge. Nothing is broadcast; the signature only unlocks decryption.
 *   2. Sealing   — the JSON payload is encrypted with AES-GCM under a key derived from that
 *                  signature (PBKDF2-SHA256, 120k rounds, salt = sync tag). The transport therefore
 *                  only ever sees ciphertext, so even a public demo bucket leaks nothing.
 *   3. Transport — a small provider interface. Three implementations ship here:
 *                    relay    : ntfy.sh public relay, zero-config, predictable topic, 12h retention
 *                    supabase : your own project + the SQL in docs/cloud-sync.md (durable)
 *                    endpoint : the bundled server/sync-server.mjs, or any compatible REST store
 *   4. Merge     — money is last-write-wins; the trade ledger and the debate wall are unioned by id
 *                  so two devices trading offline never destroy each other's history.
 *
 * The status chip in the header reports the live phase, so "local only" is never dressed up as
 * "synced": if no provider can be reached the UI says exactly that.
 */
import { applyPaperSnapshot, snapshotPaper, subscribePaper, type PaperSnapshot } from "./paper";
import { mergeComments, snapshotComments, type Comment } from "./comments";

export interface SyncPayload {
  v: 1;
  updatedAt: number;
  device: string;
  locale: string;
  paper: PaperSnapshot;
  comments: Record<string, Comment[]>;
  referral: unknown | null;
}

export interface SealedBlob {
  iv: string;
  ct: string;
}

export interface RemoteRecord {
  updatedAt: number;
  device: string;
  blob: SealedBlob;
}

export type SyncPhase = "local" | "ready" | "syncing" | "synced" | "error";

export interface SyncStatus {
  phase: SyncPhase;
  provider: string;
  durable: boolean;
  lastSync?: number;
  error?: string;
  device: string;
}

interface Provider {
  id: string;
  label: string;
  durable: boolean;
  load: (tag: string) => Promise<RemoteRecord | null>;
  save: (tag: string, record: RemoteRecord) => Promise<void>;
}

const CHALLENGE_HEADER = "Aura Cloud Sync";
const REFERRAL_KEY = "aura.referral.v1";
const SIG_KEY = "aura.sync.sig.v1";
const STATUS_KEY = "aura.sync.status.v1";
const DEVICE_KEY = "aura.sync.device.v1";

/* ------------------------------------------------------------------ device id */

export function deviceId(): string {
  try {
    const saved = window.localStorage.getItem(DEVICE_KEY);
    if (saved) return saved;
  } catch {
    /* storage disabled */
  }
  const id = `dev-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
  try {
    window.localStorage.setItem(DEVICE_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

/* ------------------------------------------------------------------ crypto */

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Copy a view into a standalone ArrayBuffer — WebCrypto wants `BufferSource`, not a shared view. */
function buf(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function b64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (let i = 0; i < view.length; i++) out += String.fromCharCode(view[i]);
  return btoa(out);
}

function unb64(s: string): Uint8Array {
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf(utf8(input)));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Stable, address-derived key for the remote object: same wallet ⇒ same record everywhere. */
export async function syncTag(address: string): Promise<string> {
  return (await sha256Hex(`aura-sync-v1:${address.toLowerCase()}`)).slice(0, 24);
}

async function deriveKey(signature: string, tag: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", buf(utf8(signature.toLowerCase())), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: buf(utf8(`aura-sync-salt:${tag}`)), iterations: 120_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface SealKey {
  key: CryptoKey;
  tag: string;
}

export async function sealKeyFrom(address: string, signature: string): Promise<SealKey> {
  const tag = await syncTag(address);
  return { key: await deriveKey(signature, tag), tag };
}

export async function seal(payload: SyncPayload, k: SealKey): Promise<SealedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12)) as Uint8Array;
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(iv) }, k.key, buf(utf8(JSON.stringify(payload))));
  return { iv: b64(iv), ct: b64(ct) };
}

export async function open(blob: SealedBlob, k: SealKey): Promise<SyncPayload | null> {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: buf(unb64(blob.iv)) },
      k.key,
      buf(unb64(blob.ct)),
    );
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as SyncPayload;
    return parsed && parsed.v === 1 ? parsed : null;
  } catch {
    return null; // wrong key (different wallet) or tampered payload
  }
}

/* ------------------------------------------------------------------ transport: public relay */

/**
 * Public relay transport (ntfy.sh by default).
 *
 * Chosen because it is the only zero-configuration channel left that gives us a *predictable key*:
 * the topic name is derived from the wallet, so any device can find the record without being told an
 * opaque object id. Records are split into <3 kB messages and reassembled on read.
 *
 * Honest limits, surfaced in the UI as a non-durable transport: the public instance keeps cached
 * messages for ~12 hours and caps a message at 4 kB. Point `VITE_SYNC_RELAY` at a self-hosted ntfy
 * (or switch to Supabase / the bundled server) for durable storage.
 */
const RELAY = (import.meta.env.VITE_SYNC_RELAY as string | undefined)?.replace(/\/$/, "") ?? "https://ntfy.sh";
const CHUNK = 3000;

function packChunks(body: string, gid: string): string[] {
  const total = Math.max(1, Math.ceil(body.length / CHUNK));
  const out: string[] = [];
  for (let i = 0; i < total; i++) out.push(`AURA1|${gid}|${i}|${total}|${body.slice(i * CHUNK, (i + 1) * CHUNK)}`);
  return out;
}

const relayProvider: Provider = {
  id: "relay",
  label: "public relay",
  durable: false,
  async load(tag) {
    const res = await fetch(`${RELAY}/aura-sync-v1-${tag}/json?poll=1&since=all`);
    if (!res.ok) throw new Error(`relay ${res.status}`);
    const text = await res.text();
    const groups = new Map<string, Map<number, string>>();
    const totals = new Map<string, number>();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let msg: { event?: string; message?: string };
      try {
        msg = JSON.parse(line) as { event?: string; message?: string };
      } catch {
        continue;
      }
      if (msg.event !== "message" || typeof msg.message !== "string") continue;
      const m = /^AURA1\|([^|]+)\|(\d+)\|(\d+)\|([\s\S]*)$/.exec(msg.message);
      if (!m) continue;
      const [, gid, idx, total, data] = m;
      if (!groups.has(gid)) groups.set(gid, new Map());
      groups.get(gid)!.set(Number(idx), data);
      totals.set(gid, Number(total));
    }
    // Newest *complete* group wins; a half-written push must never win over the previous one.
    for (const gid of [...groups.keys()].sort().reverse()) {
      const parts = groups.get(gid)!;
      const total = totals.get(gid) ?? 0;
      if (parts.size !== total || total === 0) continue;
      let body = "";
      for (let i = 0; i < total; i++) body += parts.get(i) ?? "";
      try {
        return JSON.parse(body) as RemoteRecord;
      } catch {
        continue;
      }
    }
    return null;
  },
  async save(tag, record) {
    const gid = String(record.updatedAt);
    const chunks = packChunks(JSON.stringify(record), gid);
    for (const chunk of chunks) {
      const res = await fetch(`${RELAY}/aura-sync-v1-${tag}`, { method: "PUT", body: chunk });
      if (!res.ok) throw new Error(`relay save ${res.status}`);
    }
  },
};

/* ------------------------------------------------------------------ transport: supabase */

const SB_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const SB_TABLE = (import.meta.env.VITE_SUPABASE_TABLE as string | undefined) ?? "aura_sync";

/**
 * Supabase PostgREST. Row shape (see docs/cloud-sync.md):
 *   tag text primary key, updated_at timestamptz, device text, blob jsonb
 * RLS is left closed for anon reads by default; the documented policy allows insert/update on
 * `tag` only, and the row content is ciphertext anyway.
 */
const supabaseProvider: Provider = {
  id: "supabase",
  label: "supabase",
  durable: true,
  async load(tag) {
    const res = await fetch(`${SB_URL}/rest/v1/${SB_TABLE}?tag=eq.${encodeURIComponent(tag)}&select=*`, {
      headers: { apikey: SB_KEY!, authorization: `Bearer ${SB_KEY}` },
    });
    if (!res.ok) throw new Error(`supabase ${res.status}`);
    const rows = (await res.json()) as Array<{ blob?: RemoteRecord }>;
    return rows[0]?.blob ?? null;
  },
  async save(tag, record) {
    const res = await fetch(`${SB_URL}/rest/v1/${SB_TABLE}?on_conflict=tag`, {
      method: "POST",
      headers: {
        apikey: SB_KEY!,
        authorization: `Bearer ${SB_KEY}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([{ tag, updated_at: new Date(record.updatedAt).toISOString(), device: record.device, blob: record }]),
    });
    if (!res.ok) throw new Error(`supabase save ${res.status}`);
  },
};

/* ------------------------------------------------------------------ transport: self-hosted */

const ENDPOINT = (import.meta.env.VITE_SYNC_ENDPOINT as string | undefined)?.replace(/\/$/, "");

const endpointProvider: Provider = {
  id: "endpoint",
  label: "self-hosted",
  durable: true,
  async load(tag) {
    const res = await fetch(`${ENDPOINT}/${tag}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`sync ${res.status}`);
    return ((await res.json()) as { record?: RemoteRecord }).record ?? null;
  },
  async save(tag, record) {
    const res = await fetch(`${ENDPOINT}/${tag}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ record }),
    });
    if (!res.ok) throw new Error(`sync save ${res.status}`);
  },
};

/** First configured provider wins: self-hosted → supabase → public relay. */
export function activeProvider(): Provider {
  if (ENDPOINT) return endpointProvider;
  if (SB_URL && SB_KEY) return supabaseProvider;
  return relayProvider;
}

/* ------------------------------------------------------------------ status bus */

const listeners = new Set<(s: SyncStatus) => void>();

function emit(status: SyncStatus): void {
  try {
    window.localStorage.setItem(STATUS_KEY, JSON.stringify(status));
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn(status));
}

export function subscribeSync(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function readStatus(): SyncStatus {
  try {
    const raw = window.localStorage.getItem(STATUS_KEY);
    if (raw) return JSON.parse(raw) as SyncStatus;
  } catch {
    /* ignore */
  }
  const p = activeProvider();
  return { phase: "local", provider: p.id, durable: p.durable, device: deviceId() };
}

/* ------------------------------------------------------------------ session signature */

/**
 * The derived key is expensive to recreate and needs a wallet prompt, so the signature is kept for
 * the tab session only. Closing the tab drops it; the next visit re-signs once.
 */
function cachedSignature(): string | null {
  try {
    return window.sessionStorage.getItem(SIG_KEY);
  } catch {
    return null;
  }
}

function cacheSignature(sig: string): void {
  try {
    window.sessionStorage.setItem(SIG_KEY, sig);
  } catch {
    /* ignore */
  }
}

export function challengeFor(address: string): string {
  return [
    CHALLENGE_HEADER,
    "",
    "Sign to encrypt and sync your paper ledger across devices.",
    "Nothing is broadcast, no gas is spent, and this signature cannot move funds.",
    "",
    `Address: ${address.toLowerCase()}`,
    "Scope: paper-balance, positions, trades, referral, debate",
    "Version: 1",
  ].join("\n");
}

/* ------------------------------------------------------------------ payload */

function readReferral(): unknown | null {
  try {
    const raw = window.localStorage.getItem(REFERRAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function currentLocale(): string {
  try {
    return window.localStorage.getItem("aura.locale") ?? "en";
  } catch {
    return "en";
  }
}

function buildPayload(): SyncPayload {
  return {
    v: 1,
    updatedAt: Date.now(),
    device: deviceId(),
    locale: currentLocale(),
    paper: snapshotPaper(),
    comments: snapshotComments(),
    referral: readReferral(),
  };
}

function applyPayload(remote: SyncPayload, opts: { force?: boolean } = {}): void {
  applyPaperSnapshot(remote.paper, opts);
  mergeComments(remote.comments ?? {});
  if (remote.referral && typeof remote.referral === "object") {
    try {
      const local = readReferral() as { code?: string } | null;
      // The local invite code wins: it is the link this browser already handed out.
      if (!local?.code) window.localStorage.setItem(REFERRAL_KEY, JSON.stringify(remote.referral));
    } catch {
      /* ignore */
    }
  }
}

/* ------------------------------------------------------------------ public API */

export interface Signer {
  address: string;
  sign: (message: string) => Promise<string>;
}

export type Direction = "both" | "push" | "pull";

let inflight: Promise<SyncStatus> | null = null;

/**
 * One sync round: derive the key (reusing the session signature when possible), pull, merge,
 * push the merged result, and report the phase.
 */
export function syncNow(signer: Signer, direction: Direction = "both"): Promise<SyncStatus> {
  if (inflight) return inflight;
  inflight = run(signer, direction).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function run({ address, sign }: Signer, direction: Direction): Promise<SyncStatus> {
  const provider = activeProvider();
  const base: SyncStatus = { phase: "syncing", provider: provider.id, durable: provider.durable, device: deviceId() };
  emit(base);
  try {
    let sig = cachedSignature();
    if (!sig) {
      sig = await sign(challengeFor(address));
      cacheSignature(sig);
    }
    const k = await sealKeyFrom(address, sig);

    let remote: SyncPayload | null = null;
    if (direction !== "push") {
      const record = await provider.load(k.tag);
      if (record?.blob) remote = await open(record.blob, k);
    } else {
      // A push still needs the remote clock so it never overwrites a newer record.
      const record = await provider.load(k.tag);
      if (record?.blob) remote = await open(record.blob, k);
    }

    // First round on this device: a browser that just claimed the welcome bonus must not shadow
    // an account that already has history, so the pull is allowed to win outright.
    let firstRound = true;
    try {
      firstRound = !window.localStorage.getItem(`aura.sync.seen.${k.tag}`);
    } catch {
      /* storage disabled */
    }

    if (remote) {
      const remoteNewer = (remote.updatedAt ?? 0) > 0;
      if (remoteNewer) applyPayload(remote, { force: firstRound });
    }

    let pushed = false;
    if (direction !== "pull") {
      const payload = buildPayload();
      // Keep the newest clock of the two so a stale device cannot roll the record back.
      payload.updatedAt = Math.max(payload.updatedAt, remote?.updatedAt ?? 0);
      if (payload.locale === "en" && remote?.locale && remote.locale !== "en" && !readStatus().lastSync) {
        payload.locale = remote.locale;
      }
      await provider.save(k.tag, { updatedAt: payload.updatedAt, device: payload.device, blob: await seal(payload, k) });
      pushed = true;
      try {
        window.localStorage.setItem(`aura.sync.seen.${k.tag}`, "1");
      } catch {
        /* ignore */
      }
    }

    const status: SyncStatus = {
      phase: "synced",
      provider: provider.id,
      durable: provider.durable,
      lastSync: Date.now(),
      device: deviceId(),
    };
    emit(status);
    void pushed;
    return status;
  } catch (err) {
    const status: SyncStatus = {
      phase: "error",
      provider: provider.id,
      durable: provider.durable,
      error: err instanceof Error ? err.message : String(err),
      device: deviceId(),
    };
    emit(status);
    return status;
  }
}

/**
 * Auto-push hook: the sync loop only starts once a wallet is bound, so a visitor who never connects
 * nothing is ever uploaded. The E2E suite injects `window.__AURA_SYNC_TEST__` (address + fixed
 * signature) to exercise the real transport end-to-end without a browser wallet extension.
 */
export interface TestHook {
  address: string;
  signature: string;
}

export function readTestHook(): TestHook | null {
  if (typeof window === "undefined") return null;
  const hook = (window as unknown as { __AURA_SYNC_TEST__?: Partial<TestHook> }).__AURA_SYNC_TEST__;
  if (hook && typeof hook.address === "string" && typeof hook.signature === "string") {
    return { address: hook.address, signature: hook.signature };
  }
  return null;
}

/** Drop the cached signature (called on wallet disconnect). */
export function forgetSession(): void {
  try {
    window.sessionStorage.removeItem(SIG_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Auto-push: once a wallet is bound, every local write schedules a debounced push, so a trade or a
 * debate take travels to the cloud within a couple of seconds without a manual action.
 */
export function bindAutoPush(signer: Signer, delayMs = 2500): () => void {
  let timer = 0;
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void syncNow(signer, "both"), delayMs);
  };
  const unsubPaper = subscribePaper(schedule);
  const onLocale = () => schedule();
  window.addEventListener("aura:locale", onLocale);
  const onVisible = () => {
    if (document.visibilityState === "visible") schedule();
  };
  document.addEventListener("visibilitychange", onVisible);
  schedule(); // first round on bind
  return () => {
    window.clearTimeout(timer);
    unsubPaper();
    window.removeEventListener("aura:locale", onLocale);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
