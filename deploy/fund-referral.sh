#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Aura · fund the ReferralLedger rebate pool on Base mainnet.
#
#   bash deploy/fund-referral.sh            # 50 USDC (default)
#   AMOUNT=10 bash deploy/fund-referral.sh  # explicit amount, base units
#
# Reads the treasury key from ~/.aura/deployer.key (override KEY_FILE), checks the USDC balance
# first, approves exactly the amount, funds, then reads the pool back. Nothing is printed from
# the key; the only output is addresses, amounts and the resulting pool balance.
# ─────────────────────────────────────────────────────────────
set -euo pipefail
export PATH=/opt/foundry:$PATH
cd "$(dirname "$0")/.."

LEDGER=0x2EbF3B69870979F863B8900f03CE8AcfE58E8954
USDC=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
RPC="${BASE_RPC_URL:-https://mainnet.base.org}"
AMOUNT="${AMOUNT:-50000000}"   # 50 USDC (6 dp)
KEY_FILE="${KEY_FILE:-$HOME/.aura/deployer.key}"

say() { printf '\033[36m▸\033[0m %s\n' "$*"; }
ok()  { printf '\033[32m✓\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ -f "$KEY_FILE" ] || die "no key at $KEY_FILE"
PK="$(tr -d '\r\n ' < "$KEY_FILE")"
C="env -u http_proxy -u https_proxy -u all_proxy"

FROM="$($C cast wallet address --private-key "$PK")"
BAL="$($C cast call "$USDC" 'balanceOf(address)(uint256)' "$FROM" --rpc-url "$RPC" | awk '{print $1}')"
say "from      $FROM"
say "usdc bal  $BAL (need $AMOUNT)"
python3 - "$BAL" "$AMOUNT" <<'PY' || die "not enough USDC — send USDC on Base to the treasury first"
import sys
sys.exit(0 if int(sys.argv[1]) >= int(sys.argv[2]) else 1)
PY

say "approving…"
$C cast send "$USDC" 'approve(address,uint256)' "$LEDGER" "$AMOUNT" --private-key "$PK" --rpc-url "$RPC" --json > /tmp/aura_approve.json
grep -q '"status":"0x1"' /tmp/aura_approve.json || die "approve failed"
ok "allowance set"

say "funding…"
$C cast send "$LEDGER" 'fund(uint256)' "$AMOUNT" --private-key "$PK" --rpc-url "$RPC" --json > /tmp/aura_fund.json
grep -q '"status":"0x1"' /tmp/aura_fund.json || die "fund failed"

POOL="$($C cast call "$LEDGER" 'poolBalance()(uint256)' --rpc-url "$RPC" | awk '{print $1}')"
ok "pool now $POOL base units"
python3 - "$POOL" "$AMOUNT" <<'PY'
import sys
pool, need = int(sys.argv[1]), int(sys.argv[2])
print(f"  pool {pool/1e6:.6f} USDC | funded at least {need/1e6:.6f} USDC" if pool >= need else "  pool below target")
PY
