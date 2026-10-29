// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ReferralLedger} from "../src/ReferralLedger.sol";

/**
 * @notice Deploy the affiliate rebate ledger.
 *
 *  Local anvil:
 *    forge script script/DeployReferralLedger.s.sol:DeployReferralLedger \
 *      --rpc-url http://127.0.0.1:8545 --broadcast
 *
 *  Base mainnet:
 *    forge script script/DeployReferralLedger.s.sol:DeployReferralLedger \
 *      --rpc-url $BASE_RPC_URL --broadcast --verify --etherscan-api-key $BASESCAN_API_KEY
 *
 *  Environment:
 *    PRIVATE_KEY     deployer key (required, pays gas)
 *    COLLATERAL      USDC address (default: Base native USDC 0x8335...2913)
 *    OPERATOR        indexer key allowed to accrue trades (default: the deployer)
 *    OWNER           owner of the ledger (default: the deployer; use a Safe in production)
 *    REBATE_BPS      referrer share of the 1.5% fee, in bps (default: 2000 = 20%)
 *
 *  After deploying, fund the pool with USDC (ledger.fund) and set VITE_REFERRAL_LEDGER in the
 *  frontend so the affiliate drawer switches from a local estimate to a real, claimable balance.
 */
contract DeployReferralLedger is Script {
    address internal constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external returns (ReferralLedger ledger) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address collateral = vm.envOr("COLLATERAL", BASE_USDC);
        address operator = vm.envOr("OPERATOR", deployer);
        address owner = vm.envOr("OWNER", deployer);
        uint16 rebateBps = uint16(vm.envOr("REBATE_BPS", uint256(2000)));

        console2.log("deployer   ", deployer);
        console2.log("chainId    ", block.chainid);
        console2.log("collateral ", collateral);
        console2.log("operator   ", operator);
        console2.log("owner      ", owner);
        console2.log("rebateBps  ", rebateBps);

        vm.startBroadcast(pk);
        ledger = new ReferralLedger(collateral, operator, owner, rebateBps);
        vm.stopBroadcast();

        console2.log("ReferralLedger", address(ledger));
        console2.log("next: fund the pool with USDC, then set VITE_REFERRAL_LEDGER");
    }
}
