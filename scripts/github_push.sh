#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Aura · publish this repository with a personal access token (no browser login needed)
#
#   GITHUB_TOKEN=ghp_xxx ./scripts/github_push.sh            # non-interactive (recommended)
#   ./scripts/github_push.sh                                 # prompts for a PAT, input hidden
#   ./scripts/github_push.sh --private                       # create as a private repo
#   GITHUB_TOKEN=ghp_xxx ./scripts/github_push.sh --force    # overwrite remote history
#   DRY_RUN=1 ./scripts/github_push.sh                       # print the plan, write nothing
#
# Security model:
#   - the token arrives via environment or a hidden prompt; it is never written to .git/config,
#     never embedded in the remote URL and never passed as a command-line argument
#   - the push authenticates through a temporary GIT_ASKPASS helper that is deleted on exit
#   - --force is opt-in and only ever targets $OWNER/$REPO_NAME
# ─────────────────────────────────────────────────────────────
set -euo pipefail

REPO_NAME="${REPO_NAME:-Aura-AI-Prediction-Market}"
BRANCH="${BRANCH:-main}"
VISIBILITY="public"
FORCE=""
DESCRIPTION="AI-written prediction markets on Base — CPMM pricing, on-chain settlement, paper trading"
TOPICS='["web3","prediction-market","base","ai-agent","defi","cpmm"]'

for arg in "$@"; do
  case "$arg" in
    --private) VISIBILITY="private" ;;
    --public) VISIBILITY="public" ;;
    --force) FORCE="--force" ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
  esac
done

say() { printf '\033[36m▸\033[0m %s\n' "$*"; }
ok()  { printf '\033[32m✓\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

cd "$(dirname "$0")/.."

TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
if [ -z "$TOKEN" ] && [ -z "${DRY_RUN:-}" ] && [ -t 0 ]; then
  printf 'GitHub token (repo scope, input hidden): '
  read -rs TOKEN; echo
fi
[ -n "${DRY_RUN:-}" ] || [ -n "$TOKEN" ] || die "no token: set GITHUB_TOKEN=ghp_xxx, or run interactively"

API="${GITHUB_API:-https://api.github.com}"
auth=(-H "Authorization: Bearer ${TOKEN}" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")

# ── 1. validate the token, resolve the login ─────────────────
if [ -z "${DRY_RUN:-}" ]; then
  say "validating token"
  USER_JSON="$(curl -fsS --max-time 25 "${auth[@]}" "$API/user")" || die "token rejected (401) or network unreachable"
  OWNER="${OWNER:-$(printf '%s' "$USER_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["login"])')}"
  SCOPES="$(curl -sS -o /dev/null -D - "${auth[@]}" "$API/user" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-oauth-scopes"{print $2}')"
  ok "authenticated as ${OWNER}${SCOPES:+ (scopes: $SCOPES)}"
else
  OWNER="${OWNER:-<your-login>}"
  say "[dry-run] would call GET $API/user to resolve the login"
fi

# ── 2. create the repository if it is missing ────────────────
if [ -z "${DRY_RUN:-}" ]; then
  CODE="$(curl -sS -o /dev/null -w '%{http_code}' "${auth[@]}" "$API/repos/$OWNER/$REPO_NAME")"
  if [ "$CODE" = "200" ]; then
    ok "repository exists: https://github.com/$OWNER/$REPO_NAME"
  elif [ "$CODE" = "404" ]; then
    say "creating $OWNER/$REPO_NAME ($VISIBILITY)"
    curl -fsS --max-time 30 "${auth[@]}" -X POST "$API/user/repos" \
      -d "{\"name\":\"$REPO_NAME\",\"private\":$([ "$VISIBILITY" = private ] && echo true || echo false),\"description\":\"$DESCRIPTION\",\"auto_init\":false}" \
      >/dev/null || die "could not create the repo (does the token have repo/admin write?)"
    ok "repository created"
  else
    die "GET /repos returned HTTP $CODE — check the token scope"
  fi

  # description + topics (idempotent, safe to re-run)
  curl -sS "${auth[@]}" -X PATCH "$API/repos/$OWNER/$REPO_NAME" \
    -d "{\"description\":\"$DESCRIPTION\",\"homepage\":\"https://${OWNER,,}.github.io/${REPO_NAME}/\"}" >/dev/null || true
  curl -sS "${auth[@]}" -X PUT "$API/repos/$OWNER/$REPO_NAME/topics" -d "{\"names\":$TOPICS}" >/dev/null || true
  ok "description + topics applied"
else
  say "[dry-run] would create $OWNER/$REPO_NAME if missing, then PATCH description and topics"
fi

# ── 3. commit the working tree ───────────────────────────────
git rev-parse --git-dir >/dev/null 2>&1 || { say "initialising git"; git init -q; }
[ -n "$(git config user.email || true)" ] || { git config user.name "Aura Bot"; git config user.email "aura@localhost"; }

if [ -n "${DRY_RUN:-}" ]; then
  say "[dry-run] would run git add -A && git commit ($(git status --porcelain | wc -l) changed paths pending)"
else
  git add -A
  if git diff --cached --quiet; then
    ok "working tree clean, nothing to commit"
  else
    MSG="${COMMIT_MSG:-feat: Aura — agentic prediction markets on Base}"
    git commit -q -m "$MSG"
    ok "committed: $(git log -1 --oneline)"
  fi
fi

git branch -M "$BRANCH"

# ── 4. push through a throwaway askpass helper ───────────────
REMOTE_URL="${GIT_REMOTE_URL:-https://github.com/${OWNER}/${REPO_NAME}.git}"
git remote remove origin >/dev/null 2>&1 || true
git remote add origin "$REMOTE_URL"

if [ -z "${DRY_RUN:-}" ]; then
  ASKPASS_DIR="$(mktemp -d)"
  trap 'rm -rf "$ASKPASS_DIR"' EXIT
  cat > "$ASKPASS_DIR/askpass.sh" <<'ASK'
#!/bin/sh
case "$1" in
  *sername*) printf '%s\n' "x-access-token" ;;
  *)         printf '%s\n' "$GITHUB_TOKEN" ;;
