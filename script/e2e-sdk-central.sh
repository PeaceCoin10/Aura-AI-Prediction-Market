#!/usr/bin/env bash
# CentralPredictionSDK 的真链联调（anvil 一键跑）
#
#   bash script/e2e-sdk-central.sh
#
# 流程：起链 → 部署引擎 → SDK 建盘 → 做市 → 买入 → 卖出 → 裁决 → 争议期拦提现 →
#       Safe 改判 → 提现 → 扫残余，每一步都是 SDK 生成的真实 calldata 上链。
set -euo pipefail

export PATH=/opt/foundry:$PATH
RPC=http://127.0.0.1:8545
PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
A=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
ROOT=$(cd "$(dirname "$0")/.." && pwd)

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m   FAIL\033[0m %s\n' "$*"; exit 1; }

cleanup() { [[ -n "${ANVIL_PID:-}" ]] && kill "$ANVIL_PID" 2>/dev/null || true; }
trap cleanup EXIT

say "1/4 启动 anvil"
anvil --port 8545 --chain-id 31337 >/dev/null 2>&1 &
ANVIL_PID=$!
for _ in $(seq 1 40); do cast chain-id --rpc-url $RPC >/dev/null 2>&1 && break; sleep 0.25; done
[[ "$(cast chain-id --rpc-url $RPC)" == "31337" ]] || die "anvil 没起来"

say "2/4 部署 CentralPredictionEngine"
DEPLOY=$(PRIVATE_KEY=$PK TREASURY=$A ADMIN=$A CREATOR=$A ORACLE=$A \
  forge script "$ROOT/script/DeployCentral.s.sol:DeployCentral" --rpc-url $RPC --broadcast 2>&1)
ENGINE=$(echo "$DEPLOY" | awk '/export ENGINE=/{sub(/.*ENGINE=/,""); print $1}')
USDC=$(echo "$DEPLOY" | awk '/export USDC=/{sub(/.*USDC=/,""); print $1}')
[[ -n "$ENGINE" && -n "$USDC" ]] || die "部署输出里没解析到地址"
echo "   engine=$ENGINE usdc=$USDC"

say "3/4 编译 SDK"
cd "$ROOT/sdk" && npm run build >/dev/null
echo "   dist/ 已就绪"

say "4/4 跑 SDK 真链联调"
cast send $USDC "mint(address,uint256)" $A 100000000000 --private-key $PK --rpc-url $RPC >/dev/null
RPC_URL=$RPC ENGINE=$ENGINE USDC=$USDC PK=$PK node dist/e2e-central.js
