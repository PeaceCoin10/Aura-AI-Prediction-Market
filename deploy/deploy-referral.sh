#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Aura · deploy the ReferralLedger to Base mainnet and wire the frontend to it.
#
#   bash deploy/deploy-referral.sh
#
# Key handling: the deployer key is read from a file, never from an argument or the environment
# history, and never printed. Default location ~/.aura/deployer.key (0600). Override with
# KEY_FILE=/path/to/key.
#
# Owner/operator default to the treasury wallet; override with OWNER= / OPERATOR=.
# After a successful broadcast the address is written to frontend/.env as VITE_REFERRAL_LEDGER,
# which is what flips the affiliate drawer from "local estimate" to a real claimable balance.
# ─────────────────────────────────────────────────────────────
set -euo pipefail
export PATH=/opt/foundry:$PATH
cd "$(dirname "$0")/.."

KEY_FILE="${KEY_FILE:-$HOME/.aura/deployer.key}"
OWNER="${OWNER:-0x436b9d5e6fBd40eC93E881263bE53e59F8755Ba1}"
OPERATOR="${OPERATOR:-$OWNER}"
REBATE_BPS="${REBATE_BPS:-2000}"
RPC="${BASE_RPC_URL:-https://mainnet.base.org}"
CHAIN_ID=8453

say() { printf '\033[36m▸\033[0m %s\n' "$*"; }
ok()  { printf '\033[32m✓\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ -f "$KEY_FILE" ] || die "no key at $KEY_FILE — write the deployer key there (chmod 600), do not paste it into chat"
PRIVATE_KEY="$(tr -d '\r\n ' < "$KEY_FILE")"
[[ "$PRIVATE_KEY" =~ ^0x[0-9a-fA-F]{64}$ ]] || die "key file must contain a single 0x-prefixed 32-byte key"
export PRIVATE_KEY OWNER OPERATOR REBATE_BPS

DEPLOYER="$(cast wallet address --private-key "$PRIVATE_KEY")"
say "deployer  $DEPLOYER"
BAL="$(env -u http_proxy -u https_proxy -u all_proxy cast balance "$DEPLOYER" --rpc-url "$RPC")"
say "balance   $BAL wei on Base"
python3 - "$BAL" <<'PY' || die "deployer has no ETH on Base — fund it first"
import sys
bal = int(sys.argv[1])
sys.exit(0 if bal > 10**13 else 1)
PY

say "estimating…"
EST="$(env -u http_proxy -u https_proxy -u all_proxy forge script script/DeployReferralLedger.s.sol:DeployReferralLedger \
  --rpc-url "$RPC" --sender "$DEPLOYER" --json 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("gas_estimate", "?"))' || echo "?")"
say "gas est   $EST"

say "broadcasting…"
env -u http_proxy -u https_proxy -u all_proxy forge script script/DeployReferralLedger.s.sol:DeployReferralLedger \
  --rpc-url "$RPC" --broadcast --slow 2>&1 | tail -12

ART="broadcast/DeployReferralLedger.s.sol/$CHAIN_ID/run-latest.json"
[ -f "$ART" ] || die "no broadcast artifact at $ART"
LEDGER="$(python3 - "$ART" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
txs = d.get("transactions", [])
addrs = [t.get("contractAddress") for t in txs if t.get("contractAddress")]
print(addrs[0] if addrs else "")
PY
)"
[ -n "$LEDGER" ] || die "could not read the deployed address from $ART"
ok "ReferralLedger $LEDGER"

CODE="$(env -u http_proxy -u https_proxy -u all_proxy cast code "$LEDGER" --rpc-url "$RPC")"
[[ "$CODE" == 0x60* ]] || die "no code at $LEDGER"
ok "code present (${#CODE}+ bytes prefix)"

# --- wire the frontend -------------------------------------------------------
ENV_FILE=frontend/.env
touch "$ENV_FILE"
python3 - "$ENV_FILE" "$LEDGER" <<'PY'
import re, sys
path, addr = sys.argv[1], sys.argv[2]
text = open(path, encoding="utf-8").read().splitlines()
text = [l for l in text if not l.startswith("VITE_REFERRAL_LEDGER")]
text.append(f"VITE_REFERRAL_LEDGER={addr}")
open(path, "w", encoding="utf-8").write("\n".join(text) + "\n")
PY
ok "frontend/.env now points at $LEDGER"

echo
echo "  ledger      $LEDGER"
echo "  owner       $OWNER"
echo "  operator    $OPERATOR"
echo "  rebateBps   $REBATE_BPS"
echo "  explorer    https://basescan.org/address/$LEDGER"
echo "  next        fund the pool: cast send $LEDGER 'fund(uint256)' <amount> --private-key …"
echo "  next        rebuild + publish: ./deploy/gh-pages.sh"
