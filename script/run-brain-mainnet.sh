#!/usr/bin/env bash
# Hermes 大脑 · Base 主网常驻启动脚本
#
#   bash script/run-brain-mainnet.sh              # 常驻，默认 300 秒一轮
#   bash script/run-brain-mainnet.sh --once       # 只跑一轮
#   bash script/run-brain-mainnet.sh --dry-run --once   # 只看决策，不发交易
#   INTERVAL=120 bash script/run-brain-mainnet.sh
#
# 私钥来源优先级：
#   1) 已 export 的 BRAIN_PK
#   2) 桌面密钥文档（只读进内存，不落盘、不回显、不出现在 ps 里）
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)

export RPC_URL="${RPC_URL:-https://mainnet.base.org}"
export ENGINE="${ENGINE:-0xE6056Bc6700F6d7E6fF8779B212655284dc1631C}"
export USDC="${USDC:-0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913}"
export SEED_USDC="${SEED_USDC:-100}"
export HORIZON_HOURS="${HORIZON_HOURS:-24}"
export ORACLE_CONFIRM_SAMPLES="${ORACLE_CONFIRM_SAMPLES:-3}"
export ORACLE_CONFIRM_GAP="${ORACLE_CONFIRM_GAP:-30}"
# 每轮把盘口评述写成前端可轮询的静态 JSON
export INSIGHTS_OUT="${INSIGHTS_OUT:-$ROOT/frontend/public/insights.json}"
INTERVAL="${INTERVAL:-300}"
KEY_DOC="${BRAIN_KEY_DOC:-/mnt/c/Users/Administrator/Desktop/地址+私钥.txt}"

if [[ -z "${BRAIN_PK:-}" ]]; then
  if [[ ! -f "$KEY_DOC" ]]; then
    echo "找不到私钥：请先 export BRAIN_PK=...（或用 BRAIN_KEY_DOC 指定文档路径）" >&2
    exit 2
  fi
  # 读进变量，绝不 echo / 绝不 tee
  BRAIN_PK=$(python3 - "$KEY_DOC" <<'PY'
import re, sys, pathlib
text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8", errors="ignore")
m = re.search(r"\b(0x)?([0-9a-fA-F]{64})\b", text)
if not m:
    sys.exit(1)
sys.stdout.write("0x" + m.group(2))
PY
)
  export BRAIN_PK
fi

# 注意：这里【不要】unset 代理 —— 行情源（CoinGecko/Binance）要靠代理出网。
# hermes_brain.py 内部调 cast 时会自己剥掉代理（Chain._run），链上 RPC 依旧直连。
export no_proxy="${no_proxy:-127.0.0.1,localhost}"

echo "engine : $ENGINE"
echo "usdc   : $USDC"
echo "rpc    : $RPC_URL"
echo "interval: ${INTERVAL}s  seed: ${SEED_USDC} USDC  采样: ${ORACLE_CONFIRM_SAMPLES}×${ORACLE_CONFIRM_GAP}s"
echo

exec python3 "$ROOT/hermes/hermes_brain.py" \
  --rpc-url "$RPC_URL" \
  --engine "$ENGINE" \
  --interval "$INTERVAL" \
  --seed-usdc "$SEED_USDC" \
  --horizon-hours "$HORIZON_HOURS" \
  --confirm-samples "$ORACLE_CONFIRM_SAMPLES" \
  --confirm-gap "$ORACLE_CONFIRM_GAP" \
  "$@"
