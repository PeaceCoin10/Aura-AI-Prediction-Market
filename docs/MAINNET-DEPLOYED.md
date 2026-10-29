# Aura — Base mainnet deployment

Everything in this file was read back from Base mainnet (chain id `8453`), not from a deploy log.

| Contract | Address | Code |
| --- | --- | --- |
| `CentralPredictionEngine` | `0xE6056Bc6700F6d7E6fF8779B212655284dc1631C` | deployed, 26 KB runtime |
| `ProtocolFeeVault` | `0x29dE563f3059827D00837305FAE2Bbc87c7D9eE1` | deployed |
| `USDC` (native) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | canonical Base USDC |

## Live parameters

| Parameter | Value | Source |
| --- | --- | --- |
| `admin()` | `0x436b9d5e6fBd40eC93E881263bE53e59F8755Ba1` | `cast call` |
| `treasury()` (engine) | `0x436b9d5e6fBd40eC93E881263bE53e59F8755Ba1` | `cast call` |
| `treasury()` (fee vault) | `0x436b9d5e6fBd40eC93E881263bE53e59F8755Ba1` | `cast call` |
| `collateral()` | native Base USDC | `cast call` |
| `feeVault()` | `0x29dE…9eE1` | `cast call` |
| `TRADE_FEE_BPS()` | `150` (1.5%) | `cast call` |
| `DISPUTE_WINDOW()` | `3600` s (1 hour) | `cast call` |
| `MIN_BET()` | `5_000_000` (5 USDC) | `cast call` |
| `paused()` | `false` | `cast call` |
| `marketCount()` | `0` | `cast call` |

Read it yourself:

```bash
export PATH=/opt/foundry:$PATH
cast call 0xE6056Bc6700F6d7E6fF8779B212655284dc1631C "marketCount()(uint256)" --rpc-url https://base-rpc.publicnode.com
```

## What this state means

- The engine is live and unpaused, with the protocol fee pointing at the fee vault. It is **empty**:
  `marketCount()` is `0`, so no book trades real USDC yet. The dApp's 130 featured markets are
  sample data quoted with the same CPMM maths (paper mode); they are not on-chain markets.
- `admin` and `treasury` are a single EOA, not a Safe. That is a deliberate single-operator
  bootstrap setting, not production custody: before any real volume, move both to a Safe and call
  `transferAdmin` → `acceptAdmin` (two-step) on the engine and `transferOwnership` →
  `acceptOwnership` on the vault.
- The verified source on Basescan predates the repository-wide English pass. The deployed bytecode
  is what it is; the repository source is the English-only version of the same program. Re-verify
  with `forge verify-contract` (see `deploy/verify-basescan.sh`) whenever the contracts are next
  redeployed.

## Reproducing the deployment

```bash
# engine + fee vault, one command (see docs/DEPLOY-PERMANENT.md and script/DeployCentral.s.sol)
REQUIRE_SAFE_CONTRACT=0 \
PRIVATE_KEY=0x… \
TREASURY=0x436b9d5e6fBd40eC93E881263bE53e59F8755Ba1 \
ADMIN=0x436b9d5e6fBd40eC93E881263bE53e59F8755Ba1 \
forge script script/DeployCentral.s.sol:DeployCentral \
  --rpc-url $BASE_RPC_URL --broadcast
```

## Referral ledger

`ReferralLedger` (`src/ReferralLedger.sol`) is written, unit-tested (16 forge tests) and has a
one-command deploy script, but it is **not deployed**: this machine holds no key for the admin
address, so there is no address to publish and the dApp does not pretend otherwise. Deploy it with

```bash
PRIVATE_KEY=0x… OPERATOR=0x… OWNER=0x436b9d5e6fBd40eC93E881263bE53e59F8755Ba1 \
forge script script/DeployReferralLedger.s.sol:DeployReferralLedger \
  --rpc-url $BASE_RPC_URL --broadcast --verify --etherscan-api-key $ETHERSCAN_API_KEY
```

then fund the pool (`ledger.fund(amount)` after a USDC approval) and set `VITE_REFERRAL_LEDGER` in
the frontend. The affiliate drawer switches from a local estimate to a real claimable balance the
moment that variable is set.
