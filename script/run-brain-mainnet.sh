#!/usr/bin/env bash
# Hermes brain · long-running launcher for Base mainnet
#
#   bash script/run-brain-mainnet.sh              # daemon mode, 300s per round by default
#   bash script/run-brain-mainnet.sh --once       # run exactly one round
#   bash script/run-brain-mainnet.sh --dry-run --once   # decisions only, no transactions
#   INTERVAL=120 bash script/run-brain-mainnet.sh
#
# Private key resolution order:
#   1) an already exported BRAIN_PK
#   2) the desktop key document (read into memory only; never written to disk, echoed, or visible in ps)
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)

export RPC_URL="${RPC_URL:-https://mainnet.base.org}"
export ENGINE="${ENGINE:-0xE6056Bc6700F6d7E6fF8779B212655284dc1631C}"
export USDC="${USDC:-0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913}"
export SEED_USDC="${SEED_USDC:-100}"
export HORIZON_HOURS="${HORIZON_HOURS:-24}"
export ORACLE_CONFIRM_SAMPLES="${ORACLE_CONFIRM_SAMPLES:-3}"
export ORACLE_CONFIRM_GAP="${ORACLE_CONFIRM_GAP:-30}"
# every round writes the market commentary as static JSON the frontend can poll
export INSIGHTS_OUT="${INSIGHTS_OUT:-$ROOT/frontend/public/insights.json}"
INTERVAL="${INTERVAL:-300}"
# Operator key document: any file the regex below can read a 32-byte hex key out of.
# Point BRAIN_KEY_DOC at it; nothing key-shaped is ever committed to this repo.
KEY_DOC="${BRAIN_KEY_DOC:-$HOME/.aura/brain.key}"

if [[ -z "${BRAIN_PK:-}" ]]; then
  if [[ ! -f "$KEY_DOC" ]]; then
    echo "No private key found: export BRAIN_PK=... first (or point BRAIN_KEY_DOC at the document)" >&2
    exit 2
  fi
  # read into a variable; never echo / never tee
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

# Note: do [NOT] unset the proxy here — the price feeds (CoinGecko/Binance) need it to reach the network.
# hermes_brain.py strips the proxy itself when it shells out to cast (Chain._run), so on-chain RPC stays direct.
export no_proxy="${no_proxy:-127.0.0.1,localhost}"

echo "engine : $ENGINE"
echo "usdc   : $USDC"
echo "rpc    : $RPC_URL"
echo "interval: ${INTERVAL}s  seed: ${SEED_USDC} USDC  samples: ${ORACLE_CONFIRM_SAMPLES}×${ORACLE_CONFIRM_GAP}s"
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
