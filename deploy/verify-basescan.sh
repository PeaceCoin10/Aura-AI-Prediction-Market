#!/usr/bin/env bash
# One-shot Basescan verification (no browser, no manual steps): only needs a valid Etherscan V2 API key.
#
#   ETHERSCAN_API_KEY=xxxx bash deploy/verify-basescan.sh
#
# Idempotent: for already-verified contracts forge replies "Already Verified", which is not a failure.
# To have it wait for the key in the background and then run itself, see the cron line at the end.
set -uo pipefail
export PATH=/opt/foundry:$PATH
cd "$(dirname "$0")/.." || exit 1

ENGINE=0xE6056Bc6700F6d7E6fF8779B212655284dc1631C
VAULT=0x29dE563f3059827D00837305FAE2Bbc87c7D9eE1
V2="https://api.etherscan.io/v2/api?chainid=8453"

if [[ -z "${ETHERSCAN_API_KEY:-}" ]]; then
  echo "Missing ETHERSCAN_API_KEY: request a free Etherscan V2 key at https://etherscan.io/myapikey (one key covers Base)." >&2
  exit 2
fi

# the proxy is only needed for the API; forge compilation needs no network
rc=0

echo "== 1/2 ProtocolFeeVault"
forge verify-contract "$VAULT" src/ProtocolFeeVault.sol:ProtocolFeeVault \
  --chain 8453 --verifier etherscan --verifier-url "$V2" \
  --etherscan-api-key "$ETHERSCAN_API_KEY" \
  --constructor-args "$(cat deploy/verify/vault-ctor-args.txt)" || rc=1

echo "== 2/2 CentralPredictionEngine"
forge verify-contract "$ENGINE" src/CentralPredictionEngine.sol:CentralPredictionEngine \
  --chain 8453 --verifier etherscan --verifier-url "$V2" \
  --etherscan-api-key "$ETHERSCAN_API_KEY" \
  --constructor-args "$(cat deploy/verify/engine-ctor-args.txt)" || rc=1

echo "== recheck (does the Basescan page show Contract Source Code Verified)"
for a in "$VAULT" "$ENGINE"; do
  printf '%s : ' "$a"
  curl -s --max-time 25 "https://basescan.org/address/$a#code" \
    | grep -o -m1 "Contract Source Code Verified" || echo "not verified yet"
done

exit $rc

# ── background auto-verification (optional) ───────────────────────────
# Write the key to /root/.etherscan_key (mode 600) and install one crontab entry; it runs as soon as the key exists:
#
#   echo 'ETHERSCAN_API_KEY=your_key' > /root/.etherscan_key && chmod 600 /root/.etherscan_key
#   ( crontab -l 2>/dev/null; \
#     echo '17 */6 * * * set -a; . /root/.etherscan_key; set +a; cd /root/prediction-market && bash deploy/verify-basescan.sh >> /tmp/basescan-verify.log 2>&1' ) | crontab -
#
# Once verification succeeds, delete that cron entry (crontab -e).
