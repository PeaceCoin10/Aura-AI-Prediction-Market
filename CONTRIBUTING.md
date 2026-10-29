# Contributing to Aura

Thanks for kicking the tyres. This repo is deliberately boring to work in: small modules, one source of
truth per concept, and tests that actually run.

## Ground rules

1. **No mock maths.** Any quote, share count or payout must come from the same formula the contract uses
   (`previewBuyOffline` / `previewSellOffline`). If a UI surface needs a number, it reuses the SDK.
2. **One source of truth.** The brand mark lives in `frontend/src/components/BrandLogo.tsx` and is reused by
   the favicon, the banner and the share poster. Copy strings live in `frontend/src/locales/en/`.
3. **Honest labels.** Anything simulated must say so (paper trading, simulated ticks, local inference).
   Never present an estimate as an on-chain fact.
4. **Tests travel with the change.** Contract behaviour → `test/`. SDK behaviour → `sdk/*.test.ts`.
   User-visible flow → `frontend/scripts/e2e_ui.py`.

## Local loop

```bash
forge test                                   # contracts
cd sdk && npm test                           # SDK, fully offline
python3 -m unittest discover -s hermes -p 'test_*.py'
cd frontend && npx tsc --noEmit && npx vite build
python3 scripts/e2e_ui.py                    # against a vite preview server
```

## Pull requests

- One concern per PR; keep diffs readable.
- Run the full matrix above before opening.
- Describe **what breaks if this is wrong** — that is more useful than a changelog.
- Contract changes: include gas deltas and an invariant run in the description.
- Do not commit secrets. `.env*` is ignored; example files only.

## Adding a locale

`frontend/src/lib/i18n.tsx` registers locales at module scope. Create `frontend/src/locales/<code>/index.ts`
exporting an object that satisfies `Messages`, call `registerLocale(...)` once, and the header switcher
appears automatically. No component changes required.

## Reporting a vulnerability

See [`SECURITY.md`](SECURITY.md). Do not open a public issue for anything exploitable.
