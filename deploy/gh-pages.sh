#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Aura · publish the dApp to GitHub Pages (permanent HTTPS URL, no extra account)
#
#   GITHUB_TOKEN=ghp_xxx ./deploy/gh-pages.sh
#   OWNER=peacecoin10 REPO=Aura-AI-Prediction-Market ./deploy/gh-pages.sh
#
# What it does:
#   1. vite build with base=/<repo>/  (Pages serves project sites from a subpath)
#   2. temp git repo → force-push the build to the `gh-pages` branch
#   3. enable/refresh Pages via REST, poll until the build is live
#   4. verify the page AND a hashed asset return 200
# ─────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

REPO="${REPO:-Aura-AI-Prediction-Market}"
if [ -z "${OWNER:-}" ]; then
  OWNER="$(git remote get-url origin 2>/dev/null | sed -E 's#.*github\.com[:/]([^/]+)/([^/.]+).*#\1#' || true)"
fi
OWNER="${OWNER:-peacecoin10}"
BRANCH="gh-pages"
TOKEN="${GITHUB_TOKEN:-}"
[ -z "$TOKEN" ] && [ -f "$HOME/.github_token" ] && TOKEN="$(tr -d '\r\n' < "$HOME/.github_token")"

say() { printf '\033[36m▸\033[0m %s\n' "$*"; }
ok()  { printf '\033[32m✓\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

for a in "$@"; do
  case "$a" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
  esac
done

BASE_PATH="/${REPO}/"
PAGES_URL="https://${OWNER,,}.github.io/${REPO}/"

if [ -n "${DRY_RUN:-}" ]; then
  say "[dry-run] npx vite build --base=${BASE_PATH} (cwd frontend)"
  say "[dry-run] force-push frontend/dist → branch ${BRANCH}"
  say "[dry-run] POST /repos/${OWNER}/${REPO}/pages  {source:{branch:${BRANCH},path:'/'}}"
  say "[dry-run] expect 200 at ${PAGES_URL}"
  exit 0
fi

[ -n "$TOKEN" ] || die "need GITHUB_TOKEN (or ~/.github_token)"

say "building with base ${BASE_PATH}"
( cd frontend && npx vite build --base="${BASE_PATH}" >/tmp/aura_pages_build.log 2>&1 ) \
  || { tail -20 /tmp/aura_pages_build.log; die "vite build failed"; }
ok "build ok ($(du -sh frontend/dist | cut -f1))"

say "publishing to ${BRANCH}"
PUB="$(mktemp -d)"
trap 'rm -rf "$PUB"' EXIT
cp -a frontend/dist/. "$PUB/"
cp "$PUB/index.html" "$PUB/404.html"      # SPA fallback for deep links
: > "$PUB/.nojekyll"                       # do not run Jekyll over hashed assets
(
  cd "$PUB"
  git init -q
  git checkout -q -b "$BRANCH"
  git -c user.name="Aura Bot" -c user.email="aura@localhost" add -A
  git -c user.name="Aura Bot" -c user.email="aura@localhost" commit -q -m "deploy: gh-pages $(date -u +%Y-%m-%dT%H:%MZ)"
  ASK="$(mktemp -d)/askpass.sh"
  cat > "$ASK" <<'ASKPASS'
#!/bin/sh
case "$1" in
  *sername*) printf '%s\n' "x-access-token" ;;
  *)         printf '%s\n' "$GITHUB_TOKEN" ;;
esac
ASKPASS
  chmod 700 "$ASK"
  GIT_ASKPASS="$ASK" GITHUB_TOKEN="$TOKEN" GIT_TERMINAL_PROMPT=0 \
    git push -q --force "https://github.com/${OWNER}/${REPO}.git" "$BRANCH"
  rm -rf "$(dirname "$ASK")"
)
ok "pushed ${BRANCH}"

say "enabling GitHub Pages"
API="https://api.github.com/repos/${OWNER}/${REPO}/pages"
AUTH=(-H "Authorization: Bearer ${TOKEN}" -H "Accept: application/vnd.github+json")
CODE="$(curl -sS -o /tmp/aura_pages.json -w '%{http_code}' "${AUTH[@]}" "$API")"
if [ "$CODE" = "404" ]; then
  curl -fsS "${AUTH[@]}" -X POST "$API" \
    -d "{\"source\":{\"branch\":\"${BRANCH}\",\"path\":\"/\"}}" >/dev/null || die "could not create Pages site"
  ok "Pages site created"
else
  curl -fsS "${AUTH[@]}" -X PUT "$API" \
    -d "{\"source\":{\"branch\":\"${BRANCH}\",\"path\":\"/\"}}" >/dev/null || say "Pages update returned non-2xx (may already be correct)"
  ok "Pages site already existed — source refreshed"
fi

say "waiting for the Pages build (up to 5 min)"
STATUS=""
for _ in $(seq 1 60); do
  BODY="$(curl -sS "${AUTH[@]}" "$API")"
  STATUS="$(printf '%s' "$BODY" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("status","") or "")
except Exception: print("")')"
  [ "$STATUS" = "built" ] && break
  sleep 5
done
ok "Pages status: ${STATUS:-unknown}"

say "verifying ${PAGES_URL}"
CODE="$(curl -sS -o /tmp/aura_pages_index.html -w '%{http_code}' -L --max-time 30 "$PAGES_URL" || echo 000)"
[ "$CODE" = "200" ] || die "index returned HTTP ${CODE} (DNS/propagation can take a minute — retry)"
ASSET="$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' /tmp/aura_pages_index.html | head -1 || true)"
if [ -n "$ASSET" ]; then
  ACODE="$(curl -sS -o /dev/null -w '%{http_code}' -L --max-time 30 "${PAGES_URL}${ASSET}" || echo 000)"
  [ "$ACODE" = "200" ] || die "asset ${ASSET} returned HTTP ${ACODE} — base path mismatch?"
  ok "asset ${ASSET} → 200"
fi

printf '%s\n' "$PAGES_URL" > deploy/.pages-url
echo
echo "  Permanent URL   ${PAGES_URL}"
echo "  Pages settings  https://github.com/${OWNER}/${REPO}/settings/pages"
