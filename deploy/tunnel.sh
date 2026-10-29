#!/usr/bin/env bash
# 公网隧道守护：静态服务 + 隧道 + 断线自动重连 + 当前地址落盘
#
#   优先 Cloudflare 快速隧道（cloudflared，无需账号；进程活着地址就稳定，无拦截页）
#   失败则回落 localhost.run（SSH 反向隧道，免费档地址会随重连变化）
#
#   bash deploy/tunnel.sh          # 前台跑（后台请用 nohup/systemd）
#   bash deploy/tunnel.sh --stop   # 停掉静态服务与所有隧道进程
#
# 当前公网地址永远写在 /root/prediction-market/PUBLIC-URL.txt
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/frontend/dist"
PORT="${PORT:-4173}"
URL_FILE="$ROOT/PUBLIC-URL.txt"
CF_LOG="$ROOT/deploy/cf_tunnel.log"
SSH_LOG="$ROOT/deploy/tunnel.log"

if [[ "${1:-}" == "--stop" ]]; then
  pkill -f "http.server $PORT" 2>/dev/null
  pkill -f "cloudflared tunnel" 2>/dev/null
  pkill -f "@localhost.run" 2>/dev/null
  echo "stopped"
  exit 0
fi

[[ -d "$DIST" ]] || { echo "dist 不存在，先 npm run build"; exit 1; }

# 静态服务（幂等）
if ! ss -lnt 2>/dev/null | grep -q ":$PORT "; then
  ( cd "$DIST" && setsid python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 & )
  sleep 1
fi

publish_url() {
  local url="$1"
  [[ -n "$url" ]] || return 0
  if [[ "$(cat "$URL_FILE" 2>/dev/null)" != "$url" ]]; then
    echo "$url" > "$URL_FILE"
    echo "[tunnel] 当前公网地址: $url"
  fi
}

run_cloudflared() {
  local tries=0
  while (( tries < 6 )); do
    tries=$((tries + 1))
    : > "$CF_LOG"
    echo "[tunnel] cloudflared 第 $tries 次启动 $(date -Is)" >> "$CF_LOG"
    env -u http_proxy -u https_proxy -u all_proxy \
      cloudflared tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate \
      --logfile "$CF_LOG" --loglevel info &
    local cf_pid=$!

    local url="" i=0
    while (( i < 40 )); do
      url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$CF_LOG" 2>/dev/null | tail -1)
      [[ -n "$url" ]] && break
      sleep 1
      i=$((i + 1))
    done

    if [[ -z "$url" ]]; then
      echo "[tunnel] cloudflared 40 秒内没拿到地址，杀掉重试" >> "$CF_LOG"
      kill "$cf_pid" 2>/dev/null
      wait "$cf_pid" 2>/dev/null
      sleep 3
      continue
    fi

    publish_url "$url"
    wait "$cf_pid"
    echo "[tunnel] cloudflared 退出 $(date -Is)，3 秒后重连" >> "$CF_LOG"
    sleep 3
  done
  return 1
}

run_localhost_run() {
  while true; do
    echo "[tunnel] localhost.run $(date -Is)" >> "$SSH_LOG"
    ssh -T -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
        -o ExitOnForwardFailure=yes \
        -o ServerAliveInterval=30 -o ServerAliveCountMax=10 \
        -o TCPKeepAlive=yes -o ConnectTimeout=15 \
        -R 80:localhost:"$PORT" nokey@localhost.run 2>&1 | while IFS= read -r line; do
          echo "$line" >> "$SSH_LOG"
          if [[ "$line" =~ (https://[a-z0-9]+\.lhr\.life) ]]; then
            publish_url "${BASH_REMATCH[1]}"
          fi
        done
    echo "[tunnel] localhost.run 断开 $(date -Is)，3 秒后重连" >> "$SSH_LOG"
    sleep 3
  done
}

if command -v cloudflared >/dev/null 2>&1; then
  echo "[tunnel] 使用 cloudflared 快速隧道（优先）"
  run_cloudflared || { echo "[tunnel] cloudflared 多次失败，回落 localhost.run"; run_localhost_run; }
else
  echo "[tunnel] 没装 cloudflared，直接用 localhost.run"
  run_localhost_run
fi
