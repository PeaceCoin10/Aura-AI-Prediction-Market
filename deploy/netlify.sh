#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Aura · 一条命令换成永久 Netlify 域名（纯 REST API，不装任何 CLI）
#
#   NETLIFY_TOKEN=xxx ./deploy/netlify.sh
#   NETLIFY_TOKEN=xxx SITE_NAME=aura-prediction-market ./deploy/netlify.sh
#
# 做的事：
#   1) 本地 vite build（若 dist 缺失或 --build）
#   2) POST /api/v1/sites 建站（名字被占则自动落到随机子域）
#   3) 把 frontend/dist 打成 zip → POST /sites/{id}/deploys（zip 直传，秒级）
#   4) 轮询部署状态 → 回读 https://<site>.netlify.app 的 HTTP 状态
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
  say "[dry-run] 轮询 $API/deploys/<id> → state=ready → 回读 https://$SITE_NAME.netlify.app"
  exit 0
fi

[ -n "$TOKEN" ] || die "缺 NETLIFY_TOKEN。到 https://app.netlify.com/user/applications#personal-access-tokens 建一个"

if [ "$BUILD" = "1" ] || [ ! -f frontend/dist/index.html ]; then
  say "构建前端（frontend/dist）…"
  ( cd frontend && npm install --no-audit --no-fund >/dev/null && npm run build >/dev/null ) \
    || die "前端构建失败，先手动 npm run build 看报错"
  ok "构建完成"
fi

say "建站 / 复用：$SITE_NAME"
SITE_JSON="$(curl -sS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -X POST "$API/sites" -d "{\"name\":\"$SITE_NAME\"}")"
SITE_ID="$(printf '%s' "$SITE_JSON" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("id",""))
except Exception: print("")')"

if [ -z "$SITE_ID" ]; then
  say "站点名可能已被占用，改为随机子域建站"
  SITE_JSON="$(curl -sS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -X POST "$API/sites" -d '{}')"
  SITE_ID="$(printf '%s' "$SITE_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))')"
fi
[ -n "$SITE_ID" ] || { printf '%s\n' "$SITE_JSON"; die "建站失败"; }
SITE_URL="$(printf '%s' "$SITE_JSON" | python3 -c 'import json,sys
d=json.load(sys.stdin); print(d.get("ssl_url") or d.get("url") or "")')"
ok "站点 ID：$SITE_ID"

ZIP="$(mktemp -u /tmp/aura_site_XXXX.zip)"
say "打包 frontend/dist → zip"
python3 - "$ROOT/frontend/dist" "$ZIP" <<'PY'
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for base, _dirs, files in os.walk(src):
        for f in files:
            p = os.path.join(base, f)
            z.write(p, os.path.relpath(p, src))
PY
ok "包大小 $(du -h "$ZIP" | cut -f1)"

say "上传部署（zip 直传）…"
DEPLOY_JSON="$(curl -sS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/zip' \
  --data-binary "@$ZIP" "$API/sites/$SITE_ID/deploys")"
rm -f "$ZIP"
DEPLOY_ID="$(printf '%s' "$DEPLOY_JSON" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("id",""))
except Exception: print("")')"
[ -n "$DEPLOY_ID" ] || { printf '%s\n' "$DEPLOY_JSON" | head -c 800; die "上传部署失败"; }

say "等待部署完成（最多 90 秒）…"
STATE=""
for _ in $(seq 1 30); do
  BODY="$(curl -sS -H "Authorization: Bearer $TOKEN" "$API/deploys/$DEPLOY_ID")"
  STATE="$(printf '%s' "$BODY" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("state",""))
except Exception: print("")')"
  case "$STATE" in
    ready) break ;;
    error) printf '%s\n' "$BODY" | head -c 800; die "Netlify 部署失败（state=error）" ;;
  esac
  sleep 3
done
[ "$STATE" = "ready" ] || die "部署超时（state=$STATE），去面板看：https://app.netlify.com/sites"

say "回读验证 $SITE_URL …"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$SITE_URL" || echo 000)"
[ "$CODE" = "200" ] || die "回读返回 HTTP $CODE"
ok "线上已可用（HTTP 200）"

printf '%s\n' "$SITE_URL" > deploy/.netlify-url
echo
echo "  永久域名   $SITE_URL"
echo "  面板       https://app.netlify.com/sites/$SITE_NAME"
echo "  重新部署   NETLIFY_TOKEN=xxx ./deploy/netlify.sh --build"
