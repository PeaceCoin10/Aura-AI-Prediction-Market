#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Aura · 一条命令换成永久 Vercel 域名（替代会掉线的 trycloudflare 临时隧道）
#
#   VERCEL_TOKEN=xxx ./deploy/vercel.sh
#   VERCEL_TOKEN=xxx PROJECT=aura-prediction-market ./deploy/vercel.sh
#
# 做的事：
#   1) 用 token 调 Vercel API 建/复用项目（幂等）
#   2) vercel link → vercel deploy --prod（云端 npm install + vite build）
#   3) 回读 https://<project>.vercel.app 的 HTTP 状态，确认真的活着
#
# 前置：仓库里已有 vercel.json（buildCommand / outputDirectory / SPA rewrite）
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

[ -n "$TOKEN" ] || [ -n "${DRY_RUN:-}" ] || die "缺 VERCEL_TOKEN。到 https://vercel.com/account/tokens 建一个，然后 VERCEL_TOKEN=xxx ./deploy/vercel.sh"

if [ -n "${DRY_RUN:-}" ]; then
  say "[dry-run] POST https://api.vercel.com/v11/projects  (name=$PROJECT)"
  say "[dry-run] npx vercel link --yes --project $PROJECT --token \$VERCEL_TOKEN"
  say "[dry-run] npx vercel deploy --prod --yes --token \$VERCEL_TOKEN --cwd $ROOT"
  say "[dry-run] curl -I https://$PROJECT.vercel.app  (期望 200)"
  exit 0
fi

command -v npx >/dev/null || die "没装 Node/npx（Vercel CLI 需要 Node 18+）"

QS=""
[ -n "$TEAM" ] && QS="?teamId=$TEAM"

say "确认/创建 Vercel 项目：$PROJECT"
CODE="$(curl -sS -o /tmp/aura_vercel_proj.json -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v9/projects/$PROJECT$QS")"
if [ "$CODE" = "200" ]; then
  ok "项目已存在"
elif [ "$CODE" = "404" ]; then
  curl -fsS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -X POST "https://api.vercel.com/v11/projects$QS" \
    -d "{\"name\":\"$PROJECT\",\"framework\":null}" >/dev/null \
    || die "创建项目失败（token 权限 / 项目名被占用）"
  ok "项目已创建"
else
  say "项目查询返回 HTTP $CODE（继续尝试直接部署）"
fi

say "link + 生产部署（云端第一次会 npm install + vite build，约 30–90 秒）"
npx --yes vercel@latest link --yes --project "$PROJECT" --token "$TOKEN" >/dev/null
DEPLOY_LOG="$(mktemp)"
npx --yes vercel@latest deploy --prod --yes --token "$TOKEN" --cwd "$ROOT" | tee "$DEPLOY_LOG"

URL="$(grep -oE 'https://[a-zA-Z0-9._-]+\.vercel\.app' "$DEPLOY_LOG" | tail -1 || true)"
[ -n "$URL" ] || URL="https://$PROJECT.vercel.app"

say "回读验证 $URL …"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$URL" || echo 000)"
[ "$CODE" = "200" ] || die "部署返回 HTTP $CODE，去看部署日志：$DEPLOY_LOG"
ok "线上已可用（HTTP 200）"

printf '%s\n' "$URL" > deploy/.vercel-url
echo
echo "  永久域名   $URL"
echo "  面板       https://vercel.com/dashboard"
echo "  重新部署   VERCEL_TOKEN=xxx ./deploy/vercel.sh"
