# Permanent hosting

Three paths, all one command, all serving the same `frontend/dist` build. GitHub Pages needs nothing
beyond the repo token you already have; Vercel and Netlify need a platform token.

| Path | Needs | Command | Result |
| --- | --- | --- | --- |
| **GitHub Pages** | PAT (`repo` + Pages write) | `GITHUB_TOKEN=… ./deploy/gh-pages.sh` | `https://<owner>.github.io/<repo>/` |
| **Vercel** | `VERCEL_TOKEN` | `VERCEL_TOKEN=… ./deploy/vercel.sh` | `https://<project>.vercel.app` |
| **Netlify** | `NETLIFY_TOKEN` | `NETLIFY_TOKEN=… ./deploy/netlify.sh --build` | `https://<site>.netlify.app` |

All three are permanent (no tunnel process, no expiring hostname). A `trycloudflare.com` quick tunnel is
still available via `./deploy/tunnel.sh` for a throwaway preview — it dies with the process.

---

## GitHub Pages (default)

```bash
GITHUB_TOKEN=ghp_xxx ./deploy/gh-pages.sh
# optional: OWNER=peacecoin10 REPO=Aura-AI-Prediction-Market
```

What it does:

1. `vite build --base=/<repo>/` — project Pages sites are served from a subpath, so the asset base must
   match. `index.html` uses `%BASE_URL%` for the icon links and `import.meta.env.BASE_URL` for
   `insights.json`, so nothing hardcodes `/`.
2. Publishes the build to an orphan `gh-pages` branch (temp repo → `git push --force`), adding
   `404.html` (SPA fallback for deep links) and `.nojekyll` (so Jekyll does not touch hashed assets).
3. Creates or refreshes the Pages site over REST:
   `POST /repos/{owner}/{repo}/pages {source:{branch:"gh-pages", path:"/"}}`.
4. Polls `GET .../pages` until `status == "built"` (≤5 min), then verifies the page **and** the hashed
   bundle return HTTP 200. A base-path mistake fails here, not in front of a user.
5. Writes the URL to `deploy/.pages-url` (git-ignored).

Token scope: classic `repo` (+ `workflow` if you keep CI); fine-grained needs **Contents: read/write**
and **Pages: read/write** on the repository.

### Custom domain

```bash
printf 'aura.example.com\n' > frontend/public/CNAME      # committed, baked into every build
# then: repo → Settings → Pages → Custom domain, and point a CNAME record at <owner>.github.io
```

HTTPS is provisioned automatically; the certificate appears a few minutes after DNS resolves.

---

## Vercel

```bash
VERCEL_TOKEN=xxx ./deploy/vercel.sh
VERCEL_TOKEN=xxx ./deploy/vercel.sh --build     # build locally, upload the prebuilt output
```

`deploy/vercel.sh` creates the project over REST (or reuses it), links the directory, runs
`vercel deploy --prod`, then re-reads the deployment to print the final `https://…` URL and its HTTP
status. `vercel.json` pins the build (`cd frontend && npm run build`, output `frontend/dist`), the SPA
rewrite and the cache headers (`/assets/*` immutable, `/insights.json` no-store).

Create a token at <https://vercel.com/account/tokens>. Free tier is enough for a static site.

---

## Netlify

```bash
NETLIFY_TOKEN=xxx ./deploy/netlify.sh --build
NETLIFY_TOKEN=xxx ./deploy/netlify.sh                 # publish an existing frontend/dist
```

Pure REST — no Netlify CLI installed: create the site (`POST /api/v1/sites`), zip `frontend/dist`,
upload it (`POST /api/v1/sites/{id}/deploys` with `Content-Type: application/zip`), poll the deploy
until `state == "ready"`, then verify HTTP 200. `netlify.toml` carries the same build command, SPA
redirect and cache headers.

The whole flow is covered offline by `python3 deploy/test_netlify_mock.py`, which runs against a local
mock of the Netlify API (`site_created=1, zip_entries=6, polls=2, index=True, RESULT: ALL PASS`).

---

## Which one should I use?

| | GitHub Pages | Vercel | Netlify |
| --- | --- | --- | --- |
| Extra account | no | yes | yes |
| Custom domain | yes (CNAME) | yes | yes |
| Preview per PR | no | yes | yes |
| Build on push | workflow you write | yes, built in | yes, built in |
| Cold start | none | none | none |
| Good for | fastest "it is live forever" | CI-native hosting | REST-only environments |

Pages is the default because it needs exactly one secret, which you already have. If you later want
per-PR previews, add Vercel and keep both: they are independent.

---

## Verifying a deployment

```bash
URL=https://peacecoin10.github.io/Aura-AI-Prediction-Market/
curl -s -o /dev/null -w 'index %{http_code}\n' "$URL"
ASSET=$(curl -s "$URL" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)
curl -s -o /dev/null -w "asset %{http_code}\n" "$URL$ASSET"
```

Then the real check — the UI suite, pointed at the live URL:

```bash
cd frontend && python3 scripts/e2e_ui.py "$URL"
```

It exercises the first-run funnel, the featured hall, live ticks, a paper fill, the debate wall, the
security/docs overlays, the Real/Paper switch, brand assets and the 390px mobile layout.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Blank page, 404s on `/assets/...` | built without `--base=/<repo>/` | use `deploy/gh-pages.sh`, which sets it |
| `404` on a deep link like `/portfolio` | no SPA fallback | Pages needs `404.html`; script writes it |
| Icons missing but JS loads | absolute `/favicon.svg` under a subpath | use `%BASE_URL%` (already done) |
| Pages says `errored` | branch pushed while Pages was building | re-run the script; it re-points the source and re-polls |
| Vercel build fails on `@sdk` | root directory set to `frontend` | keep the repo root as root dir (`vercel.json` handles it) |
| Netlify deploy stuck `uploaded` | zip too large / wrong content type | must be `application/zip`, ≤ 25 MB per file |
