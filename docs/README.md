# Documentation

Everything an operator, integrator or auditor needs. English is the single source of truth; the former
Chinese engineering notes are archived outside this repository and are no longer part of this tree.

| Document | What it answers |
| --- | --- |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Run the stack locally: anvil, deploy script, env vars, the five test suites, screenshots |
| [ASSETS.md](ASSETS.md) | The full asset inventory: contracts, verified addresses, code size, live URLs, test matrix |
| [GITHUB-PUSH.md](GITHUB-PUSH.md) | Publish this repo with a PAT — no browser session, no password, no token in `.git/config` |
| [DEPLOY-PERMANENT.md](DEPLOY-PERMANENT.md) | Permanent hosting: GitHub Pages (default), Vercel, Netlify — one command each |
| [CENTRAL-ENGINE.md](CENTRAL-ENGINE.md) | Contract reference: constants, roles, trading, settlement, events, invariants |
| [CENTRAL-SDK-GUIDE.md](CENTRAL-SDK-GUIDE.md) | TypeScript SDK: transport, reads, write preflights, error codes, event decoding |
| [MAINNET-DEPLOYED.md](MAINNET-DEPLOYED.md) | Live Base mainnet addresses and parameters, read back from chain |
| [SECURITY.md](SECURITY.md) | Threat model, admin powers, dispute mechanics, Slither and invariant results |
| [cloud-sync.md](cloud-sync.md) | Wallet-bound encrypted state: seal → transport → merge, Supabase schema, threat model |
| [security/slither-report.json](security/slither-report.json) | Raw static-analysis output |

Repo-level policies: [`../SECURITY.md`](../SECURITY.md) (disclosure), [`../CONTRIBUTING.md`](../CONTRIBUTING.md).

## Hosting at a glance

| Target | Command | URL shape | Notes |
| --- | --- | --- | --- |
| GitHub Pages | `GITHUB_TOKEN=… ./deploy/gh-pages.sh` | `https://<owner>.github.io/<repo>/` | Needs nothing but the repo PAT; builds with `base=/<repo>/` |
| Vercel | `VERCEL_TOKEN=… ./deploy/vercel.sh` | `https://<project>.vercel.app` | Creates the project over REST, then `deploy --prod` |
| Netlify | `NETLIFY_TOKEN=… ./deploy/netlify.sh --build` | `https://<site>.netlify.app` | Pure REST + zip upload, no CLI installed |

All three serve the same `frontend/dist` build. The agent (`hermes/`) is a long-running process and is
deliberately **not** part of the static deployment.

## Localisation

Five locales ship today — English (reference), Simplified Chinese, Japanese, Korean and German:

```
frontend/src/lib/i18n.tsx          typed message tree, registerLocale, {{var}} interpolation
frontend/src/locales/en/           one file per surface: shell, hall, trade, paper, social, terminal…
frontend/src/locales/{zh,ja,ko,de}/index.ts   full trees, `satisfies Messages`
```

A locale is a plain object that must satisfy `Messages` (a deeply widened copy of the English tree), so
a missing key is a `tsc` error rather than a runtime `undefined`. The header switcher is a frosted
dropdown; switching is in-place (no reload), writes `<html lang>`, persists to `localStorage` and is
mirrored to the cloud. Initial resolution order: `?lang=` → saved → `navigator.languages` → English.

Add `frontend/src/locales/<code>/index.ts` and one `registerLocale({ code, label, native, htmlLang,
messages })` call — nothing else changes.
