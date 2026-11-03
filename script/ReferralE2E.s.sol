// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IReferralLedger {
    function fund(uint256 amount) external;
    function accrue(bytes32 tradeId, address referrer, uint256 volume) external returns (uint256);
    function claim() external returns (uint256);
    function claimable(address referrer) external view returns (uint256);
    function poolBalance() external view returns (uint256);
    function operator() external view returns (address);
    function rebateFor(uint256 volume) external view returns (uint256);
}

/**
 * @notice End-to-end rehearsal of the affiliate path against the LIVE Base deployment.
 *
 *  Runs on a fork of Base mainnet, so the ledger under test is the deployed one at
 *  0x2ebf3b69…e8954 with its real storage, real USDC and the operator key that is now set
 *  on-chain. Only the USDC used for the pool comes from `deal` — mainnet funding needs real
 *  collateral, which this script deliberately does not pretend to have.
 *
 *  Sequence: fund pool → operator accrues an attributed trade → referrer claims → assert the
 *  USDC actually left the pool and landed in the referrer's wallet.
 *
 *  Run (no broadcast):
 *    forge script script/ReferralE2E.s.sol:ReferralE2E --fork-url $BASE_RPC_URL -vv
 */
contract ReferralE2E is Test {
    address internal constant LEDGER = 0x2EbF3B69870979F863B8900f03CE8AcfE58E8954;
    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant TREASURY = 0x436b9d5e6fBd40eC93E881263bE53e59F8755Ba1;

    uint256 internal constant POOL = 50e6; // 50 USDC
    uint256 internal constant VOLUME = 1_000e6; // a 1,000 USDC attributed trade

    function run() external {
        IReferralLedger ledger = IReferralLedger(LEDGER);
        address operator = ledger.operator();
        address referrer = address(0xBEEF);

        console2.log("ledger   ", LEDGER);
        console2.log("operator ", operator);
        console2.log("rebateFor(1000 USDC)", ledger.rebateFor(VOLUME));

        // 1. pool funding (fork-only liquidity)
        deal(USDC, TREASURY, POOL);
        vm.startPrank(TREASURY);
        IERC20(USDC).approve(LEDGER, POOL);
        ledger.fund(POOL);
        vm.stopPrank();
        require(ledger.poolBalance() == POOL, "pool not funded");
        console2.log("pool funded", ledger.poolBalance());

        // 2. operator accrues the attributed trade
        uint256 expected = ledger.rebateFor(VOLUME);
        vm.prank(operator);
        uint256 rebate = ledger.accrue(keccak256("e2e-fork-trade-1"), referrer, VOLUME);
        require(rebate == expected, "rebate mismatch");
        require(ledger.claimable(referrer) == expected, "claimable mismatch");
        console2.log("accrued  ", rebate);

        // 3. referrer claims, assert the USDC actually moves
        uint256 before = IERC20(USDC).balanceOf(referrer);
        vm.prank(referrer);
        uint256 paid = ledger.claim();
        uint256 afterBal = IERC20(USDC).balanceOf(referrer);
        require(paid == expected, "paid mismatch");
        require(afterBal - before == expected, "transfer mismatch");
        require(ledger.claimable(referrer) == 0, "not cleared");
        require(ledger.poolBalance() == POOL - expected, "pool not debited");
        console2.log("paid     ", paid);
        console2.log("pool left", ledger.poolBalance());

        // 4. double credit must revert
        vm.prank(operator);
        (bool ok,) = LEDGER.call(abi.encodeWithSignature("accrue(bytes32,address,uint256)", keccak256("e2e-fork-trade-1"), referrer, VOLUME));
        require(!ok, "duplicate trade accepted");

        console2.log("E2E OK: fund -> accrue -> claim -> transfer verified");
    }
}
