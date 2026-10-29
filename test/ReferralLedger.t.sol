// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {ProtocolFeeVault} from "../src/ProtocolFeeVault.sol";
import {CentralPredictionEngine} from "../src/CentralPredictionEngine.sol";
import {ReferralLedger} from "../src/ReferralLedger.sol";

/**
 * @notice Affiliate rebate ledger: accrual rules, deduplication, pull payouts and solvency.
 *         Also proves the attribution mechanism used by the dApp: a referral envelope appended to
 *         the order's calldata is ignored by the engine's ABI decoder, so tagging a trade costs
 *         calldata and nothing else.
 */
contract ReferralLedgerTest is Test {
    MockUSDC internal usdc;
    ProtocolFeeVault internal feeVault;
    CentralPredictionEngine internal engine;
    ReferralLedger internal ledger;

    address internal constant ADMIN = address(0xA11CE);
    address internal constant TREASURY = address(0xBEEF);
    address internal constant BOT = address(0xB07);
    address internal constant ORACLE = address(0x0AC1E);
    address internal constant ALICE = address(0xA1);
    address internal constant BOB = address(0xB1);
    address internal constant REFERRER = address(0x0EFE);

    bytes32 internal constant MID = keccak256("AURA-REFERRAL-TEST");
    string internal constant QUESTION = "Will Aura referral rebates settle on chain?";

    /// @dev tag prepended to the referrer address inside the order calldata
    bytes8 internal constant REF_MAGIC = bytes8("auraref1");

    function setUp() public {
        usdc = new MockUSDC();
        feeVault = new ProtocolFeeVault(address(usdc), TREASURY, address(this));
        engine = new CentralPredictionEngine(address(usdc), address(feeVault), TREASURY, ADMIN);
        ledger = new ReferralLedger(address(usdc), address(this), address(this), 2000);

        vm.startPrank(ADMIN);
        engine.setCreator(BOT, true);
        engine.setOracle(ORACLE, true);
        vm.stopPrank();

        vm.prank(BOT);
        engine.createMarket(MID, QUESTION, block.timestamp + 7 days);
    }

    function _seedPool(uint256 amount) internal {
        usdc.mint(address(this), amount);
        usdc.approve(address(ledger), amount);
        ledger.fund(amount);
    }

    /* ------------------------------ parameters ------------------------------ */

    function testRebateMathMatchesFee() public view {
        // 20% of the 1.5% fee on 1,000 USDC == 3 USDC
        assertEq(ledger.rebateFor(1_000e6), 3e6);
        assertEq(ledger.TRADE_FEE_BPS(), 150);
        assertEq(ledger.rebateBps(), 2000);
    }

    function testOnlyOwnerCanChangeParameters() public {
        vm.prank(ALICE);
        vm.expectRevert();
        ledger.setRebateBps(1000);

        vm.prank(ALICE);
        vm.expectRevert();
        ledger.setOperator(ALICE);
    }

    function testRebateShareIsCapped() public {
        vm.expectRevert(ReferralLedger.RebateTooHigh.selector);
        ledger.setRebateBps(5001);

        ledger.setRebateBps(5000);
        assertEq(ledger.rebateBps(), 5000);
    }

    function testRenounceIsDisabled() public {
        vm.expectRevert(ReferralLedger.RenounceDisabled.selector);
        ledger.renounceOwnership();
    }

    /* ------------------------------- accrual -------------------------------- */

    function testAccrueCreditsReferrer() public {
        uint256 rebate = ledger.accrue(keccak256("trade-1"), REFERRER, 1_000e6);

        assertEq(rebate, 3e6);
        assertEq(ledger.accrued(REFERRER), 3e6);
        assertEq(ledger.totalAccrued(), 3e6);
        assertTrue(ledger.creditedTrade(keccak256("trade-1")));
    }

    function testAccrueIsOperatorOnly() public {
        vm.prank(ALICE);
        vm.expectRevert(ReferralLedger.NotOperator.selector);
        ledger.accrue(keccak256("trade-2"), REFERRER, 1_000e6);

        ledger.setOperator(ALICE);
        vm.prank(ALICE);
        assertEq(ledger.accrue(keccak256("trade-2"), REFERRER, 1_000e6), 3e6);
    }

    function testSameTradeCannotBeCreditedTwice() public {
        bytes32 id = keccak256("trade-3");
        ledger.accrue(id, REFERRER, 1_000e6);

        vm.expectRevert(ReferralLedger.DuplicateTrade.selector);
        ledger.accrue(id, REFERRER, 1_000e6);
    }

    function testAccrueRejectsZeroInputs() public {
        vm.expectRevert(ReferralLedger.ZeroAddress.selector);
        ledger.accrue(keccak256("trade-4"), address(0), 1_000e6);

        vm.expectRevert(ReferralLedger.ZeroAmount.selector);
        ledger.accrue(keccak256("trade-5"), REFERRER, 0);

        // dust volume rounds to zero: nothing to pay, and no free storage write
        vm.expectRevert(ReferralLedger.ZeroAmount.selector);
        ledger.accrue(keccak256("trade-6"), REFERRER, 1);
    }

    function testOperatorCannotDebitOrRedirect() public {
        // credits only ever land on the address passed in; the operator has no claim() privilege
        ledger.accrue(keccak256("trade-7"), REFERRER, 1_000e6);
        assertEq(ledger.accrued(address(this)), 0);
        assertEq(ledger.claimable(address(this)), 0);
    }

    /* -------------------------------- payout -------------------------------- */

    function testClaimTransfersAndZeroesBalance() public {
        _seedPool(100e6);
        ledger.accrue(keccak256("trade-8"), REFERRER, 1_000e6);

        uint256 before = usdc.balanceOf(REFERRER);
        vm.prank(REFERRER);
        uint256 paid = ledger.claim();

        assertEq(paid, 3e6);
        assertEq(usdc.balanceOf(REFERRER), before + 3e6);
        assertEq(ledger.accrued(REFERRER), 0);
        assertEq(ledger.claimed(REFERRER), 3e6);
        assertEq(ledger.totalClaimed(), 3e6);
        assertEq(ledger.poolBalance(), 97e6);
    }

    function testClaimTwiceReverts() public {
        _seedPool(100e6);
        ledger.accrue(keccak256("trade-9"), REFERRER, 1_000e6);

        vm.startPrank(REFERRER);
        ledger.claim();
        vm.expectRevert(ReferralLedger.NothingToClaim.selector);
        ledger.claim();
        vm.stopPrank();
    }

    function testClaimRevertsWhenPoolIsShort() public {
        ledger.accrue(keccak256("trade-10"), REFERRER, 1_000e6); // nothing funded

        vm.prank(REFERRER);
        vm.expectRevert(ReferralLedger.InsufficientLiquidity.selector);
        ledger.claim();
    }

    function testClaimToSmartAccount() public {
        _seedPool(100e6);
        ledger.accrue(keccak256("trade-11"), REFERRER, 1_000e6);

        vm.prank(REFERRER);
        ledger.claimTo(BOB);
        assertEq(usdc.balanceOf(BOB), 3e6);
        assertEq(ledger.accrued(REFERRER), 0);
    }

    function testFundRejectsZero() public {
        vm.expectRevert(ReferralLedger.ZeroAmount.selector);
        ledger.fund(0);
    }

    /* ---------------------- attribution via calldata tag ---------------------- */

    /// @dev the dApp appends `magic || referrer` to the order calldata; the engine must still fill it
    function testReferralTagDoesNotDisturbTheOrder() public {
        usdc.mint(BOT, 10_000e6);
        vm.startPrank(BOT);
        usdc.approve(address(engine), 10_000e6);
        engine.seedLiquidity(MID, 10_000e6);
        vm.stopPrank();

        usdc.mint(ALICE, 1_000e6);
        vm.startPrank(ALICE);
        usdc.approve(address(engine), 1_000e6);

        bytes memory call = abi.encodeCall(CentralPredictionEngine.buyShares, (MID, 1, 100e6, 0));
        bytes memory tagged = abi.encodePacked(call, REF_MAGIC, REFERRER);

        // both orders are filled from the same pool state, so a difference could only come from the tag
        uint256 snap = vm.snapshot();

        uint256 sharesPlain = engine.buyShares(MID, 1, 100e6, 0);
        vm.revertTo(snap);

        (bool ok, bytes memory ret) = address(engine).call(tagged);
        assertTrue(ok, "engine rejected an order with a referral tag");
        uint256 sharesTagged = abi.decode(ret, (uint256));
        vm.stopPrank();

        assertGt(sharesTagged, 0, "no shares minted");
        assertEq(sharesTagged, sharesPlain, "tagged and plain orders differ");
    }

    /// @dev the indexer reads the referrer from the last 28 bytes of the order calldata
    function testReferralTagIsRecoverable() public pure {
        bytes memory call = abi.encodeCall(CentralPredictionEngine.buyShares, (MID, 1, 100e6, 0));
        bytes memory tagged = abi.encodePacked(call, REF_MAGIC, REFERRER);

        assertEq(tagged.length, call.length + 28);
        address recovered;
        bytes8 magic;
        assembly {
            let end := add(add(tagged, 0x20), mload(tagged))
            recovered := shr(96, mload(sub(end, 20)))
            magic := mload(sub(sub(end, 20), 8))
        }
        assertEq(recovered, REFERRER);
        assertEq(magic, REF_MAGIC);
    }
}
