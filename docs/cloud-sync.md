# Cloud sync

The paper ledger (balance, positions, fills), the referral journal and the debate wall used to live in
one browser's `localStorage`. Cloud sync turns them into an account-owned record that follows the
wallet — or the ERC-4337 smart account minted by a Google / email login — onto any device.

```
wallet (or Web3Auth smart account)
  │  personal_sign(challenge)          ← no gas, no broadcast, cannot move funds
  ▼
PBKDF2-SHA256(signature, salt = sync tag, 120 000 rounds)
  │
  ▼
AES-256-GCM  ──►  sealed blob { iv, ct }  ──►  transport  ──►  cloud
                                                  │
                          pull → merge → push (last-write-wins on money, union by id on history)
```

## Why the payload is sealed client-side

The transport only ever sees ciphertext. That has two consequences worth stating plainly:

- A public, zero-configuration channel (below) is safe to use: an observer learns that *a* wallet
  synced *something* at time *T*, not the balance, the questions or the debate text.
- The operator of the store cannot read or forge a ledger — the decryption key never leaves the
  browser and is derived from a signature only the wallet can produce.

The signature is cached in `sessionStorage` for the tab session so a refresh does not re-prompt.
Closing the tab drops it; the next session re-signs once.

## Transports

`frontend/src/lib/cloudSync.ts` picks the first configured transport:

| Order | Transport | Configure | Durability | Notes |
| --- | --- | --- | --- | --- |
| 1 | `endpoint` | `VITE_SYNC_ENDPOINT` | durable | `server/sync-server.mjs`, or any REST store with `GET/PUT /:tag` |
| 2 | `supabase` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | durable | PostgREST table, SQL below |
| 3 | `relay` | none (default) | **12 h** | `ntfy.sh` public relay, topic derived from the wallet |

The relay exists so the hosted build works with zero infrastructure: the topic name is predictable
(`aura-sync-v1-<tag>`), records are split into <3 kB chunks, and the newest *complete* chunk group wins
so a half-written push can never overwrite a good record. The header chip labels it as non-durable —
`Local only` / `Syncing` / `Synced` are reported from the real round-trip, never assumed.

For production, use transport 1 or 2. Both are exercised by the test suite.

## Self-hosted store

```bash
node server/sync-server.mjs               # :8787, data in ./.sync-store
VITE_SYNC_ENDPOINT=http://127.0.0.1:8787/v1/blob npm run build
```

Environment: `PORT`, `SYNC_DATA_DIR`, `SYNC_AUTH_TOKEN` (optional bearer), `SYNC_ADMIN_TOKEN`
(required for `DELETE`), `SYNC_MAX_BYTES` (default 256 KiB). The server validates the record shape and
rejects anything that is not `{ updatedAt, device, blob: { iv, ct } }` — it has no schema knowledge of
the ledger itself, by design.

Verify the crypto contract end to end:

```bash
node server/sync-server.mjs &
node server/sync-selftest.mjs              # 11 assertions: seal, round-trip, wrong-key, miss
```

## Supabase

```sql
create table if not exists public.aura_sync (
  tag         text primary key,
  updated_at  timestamptz not null default now(),
  device      text not null,
  blob        jsonb not null,
  created_at  timestamptz not null default now()
);

alter table public.aura_sync enable row level security;

-- The row is ciphertext, so the anon key may insert/update by tag. There is deliberately no
-- select-by-range policy: a client can only address the exact tag it can derive.
create policy "anon upsert by tag" on public.aura_sync
  for insert to anon with check (char_length(tag) = 24);

create policy "anon update by tag" on public.aura_sync
  for update to anon using (char_length(tag) = 24) with check (char_length(tag) = 24);

create policy "anon read by tag" on public.aura_sync
  for select to anon using (char_length(tag) = 24);
```

```bash
VITE_SUPABASE_URL=https://<project>.supabase.co \
VITE_SUPABASE_ANON_KEY=<anon-key> \
npm run build
```

Optional: `VITE_SUPABASE_TABLE` if the table is not named `aura_sync`.

## Merge rules

Money cannot be merged, history can:

- **Balance / claimed / positions** — last-write-wins on `updatedAt`.
- **Fills** — union by trade id, newest first, capped at 120. Two devices trading offline keep both
  ledgers.
- **Debate takes** — union by comment id per market, capped at 200; seeded official prompts are never
  dropped.
- **Referral journal** — the local invite code wins (it is the link this browser already handed out).
- **Locale** — mirrored to the cloud; a fresh device adopts it on first sync.

A device's **first** round is special: a browser that just claimed the 10,000 FAKE-USDC welcome bonus
must not shadow an account that already has a fill history, so that first pull is allowed to win
outright. Subsequent rounds use timestamps, which keeps an explicit local reset meaningful.

## Verification

```bash
# self-hosted transport, two isolated browser profiles
node server/sync-server.mjs &
npm run e2e:sync

# public relay transport (zero config, 12h retention)
SYNC_MODE=relay npm run e2e:sync -- http://127.0.0.1:4189/
```

Both suites assert that device B — a brand-new profile with empty `localStorage` — adopts device A's
balance and position from the cloud, and that the record on the wire contains no plaintext balance,
no question text and a valid AES-GCM `iv`/`ct` pair.

## Threat model

| Concern | Property |
| --- | --- |
| Store operator reads the ledger | Not possible — AES-GCM with a wallet-derived key |
| Store operator forges a fill | Not possible without the key; a tampered ciphertext fails the GCM tag |
| Replay of an old record | Bounded by `updatedAt` ordering; a stale record loses |
| XSS in the page | Can read the session signature, so it can derive the key — same trust boundary as the wallet itself |
| Wallet signature reuse | The challenge is fixed and scoped to sync; it cannot authorise a transaction |
| Losing the wallet | The record becomes undecryptable. That is the point; there is no recovery path |