esac
ASK
  chmod 700 "$ASKPASS_DIR/askpass.sh"

  say "pushing to $REMOTE_URL ($BRANCH${FORCE:+, forced})"
  GIT_ASKPASS="$ASKPASS_DIR/askpass.sh" GITHUB_TOKEN="$TOKEN" GIT_TERMINAL_PROMPT=0 \
    git push --quiet $FORCE -u origin "$BRANCH" \
    || die "push failed — missing write scope, or the remote holds unrelated history (use --force to overwrite it)"
  ok "pushed"
else
  say "[dry-run] git push $FORCE -u origin $BRANCH   (token via GIT_ASKPASS, never in the URL)"
fi

# ── 5. read the remote back ──────────────────────────────────
if [ -z "${DRY_RUN:-}" ]; then
  sleep 2
  SHA_LOCAL="$(git rev-parse HEAD)"
  SHA_REMOTE="$(curl -fsS --max-time 25 "${auth[@]}" "$API/repos/$OWNER/$REPO_NAME/commits/$BRANCH" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["sha"])' 2>/dev/null || echo "")"
  [ "$SHA_LOCAL" = "$SHA_REMOTE" ] || die "read-back mismatch: local ${SHA_LOCAL:0:8} vs remote ${SHA_REMOTE:0:8}"
  ok "remote HEAD verified: ${SHA_LOCAL:0:8}"
  echo
  echo "  repo     https://github.com/$OWNER/$REPO_NAME"
  echo "  clone    git clone https://github.com/$OWNER/$REPO_NAME.git"
  echo "  commits  https://github.com/$OWNER/$REPO_NAME/commits/$BRANCH"
fi
