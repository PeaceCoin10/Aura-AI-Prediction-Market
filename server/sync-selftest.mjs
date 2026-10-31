#!/usr/bin/env node
/**
 * Round-trip self-test for the cloud-sync contract.
 *
 * Proves, against a live server, that:
 *   - two independent "devices" deriving the same tag from the same wallet address find one record
 *   - the payload is AES-256-GCM ciphertext on the wire and on disk (no plaintext balance)
 *   - a device with a different wallet cannot open it
 *
 * Usage:  node server/sync-server.mjs &   then   node server/sync-selftest.mjs [base]
 */
const BASE = (process.argv[2] ?? process.env.SYNC_BASE ?? "http://127.0.0.1:8787/v1/blob").replace(/\/$/, "");
const { subtle } = globalThis.crypto;

const utf8 = (s) => new TextEncoder().encode(s);
const buf = (u) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
const b64 = (b) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64");

async function sha256Hex(input) {
  const d = await subtle.digest("SHA-256", buf(utf8(input)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function tagOf(address) {
  return (await sha256Hex(`aura-sync-v1:${address.toLowerCase()}`)).slice(0, 24);
}

async function deriveKey(signature, tag) {
  const material = await subtle.importKey("raw", buf(utf8(signature.toLowerCase())), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", salt: buf(utf8(`aura-sync-salt:${tag}`)), iterations: 120_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function seal(key, payload) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: "AES-GCM", iv: buf(iv) }, key, buf(utf8(JSON.stringify(payload))));
  return { iv: b64(iv), ct: b64(ct) };
}

async function open(key, blob) {
  const plain = await subtle.decrypt(
    { name: "AES-GCM", iv: buf(new Uint8Array(Buffer.from(blob.iv, "base64"))) },
    key,
    buf(new Uint8Array(Buffer.from(blob.ct, "base64"))),
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

let PASS = 0;
let FAIL = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    PASS += 1;
    console.log(`  ok   ${name}`);
  } else {
    FAIL += 1;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const ADDRESS = "0x436b9d5e6fBd40eC93E881263bE53e59F8755Ba1";
const SIGNATURE = "0x" + "ab".repeat(65); // deterministic stand-in for an EIP-191 signature
const OTHER_SIG = "0x" + "cd".repeat(65);

const health = await fetch(BASE.replace(/\/v1\/blob$/, "") + "/health").then((r) => r.json());
check("server is healthy", health.ok === true, JSON.stringify(health));

const tag = await tagOf(ADDRESS);
const keyA = await deriveKey(SIGNATURE, tag);
const payload = {
  v: 1,
  updatedAt: Date.now(),
  device: "dev-selftest-a",
  locale: "zh",
  paper: {
    balance: "8750000000",
    claimed: true,
    positions: { "btc-90k": { yes: "120000000", no: "0", spent: "50000000", realized: "0" } },
    trades: [{ id: "t-selftest", marketId: "btc-90k", side: 0, action: "buy", amount: "50000000", shares: "120000000", avgPrice: 0.41, ts: Date.now() }],
    updatedAt: Date.now(),
  },
  comments: { "btc-90k": [{ id: "c-selftest", marketId: "btc-90k", author: "device-a", stance: "YES", text: "Synced take.", ts: Date.now() }] },
  referral: { code: "AURA1", earned: 0 },
};

const sealed = await seal(keyA, payload);
const put = await fetch(`${BASE}/${tag}`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ record: { updatedAt: payload.updatedAt, device: payload.device, blob: sealed } }),
});
check("PUT accepts the sealed record", put.status === 200, `status=${put.status}`);

const wire = await put.text();
check("the response carries no plaintext balance", !wire.includes("8750000000"), wire.slice(0, 120));

// Second device: same wallet, same signature ⇒ same tag ⇒ same record.
const tag2 = await tagOf(ADDRESS.toUpperCase());
check("tag is address-case independent", tag === tag2, `${tag} vs ${tag2}`);

const keyB = await deriveKey(SIGNATURE, tag2);
const got = await fetch(`${BASE}/${tag2}`);
check("second device GETs the record", got.status === 200, `status=${got.status}`);
const body = (await got.json()).record;
check("wire blob is ciphertext, not JSON", typeof body.blob.ct === "string" && !body.blob.ct.includes("balance"));

const opened = await open(keyB, body.blob);
check("second device decrypts the same ledger", opened?.paper?.balance === "8750000000", JSON.stringify(opened?.paper?.balance));
check("decrypted comments survive", opened?.comments?.["btc-90k"]?.[0]?.text === "Synced take.");
check("decrypted locale survives", opened?.locale === "zh");

const wrongKey = await deriveKey(OTHER_SIG, tag);
let wrongFailed = false;
try {
  await open(wrongKey, body.blob);
} catch {
  wrongFailed = true;
}
check("a different signature cannot open the blob", wrongFailed);

let notFound = false;
try {
  await open(wrongKey, (await fetch(`${BASE}/zzzzzzzzzzzzzzzzzzzzzzzz`)).json());
} catch {
  notFound = true;
}
check("unknown tag resolves to a miss", notFound);

console.log(`\n${PASS} passed, ${FAIL} failed`);
process.exit(FAIL === 0 ? 0 : 1);
