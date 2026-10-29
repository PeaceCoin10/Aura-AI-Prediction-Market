#!/usr/bin/env bash
# 一键补 Basescan 验证（免网页、免人工）：只要求环境里有合法的 Etherscan V2 API key。
#
#   ETHERSCAN_API_KEY=xxxx bash deploy/verify-basescan.sh
#
# 幂等：已验证过的合约，forge 会回 "Already Verified"，不算失败。
# 想让它「后台自己等 key 出现再跑」，见文件末尾的 cron 一行。
set -uo pipefail
export PATH=/opt/foundry:$PATH
cd "$(dirname "$0")/.." || exit 1

ENGINE=0xE6056Bc6700F6d7E6fF8779B212655284dc1631C
VAULT=0x29dE563f3059827D00837305FAE2Bbc87c7D9eE1
V2="https://api.etherscan.io/v2/api?chainid=8453"

if [[ -z "${ETHERSCAN_API_KEY:-}" ]]; then
  echo "缺少 ETHERSCAN_API_KEY：Etherscan V2 免费 key 在 https://etherscan.io/myapikey 申请（一个 key 覆盖 Base）。" >&2
  exit 2
fi

# 代理只给 API 用；forge 编译不需要网络
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

echo "== 复查（Basescan 页面是否出现 Contract Source Code Verified）"
for a in "$VAULT" "$ENGINE"; do
  printf '%s : ' "$a"
  curl -s --max-time 25 "https://basescan.org/address/$a#code" \
    | grep -o -m1 "Contract Source Code Verified" || echo "仍未验证"
done

exit $rc

# ── 后台自动补验证（可选）─────────────────────────────────────────────
# 把 key 写进 /root/.etherscan_key（权限 600），再装一条 crontab，key 一到位它自己就跑了：
#
#   echo 'ETHERSCAN_API_KEY=你的key' > /root/.etherscan_key && chmod 600 /root/.etherscan_key
#   ( crontab -l 2>/dev/null; \
#     echo '17 */6 * * * set -a; . /root/.etherscan_key; set +a; cd /root/prediction-market && bash deploy/verify-basescan.sh >> /tmp/basescan-verify.log 2>&1' ) | crontab -
#
# 验证成功后把这条 cron 删掉即可（crontab -e）。
