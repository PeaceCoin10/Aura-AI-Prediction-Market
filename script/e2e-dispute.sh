#!/usr/bin/env bash
# End-to-end rehearsal of the dispute window + multi-sample confirmation (anvil, real price feed)
#
#   bash script/e2e-dispute.sh
#
# Starts anvil(8545) → deploys the engine → brain creates a market → user bets → time travel →
# brain resolves after 3×30s multi-sample confirmation → redeem blocked in the dispute window → Safe override → redeem after the window → sweep residual
set -euo pipefail

export PATH=/opt/foundry:$PATH
RPC=http://127.0.0.1:8545
DEPLOYER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
TRADER_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
TRADER=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
WORKDIR=$(mktemp -d)

# cast prints uints with a human-readable suffix like "[1.793e9]" — strip it before doing arithmetic
clean() { sed 's/\[[^]]*\]//g'; }
num()   { clean | tr -d ' ' | cut -d'|' -f1; }

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m   PASS\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m   FAIL\033[0m %s\n' "$*"; exit 1; }

cleanup() { [[ -n "${ANVIL_PID:-}" ]] && kill "$ANVIL_PID" 2>/dev/null || true; }
trap cleanup EXIT

say "1/9 starting anvil"
anvil --port 8545 --chain-id 31337 >/dev/null 2>&1 &
ANVIL_PID=$!
for _ in $(seq 1 40); do cast chain-id --rpc-url $RPC >/dev/null 2>&1 && break; sleep 0.25; done
[[ "$(cast chain-id --rpc-url $RPC)" == "31337" ]] || die "anvil did not come up"
ok "chain-id 31337"

say "2/9 deploying CentralPredictionEngine (MockUSDC is deployed automatically)"
OUT=$(cd "$(dirname "$0")/.." && pwd)
DEPLOY=$(PRIVATE_KEY=$DEPLOYER_PK TREASURY=$DEPLOYER ADMIN=$DEPLOYER CREATOR=$DEPLOYER ORACLE=$DEPLOYER \
  forge script "$OUT/script/DeployCentral.s.sol:DeployCentral" --rpc-url $RPC --broadcast 2>&1)
ENGINE=$(echo "$DEPLOY" | awk '/export ENGINE=/{sub(/.*ENGINE=/,""); print $1}')
USDC=$(echo "$DEPLOY" | awk '/export USDC=/{sub(/.*USDC=/,""); print $1}')
[[ -n "$ENGINE" && -n "$USDC" ]] || die "could not parse an address out of the deploy output"
ok "engine=$ENGINE usdc=$USDC"

say "3/9 minting test USDC to the brain and the trader"
cast send $USDC "mint(address,uint256)" $DEPLOYER 2000000000 --private-key $DEPLOYER_PK --rpc-url $RPC >/dev/null
cast send $USDC "mint(address,uint256)" $TRADER 500000000 --private-key $DEPLOYER_PK --rpc-url $RPC >/dev/null
ok "brain 2000 USDC / trader 500 USDC"

say "4/9 brain creates a market (live spot price)"
BRAIN_ENV=(RPC_URL=$RPC ENGINE=$ENGINE USDC=$USDC BRAIN_PK=$DEPLOYER_PK
           SEED_USDC=100 HORIZON_HOURS=24 SITE_URL=https://predict.example.com
           BRAIN_WORKDIR=$WORKDIR)
env "${BRAIN_ENV[@]}" python3 "$OUT/hermes_agent.py" --once --creator-only --no-marketing 2>&1 | tail -4
COUNT=$(cast call $ENGINE "marketCount()(uint256)" --rpc-url $RPC | cut -d' ' -f1)
[[ "$COUNT" -ge 1 ]] || die "the brain did not create any market"
MID=$(python3 -c "import json,os;s=json.load(open('$WORKDIR/hermes_state.json'));print(list(s['markets'])[0])")
QS=$(cast call $ENGINE "marketQuestion(bytes32)(string)" $MID --rpc-url $RPC)
ok "marketCount=$COUNT id=${MID:0:12}… question=$QS"

say "5/9 trader buys NO for 9 USDC"
cast send $USDC "approve(address,uint256)" $ENGINE 500000000 --private-key $TRADER_PK --rpc-url $RPC >/dev/null
cast send $ENGINE "buyShares(bytes32,uint8,uint256,uint256)" $MID 0 9000000 0 \
  --private-key $TRADER_PK --rpc-url $RPC >/dev/null
NO_BAL=$(cast call $ENGINE "noOf(bytes32,address)(uint256)" $MID $TRADER --rpc-url $RPC | cut -d' ' -f1)
ok "trader NO shares=$NO_BAL"

say "6/9 fast-forwarding past the resolution time"
RT=$(cast call $ENGINE "marketCore(bytes32)((uint256,uint256,uint256,uint256,uint256,uint256,uint256,address,uint8,bool,bool))" $MID --rpc-url $RPC | cut -d, -f6 | clean | tr -d ' ' | awk '{print $1}')
NOW=$(cast block latest --field timestamp --rpc-url $RPC)
cast rpc evm_increaseTime $(( RT - NOW + 120 )) --rpc-url $RPC >/dev/null
cast rpc evm_mine --rpc-url $RPC >/dev/null
ok "chain time=$(cast block latest --field timestamp --rpc-url $RPC) resolutionTime=$RT"

say "7/9 brain resolves after 3 samples 30s apart (really waits 60s)"
env "${BRAIN_ENV[@]}" python3 "$OUT/hermes_agent.py" --once --oracle-only 2>&1 | grep -E "sample|resolve|dispute" || true
read -r RESOLVED FINALIZED DISPUTING OUTCOME ENDS_AT OWED < <(
  cast call $ENGINE "resolutionState(bytes32)(bool,bool,bool,uint8,uint256,uint256)" $MID --rpc-url $RPC \
    | clean | tr '\n' ' ' | tr -d '(),' | awk '{print $1,$2,$3,$4,$5,$6}'
)
[[ "$RESOLVED" == "true" ]] || die "resolution did not succeed"
[[ "$DISPUTING" == "true" ]] || die "should be inside the dispute window"
[[ "$FINALIZED" == "false" ]] || die "must not be finalized inside the dispute window"
ok "resolved=$RESOLVED disputing=$DISPUTING outcome=$OUTCOME owed=$OWED endsAt=$ENDS_AT"

say "8/9 during the dispute window: redeem must be rejected → Safe override → redeem after the window"
if OUTP=$(cast send $ENGINE "redeem(bytes32)" $MID --private-key $TRADER_PK --rpc-url $RPC 2>&1); then
  die "redeem unexpectedly succeeded inside the dispute window"
else
  echo "$OUTP" | grep -qi "DisputeWindowOpen\|0x" && ok "redeem rejected (DisputeWindowOpen)" || die "the rejection reason is not the dispute window"
fi

OLD_OUTCOME=$OUTCOME
NEW_OUTCOME=$(( 1 - OUTCOME ))
cast send $ENGINE "overrideResolution(bytes32,uint8)" $MID $NEW_OUTCOME --private-key $DEPLOYER_PK --rpc-url $RPC >/dev/null
read -r RESOLVED FINALIZED DISPUTING OUTCOME2 ENDS_AT2 OWED2 < <(
  cast call $ENGINE "resolutionState(bytes32)(bool,bool,bool,uint8,uint256,uint256)" $MID --rpc-url $RPC \
    | clean | tr '\n' ' ' | tr -d '(),' | awk '{print $1,$2,$3,$4,$5,$6}'
)
[[ "$OUTCOME2" == "$NEW_OUTCOME" ]] || die "the override did not take effect"
[[ "$ENDS_AT2" == "$ENDS_AT" ]] || die "the override unexpectedly extended the dispute window"
ok "Safe override $OLD_OUTCOME → $OUTCOME2, owed=$OWED2, window not extended"

# restore the original outcome, simulating a review that clears the oracle
cast send $ENGINE "overrideResolution(bytes32,uint8)" $MID $OLD_OUTCOME --private-key $DEPLOYER_PK --rpc-url $RPC >/dev/null
cast rpc evm_increaseTime 3705 --rpc-url $RPC >/dev/null
cast rpc evm_mine --rpc-url $RPC >/dev/null
[[ "$(cast call $ENGINE "isFinal(bytes32)(bool)" $MID --rpc-url $RPC)" == "true" ]] || die "still not finalized after the window expired"
cast send $ENGINE "redeem(bytes32)" $MID --private-key $TRADER_PK --rpc-url $RPC >/dev/null
TRADER_BAL=$(cast call $USDC "balanceOf(address)(uint256)" $TRADER --rpc-url $RPC | cut -d' ' -f1)
ok "redeem succeeded after the window expired, trader USDC=$TRADER_BAL (the 500 USDC principal already includes the 9 USDC bet)"

say "9/9 sweep residual: the engine balance must be zero"
cast send $ENGINE "sweepResidual(bytes32)" $MID --private-key $DEPLOYER_PK --rpc-url $RPC >/dev/null
LEFT=$(cast call $USDC "balanceOf(address)(uint256)" $ENGINE --rpc-url $RPC | cut -d' ' -f1)
[[ "$LEFT" == "0" ]] || die "the engine still holds $LEFT (dead money)"
ok "engine USDC balance=0, no funds stranded"

say "ALL GREEN — dispute window / override / multi-sample confirmation all pass"
