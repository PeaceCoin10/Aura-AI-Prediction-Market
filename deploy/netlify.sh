#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Aura · switch to a permanent Netlify domain with one command (pure REST API, no CLI install)
#
#   NETLIFY_TOKEN=xxx ./deploy/netlify.sh
#   NETLIFY_TOKEN=xxx SITE_NAME=aura-prediction-market ./deploy/netlify.sh
#
# What it does:
#   1) local vite build (only when dist is missing or --build is passed)
#   2) POST /api/v1/sites to create the site (falls back to a random subdomain if the name is taken)
#   3) zip frontend/dist → POST /sites/{id}/deploys (direct zip upload, done in seconds)
#   4) poll the deploy state → re-read the HTTP status of https://<site>.netlify.app
# ─────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

SITE_NAME="${SITE_NAME:-aura-prediction-market}"
TOKEN="${NETLIFY_TOKEN:-}"
API="${NETLIFY_API:-https://api.netlify.com/api/v1}"
BUILD=0

say() { printf '\033[36m▸\033[0m %s\n' "$*"; }
ok()  { printf '\033[32m✓\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

for a in "$@"; do
  case "$a" in
    --build) BUILD=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
  esac
done

if [ -n "${DRY_RUN:-}" ]; then
  say "[dry-run] npm --prefix frontend run build"
  say "[dry-run] POST $API/sites  {name: $SITE_NAME}"
  say "[dry-run] POST $API/sites/<id>/deploys  (Content-Type: application/zip, body=dist.zip)"
  say "[dry-run] poll $API/deploys/<id> → state=ready → re-read https://$SITE_NAME.netlify.app"
  exit 0
fi

[ -n "$TOKEN" ] || die "NETLIFY_TOKEN is missing. Create one at https://app.netlify.com/user/applications#personal-access-tokens"

if [ "$BUILD" = "1" ] || [ ! -f frontend/dist/index.html ]; then
  say "building frontend (frontend/dist)…"
  ( cd frontend && npm install --no-audit --no-fund >/dev/null && npm run build >/dev/null ) \
    || die "frontend build failed; run npm run build manually to see the error"
  ok "build complete"
fi

say "create / reuse site: $SITE_NAME"
SITE_JSON="$(curl -sS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -X POST "$API/sites" -d "{\"name\":\"$SITE_NAME\"}")"
SITE_ID="$(printf '%s' "$SITE_JSON" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("id",""))
except Exception: print("")')"

if [ -z "$SITE_ID" ]; then
  say "site name is probably taken; creating the site under a random subdomain"
  SITE_JSON="$(curl -sS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -X POST "$API/sites" -d '{}')"
  SITE_ID="$(printf '%s' "$SITE_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))')"
fi
[ -n "$SITE_ID" ] || { printf '%s\n' "$SITE_JSON"; die "site creation failed"; }
SITE_URL="$(printf '%s' "$SITE_JSON" | python3 -c 'import json,sys
d=json.load(sys.stdin); print(d.get("ssl_url") or d.get("url") or "")')"
ok "site ID: $SITE_ID"

ZIP="$(mktemp -u /tmp/aura_site_XXXX.zip)"
say "packaging frontend/dist → zip"
python3 - "$ROOT/frontend/dist" "$ZIP" <<'PY'
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for base, _dirs, files in os.walk(src):
        for f in files:
            p = os.path.join(base, f)
            z.write(p, os.path.relpath(p, src))
PY
ok "archive size $(du -h "$ZIP" | cut -f1)"

say "uploading deployment (direct zip)…"
DEPLOY_JSON="$(curl -sS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/zip' \
  --data-binary "@$ZIP" "$API/sites/$SITE_ID/deploys")"
rm -f "$ZIP"
DEPLOY_ID="$(printf '%s' "$DEPLOY_JSON" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("id",""))
except Exception: print("")')"
[ -n "$DEPLOY_ID" ] || { printf '%s\n' "$DEPLOY_JSON" | head -c 800; die "deployment upload failed"; }

say "waiting for the deployment to finish (up to 90s)…"
STATE=""
for _ in $(seq 1 30); do
  BODY="$(curl -sS -H "Authorization: Bearer $TOKEN" "$API/deploys/$DEPLOY_ID")"
  STATE="$(printf '%s' "$BODY" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("state",""))
except Exception: print("")')"
  case "$STATE" in
    ready) break ;;
    error) printf '%s\n' "$BODY" | head -c 800; die "Netlify deployment failed (state=error)" ;;
  esac
  sleep 3
done
[ "$STATE" = "ready" ] || die "deployment timed out (state=$STATE); check the dashboard at https://app.netlify.com/sites"

say "verifying $SITE_URL by read-back…"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$SITE_URL" || echo 000)"
[ "$CODE" = "200" ] || die "read-back returned HTTP $CODE"
ok "live and serving (HTTP 200)"

printf '%s\n' "$SITE_URL" > deploy/.netlify-url
echo
echo "  permanent URL  $SITE_URL"
echo "  dashboard      https://app.netlify.com/sites/$SITE_NAME"
echo "  redeploy       NETLIFY_TOKEN=xxx ./deploy/netlify.sh --build"
