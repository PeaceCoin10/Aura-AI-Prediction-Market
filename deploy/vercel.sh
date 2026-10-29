#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Aura · switch to a permanent Vercel domain with one command (replaces the flaky trycloudflare tunnel)
#
#   VERCEL_TOKEN=xxx ./deploy/vercel.sh
#   VERCEL_TOKEN=xxx PROJECT=aura-prediction-market ./deploy/vercel.sh
#
# What it does:
#   1) use the token against the Vercel API to create / reuse the project (idempotent)
#   2) vercel link → vercel deploy --prod (cloud-side npm install + vite build)
#   3) re-read the HTTP status of https://<project>.vercel.app to confirm it is really up
#
# Prerequisite: vercel.json is already in the repo (buildCommand / outputDirectory / SPA rewrite)
# ─────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

PROJECT="${PROJECT:-aura-prediction-market}"
TOKEN="${VERCEL_TOKEN:-}"
TEAM="${VERCEL_TEAM_ID:-}"

say() { printf '\033[36m▸\033[0m %s\n' "$*"; }
ok()  { printf '\033[32m✓\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

for a in "$@"; do
  case "$a" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
  esac
done

[ -n "$TOKEN" ] || [ -n "${DRY_RUN:-}" ] || die "VERCEL_TOKEN is missing. Create one at https://vercel.com/account/tokens, then run VERCEL_TOKEN=xxx ./deploy/vercel.sh"

if [ -n "${DRY_RUN:-}" ]; then
  say "[dry-run] POST https://api.vercel.com/v11/projects  (name=$PROJECT)"
  say "[dry-run] npx vercel link --yes --project $PROJECT --token \$VERCEL_TOKEN"
  say "[dry-run] npx vercel deploy --prod --yes --token \$VERCEL_TOKEN --cwd $ROOT"
  say "[dry-run] curl -I https://$PROJECT.vercel.app  (expect 200)"
  exit 0
fi

command -v npx >/dev/null || die "Node/npx is not installed (the Vercel CLI needs Node 18+)"

QS=""
[ -n "$TEAM" ] && QS="?teamId=$TEAM"

say "confirm / create the Vercel project: $PROJECT"
CODE="$(curl -sS -o /tmp/aura_vercel_proj.json -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v9/projects/$PROJECT$QS")"
if [ "$CODE" = "200" ]; then
  ok "project already exists"
elif [ "$CODE" = "404" ]; then
  curl -fsS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -X POST "https://api.vercel.com/v11/projects$QS" \
    -d "{\"name\":\"$PROJECT\",\"framework\":null}" >/dev/null \
    || die "project creation failed (token permissions / project name already taken)"
  ok "project created"
else
  say "project lookup returned HTTP $CODE (attempting a direct deploy anyway)"
fi

say "link + production deploy (the first cloud run does npm install + vite build, ~30–90s)"
npx --yes vercel@latest link --yes --project "$PROJECT" --token "$TOKEN" >/dev/null
DEPLOY_LOG="$(mktemp)"
npx --yes vercel@latest deploy --prod --yes --token "$TOKEN" --cwd "$ROOT" | tee "$DEPLOY_LOG"

URL="$(grep -oE 'https://[a-zA-Z0-9._-]+\.vercel\.app' "$DEPLOY_LOG" | tail -1 || true)"
[ -n "$URL" ] || URL="https://$PROJECT.vercel.app"

say "verifying $URL by read-back…"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$URL" || echo 000)"
[ "$CODE" = "200" ] || die "deployment returned HTTP $CODE; check the deploy log at $DEPLOY_LOG"
ok "live and serving (HTTP 200)"

printf '%s\n' "$URL" > deploy/.vercel-url
echo
echo "  permanent URL  $URL"
echo "  dashboard      https://vercel.com/dashboard"
echo "  redeploy       VERCEL_TOKEN=xxx ./deploy/vercel.sh"
