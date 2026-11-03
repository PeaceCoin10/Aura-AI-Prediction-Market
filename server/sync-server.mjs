#!/usr/bin/env node
/**
 * Aura cloud-sync reference server.
 *
 * A single-file, dependency-free store for the encrypted sync blobs produced by
 * `frontend/src/lib/cloudSync.ts`. It stores ciphertext keyed by a wallet-derived tag: it cannot
 * read a ledger, it cannot forge one, and it holds no identity data beyond the opaque tag.
 *
 * Endpoints
 *   GET  /health                 → { ok, objects, uptime }
 *   POST /v1/attribution         → { ok, queued }   append one attribution candidate (JSONL)
 *   GET  /v1/blob/:tag           → { record } | 404
 *   PUT  /v1/blob/:tag           → { ok, tag, updatedAt }
 *   DELETE /v1/blob/:tag         → { ok }        (only with SYNC_ADMIN_TOKEN)
 *
 * Configuration (env)
 *   PORT            default 8787
 *   SYNC_DATA_DIR   default ./.sync-store
 *   SYNC_AUTH_TOKEN optional; when set, clients must send `Authorization: Bearer <token>`
 *   SYNC_ADMIN_TOKEN optional; required for DELETE
 *   SYNC_MAX_BYTES  default 262144
 *
 * Run:  node server/sync-server.mjs
 * Then point the frontend at it:  VITE_SYNC_ENDPOINT=http://127.0.0.1:8787/v1/blob
 */
import { createServer } from "node:http";
import { mkdir, readFile, writeFile, unlink, readdir, appendFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = resolve(process.env.SYNC_DATA_DIR ?? join(HERE, "..", ".sync-store"));
const AUTH = process.env.SYNC_AUTH_TOKEN ?? "";
const ADMIN = process.env.SYNC_ADMIN_TOKEN ?? "";
const MAX_BYTES = Number(process.env.SYNC_MAX_BYTES ?? 262144);
const STARTED = Date.now();

const TAG_RE = /^[a-z0-9-]{6,64}$/;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,HEAD,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
  "access-control-max-age": "86400",
};

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS,
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function authorized(req) {
  if (!AUTH) return true;
  return req.headers.authorization === `Bearer ${AUTH}`;
}

function validRecord(rec) {
  if (!rec || typeof rec !== "object") return false;
  if (typeof rec.updatedAt !== "number" || !Number.isFinite(rec.updatedAt)) return false;
  if (typeof rec.device !== "string" || rec.device.length > 64) return false;
  const blob = rec.blob;
  if (!blob || typeof blob.iv !== "string" || typeof blob.ct !== "string") return false;
  if (blob.iv.length > 128 || blob.ct.length > MAX_BYTES) return false;
  return true;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error("payload_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function countObjects() {
  try {
    return (await readdir(DATA_DIR)).filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

/**
 * Attribution ingest.
 *
 * The frontend cannot hold the operator key, so it only posts "this wallet arrived with ref X and
 * sent tx Y". Nothing here is trusted: the indexer worker re-reads the receipt on Base and only the
 * engine's own SharesBought / SharesSold logs decide whether a rebate is credited. This endpoint is
 * a queue, not an oracle.
 */
const ATTR_FILE = process.env.ATTR_FILE ?? join(DATA_DIR, "attribution.jsonl");
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TX_RE = /^0x[0-9a-fA-F]{64}$/;

async function queueAttribution(raw) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return { status: 400, payload: { error: "bad_json" } };
  }
  const tx = String(body.tx_hash ?? "").trim().toLowerCase();
  const referrer = String(body.referrer ?? "").trim().toLowerCase();
  const trader = body.trader ? String(body.trader).trim().toLowerCase() : undefined;
  if (!TX_RE.test(tx)) return { status: 400, payload: { error: "bad_tx_hash" } };
  if (!ADDRESS_RE.test(referrer) || /^0x0{40}$/.test(referrer)) {
    return { status: 400, payload: { error: "bad_referrer" } };
  }
  if (trader !== undefined && !ADDRESS_RE.test(trader)) {
    return { status: 400, payload: { error: "bad_trader" } };
  }
  await mkdir(DATA_DIR, { recursive: true });
  const line = JSON.stringify({ tx_hash: tx, referrer, trader, at: Date.now() }) + "\n";
  await appendFile(ATTR_FILE, line, "utf8");
  return { status: 202, payload: { ok: true, queued: true, file: ATTR_FILE } };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (path === "/health") {
    json(res, 200, { ok: true, objects: await countObjects(), uptime: Math.round((Date.now() - STARTED) / 1000) });
    return;
  }

  if (path === "/v1/attribution") {
    if (req.method !== "POST") {
      json(res, 405, { error: "method_not_allowed" });
      return;
    }
    const raw = await readBody(req);
    if (raw.length > 2048) {
      json(res, 413, { error: "too_large" });
      return;
    }
    const { status, payload } = await queueAttribution(raw);
    json(res, status, payload);
    return;
  }

  const match = /^\/v1\/blob\/([^/]+)$/.exec(path);
  if (!match) {
    json(res, 404, { error: "not_found" });
    return;
  }

  const tag = match[1].toLowerCase();
  if (!TAG_RE.test(tag)) {
    json(res, 400, { error: "bad_tag" });
    return;
  }

  if (!authorized(req)) {
    json(res, 401, { error: "unauthorized" });
    return;
  }

  const file = join(DATA_DIR, `${tag}.json`);
  await mkdir(DATA_DIR, { recursive: true });

  try {
    if (req.method === "GET" || req.method === "HEAD") {
      const raw = await readFile(file, "utf8");
      json(res, 200, { record: JSON.parse(raw) });
      return;
    }

    if (req.method === "PUT") {
      const body = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        json(res, 400, { error: "bad_json" });
        return;
      }
      const record = parsed?.record ?? parsed;
      if (!validRecord(record)) {
        json(res, 400, { error: "bad_record" });
        return;
      }
      await writeFile(file, JSON.stringify(record), "utf8");
      json(res, 200, { ok: true, tag, updatedAt: record.updatedAt });
      return;
    }

    if (req.method === "DELETE") {
      if (!ADMIN || req.headers["x-admin-token"] !== ADMIN) {
        json(res, 403, { error: "admin_required" });
        return;
      }
      await unlink(file).catch(() => {});
      json(res, 200, { ok: true });
      return;
    }

    json(res, 405, { error: "method_not_allowed" });
  } catch (err) {
    if (err?.code === "ENOENT") {
      json(res, 404, { error: "not_found" });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    json(res, 500, { error: message === "payload_too_large" ? message : "server_error" });
  }
});

server.listen(PORT, () => {
  process.stdout.write(`aura-sync listening on :${PORT} · store ${DATA_DIR}\n`);
});
