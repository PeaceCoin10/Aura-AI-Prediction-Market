#!/usr/bin/env bash
# Public tunnel supervisor: static server + tunnel + auto-reconnect + persist current URL
#
#   Prefers the Cloudflare quick tunnel (cloudflared, no account needed; the URL stays stable
#   while the process lives, and there is no interstitial page)
#   Falls back to localhost.run (SSH reverse tunnel; the free-tier URL changes on reconnect)
#
#   bash deploy/tunnel.sh          # run in the foreground (use nohup/systemd to detach)
#   bash deploy/tunnel.sh --stop   # stop the static server and every tunnel process
#
# The current public URL is always written to /root/prediction-market/PUBLIC-URL.txt
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

[[ -d "$DIST" ]] || { echo "dist does not exist; run npm run build first"; exit 1; }

# static server (idempotent)
if ! ss -lnt 2>/dev/null | grep -q ":$PORT "; then
  ( cd "$DIST" && setsid python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 & )
  sleep 1
fi

publish_url() {
  local url="$1"
  [[ -n "$url" ]] || return 0
  if [[ "$(cat "$URL_FILE" 2>/dev/null)" != "$url" ]]; then
    echo "$url" > "$URL_FILE"
    echo "[tunnel] current public URL: $url"
  fi
}

run_cloudflared() {
  local tries=0
  while (( tries < 6 )); do
    tries=$((tries + 1))
    : > "$CF_LOG"
    echo "[tunnel] cloudflared start attempt $tries $(date -Is)" >> "$CF_LOG"
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
      echo "[tunnel] cloudflared produced no URL within 40s; killing it and retrying" >> "$CF_LOG"
      kill "$cf_pid" 2>/dev/null
      wait "$cf_pid" 2>/dev/null
      sleep 3
      continue
    fi

    publish_url "$url"
    wait "$cf_pid"
    echo "[tunnel] cloudflared exited $(date -Is); reconnecting in 3s" >> "$CF_LOG"
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
    echo "[tunnel] localhost.run disconnected $(date -Is); reconnecting in 3s" >> "$SSH_LOG"
    sleep 3
  done
}

if command -v cloudflared >/dev/null 2>&1; then
  echo "[tunnel] using the cloudflared quick tunnel (preferred)"
  run_cloudflared || { echo "[tunnel] cloudflared failed repeatedly; falling back to localhost.run"; run_localhost_run; }
else
  echo "[tunnel] cloudflared is not installed; using localhost.run directly"
  run_localhost_run
fi
