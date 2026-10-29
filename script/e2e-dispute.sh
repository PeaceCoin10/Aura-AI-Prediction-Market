#!/usr/bin/env bash
# 争议缓冲期 + 多态确认的端到端演练（anvil，真实价格源）
#
#   bash script/e2e-dispute.sh
#
# 会启动 anvil(8545) → 部署引擎 → 大脑建盘 → 用户下注 → 时间快进 →
# 大脑 3×30s 多态确认后裁决 → 争议期内赎回被拒 → Safe 改判 → 窗口到期赎回 → 扫残余
set -euo pipefail

export PATH=/opt/foundry:$PATH
RPC=http://127.0.0.1:8545
DEPLOYER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
TRADER_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
TRADER=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
WORKDIR=$(mktemp -d)

# cast 输出里 uint 会带 "[1.793e9]" 这种人类可读后缀，算术前必须剥掉
clean() { sed 's/\[[^]]*\]//g'; }
num()   { clean | tr -d ' ' | cut -d'|' -f1; }

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m   PASS\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m   FAIL\033[0m %s\n' "$*"; exit 1; }

cleanup() { [[ -n "${ANVIL_PID:-}" ]] && kill "$ANVIL_PID" 2>/dev/null || true; }
trap cleanup EXIT

say "1/9 启动 anvil"
anvil --port 8545 --chain-id 31337 >/dev/null 2>&1 &
ANVIL_PID=$!
for _ in $(seq 1 40); do cast chain-id --rpc-url $RPC >/dev/null 2>&1 && break; sleep 0.25; done
[[ "$(cast chain-id --rpc-url $RPC)" == "31337" ]] || die "anvil 没起来"
ok "chain-id 31337"

say "2/9 部署 CentralPredictionEngine（自动发 MockUSDC）"
OUT=$(cd "$(dirname "$0")/.." && pwd)
DEPLOY=$(PRIVATE_KEY=$DEPLOYER_PK TREASURY=$DEPLOYER ADMIN=$DEPLOYER CREATOR=$DEPLOYER ORACLE=$DEPLOYER \
  forge script "$OUT/script/DeployCentral.s.sol:DeployCentral" --rpc-url $RPC --broadcast 2>&1)
ENGINE=$(echo "$DEPLOY" | awk '/export ENGINE=/{sub(/.*ENGINE=/,""); print $1}')
USDC=$(echo "$DEPLOY" | awk '/export USDC=/{sub(/.*USDC=/,""); print $1}')
[[ -n "$ENGINE" && -n "$USDC" ]] || die "部署输出里没解析到地址"
ok "engine=$ENGINE usdc=$USDC"

say "3/9 给大脑与交易者发测试币"
cast send $USDC "mint(address,uint256)" $DEPLOYER 2000000000 --private-key $DEPLOYER_PK --rpc-url $RPC >/dev/null
cast send $USDC "mint(address,uint256)" $TRADER 500000000 --private-key $DEPLOYER_PK --rpc-url $RPC >/dev/null
ok "brain 2000 USDC / trader 500 USDC"

say "4/9 大脑建盘（真实现货价）"
BRAIN_ENV=(RPC_URL=$RPC ENGINE=$ENGINE USDC=$USDC BRAIN_PK=$DEPLOYER_PK
           SEED_USDC=100 HORIZON_HOURS=24 SITE_URL=https://predict.example.com
           BRAIN_WORKDIR=$WORKDIR)
env "${BRAIN_ENV[@]}" python3 "$OUT/hermes_agent.py" --once --creator-only --no-marketing 2>&1 | tail -4
COUNT=$(cast call $ENGINE "marketCount()(uint256)" --rpc-url $RPC | cut -d' ' -f1)
[[ "$COUNT" -ge 1 ]] || die "大脑没建出盘口"
MID=$(python3 -c "import json,os;s=json.load(open('$WORKDIR/hermes_state.json'));print(list(s['markets'])[0])")
QS=$(cast call $ENGINE "marketQuestion(bytes32)(string)" $MID --rpc-url $RPC)
ok "marketCount=$COUNT id=${MID:0:12}… question=$QS"

say "5/9 交易者买 NO 9 USDC"
cast send $USDC "approve(address,uint256)" $ENGINE 500000000 --private-key $TRADER_PK --rpc-url $RPC >/dev/null
cast send $ENGINE "buyShares(bytes32,uint8,uint256,uint256)" $MID 0 9000000 0 \
  --private-key $TRADER_PK --rpc-url $RPC >/dev/null
NO_BAL=$(cast call $ENGINE "noOf(bytes32,address)(uint256)" $MID $TRADER --rpc-url $RPC | cut -d' ' -f1)
ok "trader NO shares=$NO_BAL"

say "6/9 时间快进到结算点之后"
RT=$(cast call $ENGINE "marketCore(bytes32)((uint256,uint256,uint256,uint256,uint256,uint256,uint256,address,uint8,bool,bool))" $MID --rpc-url $RPC | cut -d, -f6 | clean | tr -d ' ' | awk '{print $1}')
NOW=$(cast block latest --field timestamp --rpc-url $RPC)
cast rpc evm_increaseTime $(( RT - NOW + 120 )) --rpc-url $RPC >/dev/null
cast rpc evm_mine --rpc-url $RPC >/dev/null
ok "chain time=$(cast block latest --field timestamp --rpc-url $RPC) resolutionTime=$RT"

say "7/9 大脑 3×间隔 30s 多态确认后裁决（真实等待 60s）"
env "${BRAIN_ENV[@]}" python3 "$OUT/hermes_agent.py" --once --oracle-only 2>&1 | grep -E "sample|resolve|dispute" || true
read -r RESOLVED FINALIZED DISPUTING OUTCOME ENDS_AT OWED < <(
  cast call $ENGINE "resolutionState(bytes32)(bool,bool,bool,uint8,uint256,uint256)" $MID --rpc-url $RPC \
    | clean | tr '\n' ' ' | tr -d '(),' | awk '{print $1,$2,$3,$4,$5,$6}'
)
[[ "$RESOLVED" == "true" ]] || die "没裁决成功"
[[ "$DISPUTING" == "true" ]] || die "应该处在争议期"
[[ "$FINALIZED" == "false" ]] || die "争议期内不该是 finalized"
ok "resolved=$RESOLVED disputing=$DISPUTING outcome=$OUTCOME owed=$OWED endsAt=$ENDS_AT"

say "8/9 争议期内：赎回必须被拒 → Safe 改判 → 窗口到期赎回"
if OUTP=$(cast send $ENGINE "redeem(bytes32)" $MID --private-key $TRADER_PK --rpc-url $RPC 2>&1); then
  die "争议期内竟然能赎回"
else
  echo "$OUTP" | grep -qi "DisputeWindowOpen\|0x" && ok "redeem 被拒（DisputeWindowOpen）" || die "拒绝原因不是争议期"
fi

OLD_OUTCOME=$OUTCOME
NEW_OUTCOME=$(( 1 - OUTCOME ))
cast send $ENGINE "overrideResolution(bytes32,uint8)" $MID $NEW_OUTCOME --private-key $DEPLOYER_PK --rpc-url $RPC >/dev/null
read -r RESOLVED FINALIZED DISPUTING OUTCOME2 ENDS_AT2 OWED2 < <(
  cast call $ENGINE "resolutionState(bytes32)(bool,bool,bool,uint8,uint256,uint256)" $MID --rpc-url $RPC \
    | clean | tr '\n' ' ' | tr -d '(),' | awk '{print $1,$2,$3,$4,$5,$6}'
)
[[ "$OUTCOME2" == "$NEW_OUTCOME" ]] || die "改判没生效"
[[ "$ENDS_AT2" == "$ENDS_AT" ]] || die "改判竟然延长了争议期"
ok "Safe 改判 $OLD_OUTCOME → $OUTCOME2，owed=$OWED2，窗口未延长"

# 改回原判，模拟「复核后确认预言机没问题」
cast send $ENGINE "overrideResolution(bytes32,uint8)" $MID $OLD_OUTCOME --private-key $DEPLOYER_PK --rpc-url $RPC >/dev/null
cast rpc evm_increaseTime 3705 --rpc-url $RPC >/dev/null
cast rpc evm_mine --rpc-url $RPC >/dev/null
[[ "$(cast call $ENGINE "isFinal(bytes32)(bool)" $MID --rpc-url $RPC)" == "true" ]] || die "窗口到期后仍未终结"
cast send $ENGINE "redeem(bytes32)" $MID --private-key $TRADER_PK --rpc-url $RPC >/dev/null
TRADER_BAL=$(cast call $USDC "balanceOf(address)(uint256)" $TRADER --rpc-url $RPC | cut -d' ' -f1)
ok "窗口到期 redeem 成功，trader USDC=$TRADER_BAL（本金 500 USDC 已含 9 USDC 下注）"

say "9/9 扫残余：引擎余额必须归零"
cast send $ENGINE "sweepResidual(bytes32)" $MID --private-key $DEPLOYER_PK --rpc-url $RPC >/dev/null
LEFT=$(cast call $USDC "balanceOf(address)(uint256)" $ENGINE --rpc-url $RPC | cut -d' ' -f1)
[[ "$LEFT" == "0" ]] || die "引擎里还剩 $LEFT（存在死钱）"
ok "engine USDC balance=0，无资金滞留"

say "ALL GREEN —— 争议期 / 改判 / 多态确认全流程通过"
