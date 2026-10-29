// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {ProtocolFeeVault} from "../src/ProtocolFeeVault.sol";
import {CentralPredictionEngine} from "../src/CentralPredictionEngine.sol";

/**
 * @notice Single-contract multi-market engine: behaviour, fund safety and the full Hermes flow
 */
contract CentralEngineTest is Test {
    MockUSDC internal usdc;
    ProtocolFeeVault internal feeVault;
    CentralPredictionEngine internal engine;

    address internal constant ADMIN = address(0xA11CE);
    address internal constant TREASURY = address(0xBEEF);
    address internal constant BOT = address(0xB07); // Hermes market creator
    address internal constant ORACLE = address(0x0AC1E); // Hermes oracle
    address internal constant ALICE = address(0xA1);
    address internal constant BOB = address(0xB1);
    address internal constant CAROL = address(0xC1);

    bytes32 internal constant MID = keccak256("BTC-24H-ABOVE-100K");
    uint256 internal resolutionTime;

    string internal constant QUESTION = "Will BTC break 100,000 USDC within 24 hours?";

    function setUp() public {
        usdc = new MockUSDC();
        feeVault = new ProtocolFeeVault(address(usdc), TREASURY, address(this));
        engine = new CentralPredictionEngine(address(usdc), address(feeVault), TREASURY, ADMIN);

        vm.startPrank(ADMIN);
        engine.setCreator(BOT, true);
        engine.setOracle(ORACLE, true);
        vm.stopPrank();

        resolutionTime = block.timestamp + 7 days;
        vm.prank(BOT);
        engine.createMarket(MID, QUESTION, resolutionTime);
        _seed(BOT, MID, 10_000e6);
    }

    /* -------------------------------- helpers -------------------------------- */

    function _createMarket(bytes32 id, string memory q, uint256 rt) internal {
        vm.prank(BOT);
        engine.createMarket(id, q, rt);
    }

    function _seed(address who, bytes32 id, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.startPrank(who);
        usdc.approve(address(engine), amount);
        engine.seedLiquidity(id, amount);
        vm.stopPrank();
    }

    function _buy(address who, bytes32 id, uint8 outcome, uint256 amount) internal returns (uint256 out) {
        usdc.mint(who, amount);
        vm.startPrank(who);
        usdc.approve(address(engine), amount);
        out = engine.buyShares(id, outcome, amount, 0);
        vm.stopPrank();
    }


    /// @dev Skip the 1 hour dispute buffer (simulates "the Safe did not intervene")
    function _passDispute(bytes32 id) internal {
        (, , , , uint256 ends, ) = engine.resolutionState(id);
        if (block.timestamp < ends) vm.warp(ends);
    }

    /// @dev Settlement + skip the dispute window
    function _resolveAndFinalize(bytes32 id, uint8 outcome) internal {
        vm.prank(ORACLE);
        engine.resolveMarket(id, outcome);
        _passDispute(id);
    }

    function _m(bytes32 id) internal view returns (CentralPredictionEngine.Core memory) {
        return engine.marketCore(id);
    }

    function _sumUsers(bytes32 id, bool yes) internal view returns (uint256 sum) {
        address[3] memory users = [ALICE, BOB, CAROL];
        for (uint256 i = 0; i < 3; i++) {
            sum += yes ? engine.yesOf(id, users[i]) : engine.noOf(id, users[i]);
        }
    }

    /// @notice A1/A2 invariants: cash covers owed and either side's full win; supply = pool + users
    function _assertSolvent(bytes32 id) internal view {
        CentralPredictionEngine.Core memory m = _m(id);
        assertGe(m.cash, m.owed, "A1: cash must cover owed");
        if (!m.resolved) {
            assertGe(m.cash, engine.yesSupply(id), "A2: cash >= YES supply");
            assertGe(m.cash, engine.noSupply(id), "A2: cash >= NO supply");
            assertEq(engine.yesSupply(id), m.yesReserve + _sumUsers(id, true), "YES supply == pool + users");
            assertEq(engine.noSupply(id), m.noReserve + _sumUsers(id, false), "NO supply == pool + users");
        }
    }

    /// @notice Contract USDC balance must equal the sum of every market's cash (fees leave immediately)
    function _assertCashReconciles(bytes32 idA, bytes32 idB) internal view {
        assertEq(usdc.balanceOf(address(engine)), _m(idA).cash + _m(idB).cash, "USDC balance == sum(cash)");
    }

    /* ------------------------------- Create ------------------------------- */

    function test_CreateMarket_ByAuthorizedBot() public {
        bytes32 id = keccak256("ETH-ABOVE-4K");
        uint256 rt = block.timestamp + 2 days;
        string memory q = "Will ETH break 4,000 USDC within a week?";

        vm.expectEmit(true, true, false, true, address(engine));
        emit CentralPredictionEngine.MarketCreated(id, BOT, q, "general", rt);

        vm.prank(BOT);
        engine.createMarket(id, q, rt);

        assertEq(engine.marketCount(), 2);
        assertEq(engine.marketIds(1), id);

        CentralPredictionEngine.Core memory m = _m(id);
        assertEq(engine.marketQuestion(id), q);
        assertEq(engine.marketCategory(id), "general");
        assertEq(m.resolutionTime, rt);
        assertEq(m.createdAt, block.timestamp);
        assertEq(m.creator, BOT);
        assertTrue(m.exists);
        assertFalse(m.resolved);
    }

    function test_Revert_CreateMarket_NotAuthorized() public {
        vm.prank(ALICE);
        vm.expectRevert(CentralPredictionEngine.OnlyCreator.selector);
        engine.createMarket(keccak256("x"), "unauthorized create attempt", block.timestamp + 2 days);

        // the admin always holds creation rights
        vm.prank(ADMIN);
        engine.createMarket(keccak256("admin-market"), "admin can create too, roles stack", block.timestamp + 2 days);
        assertEq(engine.marketCount(), 2);
    }

    function test_Revert_CreateMarket_Duplicate() public {
        vm.prank(BOT);
        vm.expectRevert(CentralPredictionEngine.MarketExists.selector);
        engine.createMarket(MID, QUESTION, block.timestamp + 3 days);
    }

    function test_Revert_CreateMarket_BadQuestion() public {
        vm.startPrank(BOT);
        vm.expectRevert(CentralPredictionEngine.InvalidQuestion.selector);
        engine.createMarket(keccak256("short"), "1char", block.timestamp + 2 days);

        bytes memory huge = new bytes(281);
        for (uint256 i = 0; i < 281; i++) {
            huge[i] = "a";
        }
        vm.expectRevert(CentralPredictionEngine.InvalidQuestion.selector);
        engine.createMarket(keccak256("long"), string(huge), block.timestamp + 2 days);
        vm.stopPrank();
    }

    function test_Revert_CreateMarket_BadResolutionTime() public {
        vm.startPrank(BOT);
        vm.expectRevert(CentralPredictionEngine.InvalidResolutionTime.selector);
        engine.createMarket(
            keccak256("too-soon"), "resolving in 30 minutes is a refund-arb trap", block.timestamp + 30 minutes
        );

        vm.expectRevert(CentralPredictionEngine.InvalidResolutionTime.selector);
        engine.createMarket(keccak256("too-far"), "more than one year out is rejected", block.timestamp + 366 days);
        vm.stopPrank();
    }

    function test_CreateMarketWithMeta_SetsCategory() public {
        bytes32 id = keccak256("LOL-WORLDS");
        vm.prank(BOT);
        engine.createMarketWithMeta(id, "Can T1 win Worlds this year?", "esports", block.timestamp + 30 days);
        assertEq(engine.marketCategory(id), "esports");
    }

    function test_SetCategory_ByCreatorAndOracle_BlockedAfterResolve() public {
        vm.prank(BOT);
        engine.setCategory(MID, "crypto");
        assertEq(engine.marketCategory(MID), "crypto");

        vm.prank(ORACLE);
        engine.setCategory(MID, "macro");
        assertEq(engine.marketCategory(MID), "macro");

        vm.prank(ALICE);
        vm.expectRevert(CentralPredictionEngine.OnlyCreator.selector);
        engine.setCategory(MID, "hack");

        vm.warp(resolutionTime);
        vm.prank(ORACLE);
        engine.resolveMarket(MID, 1);

        vm.prank(BOT);
        vm.expectRevert(CentralPredictionEngine.MarketResolvedAlready.selector);
        engine.setCategory(MID, "late");
    }

    /* ---------------------------- Market making --------------------------- */

    function test_SeedLiquidity_MintsPairedInventory() public {
        bytes32 id = keccak256("SEED-TEST");
        _createMarket(id, "seeding 500 USDC must mint 500 pairs", block.timestamp + 5 days);

        usdc.mint(BOT, 500e6);
        vm.startPrank(BOT);
        usdc.approve(address(engine), 500e6);
        vm.expectEmit(true, true, false, true, address(engine));
        emit CentralPredictionEngine.LiquiditySeeded(id, BOT, 500e6);
        engine.seedLiquidity(id, 500e6);
        vm.stopPrank();

        CentralPredictionEngine.Core memory m = _m(id);
        assertEq(m.yesReserve, 500e6);
        assertEq(m.noReserve, 500e6);
        assertEq(m.cash, 500e6);
        assertEq(engine.yesSupply(id), 500e6);
        assertEq(engine.noSupply(id), 500e6);
        assertEq(engine.priceYes(id), 0.5e18);
        _assertSolvent(id);
    }

    function test_Revert_SeedLiquidity_Guards() public {
        bytes32 id = keccak256("SEED-GUARD");
        _createMarket(id, "seed guards: roles, floor, deadline", block.timestamp + 5 days);

        vm.prank(ALICE);
        vm.expectRevert(CentralPredictionEngine.OnlyCreator.selector);
        engine.seedLiquidity(id, 500e6);

        usdc.mint(BOT, 20e6);
        vm.startPrank(BOT);
        usdc.approve(address(engine), 20e6);
        vm.expectRevert(CentralPredictionEngine.BelowMinSeed.selector);
        engine.seedLiquidity(id, 9e6);
        vm.stopPrank();

        vm.warp(resolutionTime + 1);
        vm.prank(BOT);
        vm.expectRevert(CentralPredictionEngine.TradingClosed.selector);
        engine.seedLiquidity(MID, 100e6);
    }

    /* -------------------------------- Buy --------------------------------- */

    function test_BuyShares_Yes_ChargesFeeAndMovesPrice() public {
        uint256 out = _buy(ALICE, MID, 1, 100e6);

        // the 1.5% fee reaches the FeeVault immediately
        assertEq(usdc.balanceOf(address(feeVault)), 1_500_000);
        assertEq(feeVault.pendingFees(), 1_500_000);

        CentralPredictionEngine.Core memory m = _m(MID);
        assertEq(m.cash, 10_000e6 + 98_500_000);
        assertEq(m.noReserve, 10_000e6 + 98_500_000, "net NO inventory moves into the pool");
        assertEq(engine.yesOf(MID, ALICE), out);
        assertGt(engine.priceYes(MID), 0.5e18, "buying YES pushes YES price up");
        // at 50% odds 1 USDC must buy close to 2 shares (a win pays ~2x)
        assertGt(out, 180e6, "shares must be ~2x the stake at 50%");
        assertLt(out, 200e6, "no free lunch: impact keeps it under 2x");
        _assertSolvent(MID);
    }

    function test_BuyShares_No_IsSymmetric() public {
        uint256 expected = engine.previewBuy(MID, 0, 100e6);
        uint256 out = _buy(BOB, MID, 0, 100e6);
        assertEq(engine.noOf(MID, BOB), out);
        assertLt(engine.priceYes(MID), 0.5e18, "buying NO pushes YES price down");
        assertEq(out, expected, "preview must match");
        _assertSolvent(MID);
    }

    function test_PreviewBuy_MatchesActualExactly() public {
        uint256 expYes = engine.previewBuy(MID, 1, 250e6);
        assertEq(_buy(ALICE, MID, 1, 250e6), expYes);
        uint256 expNo = engine.previewBuy(MID, 0, 250e6);
        assertEq(_buy(BOB, MID, 0, 250e6), expNo);
    }

    function test_Revert_Buy_BetBounds() public {
        usdc.mint(ALICE, 20_000e6);
        vm.startPrank(ALICE);
        usdc.approve(address(engine), type(uint256).max);

        vm.expectRevert(CentralPredictionEngine.BelowMinBet.selector);
        engine.buyShares(MID, 1, 4_999_999, 0);

        vm.expectRevert(CentralPredictionEngine.AboveMaxBet.selector);
        engine.buyShares(MID, 1, 10_000e6 + 1, 0);
        vm.stopPrank();
    }

    function test_Revert_Buy_SlippageExceeded() public {
        usdc.mint(ALICE, 100e6);
        vm.startPrank(ALICE);
        usdc.approve(address(engine), 100e6);
        uint256 fair = engine.previewBuy(MID, 1, 100e6);
        vm.expectRevert(CentralPredictionEngine.SlippageExceeded.selector);
        engine.buyShares(MID, 1, 100e6, fair + 1);
        vm.stopPrank();
    }

    function test_Revert_Buy_ImpactTooHigh() public {
        // pool depth 20,000 USDC -> 5% = 1,000 USDC; 1,001 USDC must be rejected
        usdc.mint(ALICE, 1_001e6);
        vm.startPrank(ALICE);
        usdc.approve(address(engine), 1_001e6);
        vm.expectRevert(CentralPredictionEngine.ImpactTooHigh.selector);
        engine.buyShares(MID, 1, 1_001e6, 0);
        vm.stopPrank();

        _buy(BOB, MID, 1, 1_000e6); // exactly at the cap is allowed
    }

    function test_Revert_Buy_ClosedAndInvalid() public {
        vm.prank(ALICE);
        vm.expectRevert(CentralPredictionEngine.InvalidOutcome.selector);
        engine.buyShares(MID, 2, 100e6, 0);

        vm.warp(resolutionTime);
        usdc.mint(ALICE, 100e6);
        vm.startPrank(ALICE);
        usdc.approve(address(engine), 100e6);
        vm.expectRevert(CentralPredictionEngine.TradingClosed.selector);
        engine.buyShares(MID, 1, 100e6, 0);
        vm.stopPrank();
    }

    function test_Revert_Buy_Paused() public {
        vm.prank(ADMIN);
        engine.pause();

        usdc.mint(ALICE, 100e6);
        vm.startPrank(ALICE);
        usdc.approve(address(engine), 100e6);
        vm.expectRevert(CentralPredictionEngine.EnforcedPause.selector);
        engine.buyShares(MID, 1, 100e6, 0);
        vm.stopPrank();

        vm.prank(ADMIN);
        engine.unpause();
        _buy(ALICE, MID, 1, 100e6);
    }

    function test_Revert_Buy_UnknownMarket() public {
        usdc.mint(ALICE, 100e6);
        vm.startPrank(ALICE);
        usdc.approve(address(engine), 100e6);
        vm.expectRevert(CentralPredictionEngine.MarketNotFound.selector);
        engine.buyShares(keccak256("nope"), 1, 100e6, 0);
        vm.stopPrank();
    }

    /* -------------------------------- Sell -------------------------------- */

    function test_SellShares_ReturnsCashMinusFee() public {
        uint256 out = _buy(ALICE, MID, 1, 200e6);
        uint256 feeBefore = usdc.balanceOf(address(feeVault));

        uint256 expected = engine.previewSell(MID, 1, out / 2);
        vm.prank(ALICE);
        uint256 got = engine.sellShares(MID, 1, out / 2, 0);

        assertEq(got, expected, "previewSell must match");
        assertEq(engine.yesOf(MID, ALICE), out - out / 2);
        assertGt(usdc.balanceOf(address(feeVault)), feeBefore, "sell leg also pays 1.5%");
        _assertSolvent(MID);
    }

    function test_SellRoundTrip_NeverProfits() public {
        uint256 stake = 300e6;
        uint256 out = _buy(ALICE, MID, 1, stake);

        vm.prank(ALICE);
        uint256 back = engine.sellShares(MID, 1, out, 0);

        assertLt(back, stake - 2_900_000, "round trip must lose both 1.5% fees plus impact");
        assertGt(back, 0, "but the exit must not be zero");
        _assertSolvent(MID);
    }

    function test_Revert_Sell_NotEnoughSharesOrSlippage() public {
        uint256 out = _buy(ALICE, MID, 1, 100e6);

        vm.startPrank(ALICE);
        vm.expectRevert(CentralPredictionEngine.InsufficientLiquidity.selector);
        engine.sellShares(MID, 1, out + 1, 0);

        uint256 fair = engine.previewSell(MID, 1, out);
        vm.expectRevert(CentralPredictionEngine.SlippageExceeded.selector);
        engine.sellShares(MID, 1, out, fair + 1);
        vm.stopPrank();
    }

    /* ----------------------------- Settlement ----------------------------- */

    function test_Resolve_OnlyOracleAndOnlyAfterTime() public {
        // a non-oracle caller fails the modifier before any timestamp check
        vm.prank(ALICE);
        vm.expectRevert(CentralPredictionEngine.OnlyOracle.selector);
        engine.resolveMarket(MID, 1);

        // the oracle calls before the resolution time
        vm.prank(ORACLE);
        vm.expectRevert(CentralPredictionEngine.TooEarlyToResolve.selector);
        engine.resolveMarket(MID, 1);

        vm.warp(resolutionTime);
        vm.prank(BOT);
        vm.expectRevert(CentralPredictionEngine.OnlyOracle.selector);
        engine.resolveMarket(MID, 1);

        vm.prank(ORACLE);
        engine.resolveMarket(MID, 1);
        _passDispute(MID);

        vm.prank(ORACLE);
        vm.expectRevert(CentralPredictionEngine.MarketResolvedAlready.selector);
        engine.resolveMarket(MID, 0);
        _passDispute(MID);
    }

    function test_Revert_Resolve_InvalidOutcome() public {
        vm.warp(resolutionTime);
        vm.prank(ORACLE);
        vm.expectRevert(CentralPredictionEngine.InvalidOutcome.selector);
        engine.resolveMarket(MID, 3);
        _passDispute(MID);
    }

    function test_Resolve_LocksOwedAndVoidsPoolInventory() public {
        uint256 aliceYes = _buy(ALICE, MID, 1, 100e6);
        _buy(BOB, MID, 0, 300e6);

        vm.warp(resolutionTime);
        vm.prank(ORACLE);
        engine.resolveMarket(MID, 1);
        _passDispute(MID);

        CentralPredictionEngine.Core memory m = _m(MID);
        assertTrue(m.resolved);
        assertEq(m.yesReserve, 0, "pool inventory is voided at settlement");
        assertEq(m.noReserve, 0);
        assertEq(m.owed, aliceYes, "owed == winning user shares");
        assertEq(m.cash, 10_000e6 + 98_500_000 + 295_500_000);
        assertGt(m.cash, m.owed, "losing collateral stays as residual");
        _assertSolvent(MID);
    }

    /* ------------------------------- Redeem ------------------------------- */

    function test_Redeem_WinnerGetsPayoutLoserGetsNothing() public {
        uint256 aliceYes = _buy(ALICE, MID, 1, 100e6);
        _buy(BOB, MID, 0, 100e6);

        vm.warp(resolutionTime);
        vm.prank(ORACLE);
        engine.resolveMarket(MID, 1);
        _passDispute(MID);

        uint256 expectedFee = (aliceYes * 50 + 9_999) / 10_000; // bpsUp 0.5%
        uint256 balBefore = usdc.balanceOf(ALICE);
        vm.prank(ALICE);
        (uint256 payout, uint256 fee) = engine.redeem(MID);
        assertEq(fee, expectedFee, "0.5% settle fee");
        assertEq(payout, aliceYes - expectedFee);
        assertEq(usdc.balanceOf(ALICE) - balBefore, payout);
        assertEq(engine.yesOf(MID, ALICE), 0);

        // at 50% odds a winner must receive well above principal (~1.87x)
        assertGt(payout, 100e6, "winning at 50% must pay more than the stake");
        assertApproxEqRel(payout, 195e6, 0.02e18, "50% odds must pay ~1.95x after fees");

        vm.prank(BOB);
        vm.expectRevert(CentralPredictionEngine.NothingToRedeem.selector);
        engine.redeem(MID);
        _assertSolvent(MID);
    }

    function test_Redeem_InvalidPaysHalfEachWithoutFee() public {
        uint256 aliceYes = _buy(ALICE, MID, 1, 100e6);
        uint256 bobNo = _buy(BOB, MID, 0, 100e6);

        vm.warp(resolutionTime);
        vm.prank(ORACLE);
        engine.resolveMarket(MID, 2);
        _passDispute(MID);

        vm.prank(ALICE);
        (uint256 payoutA, uint256 feeA) = engine.redeem(MID);
        assertEq(feeA, 0);
        assertEq(payoutA, aliceYes / 2);

        vm.prank(BOB);
        (uint256 payoutB,) = engine.redeem(MID);
        assertEq(payoutB, bobNo / 2);
        _assertSolvent(MID);
    }

    function test_Revert_Redeem_NotResolvedOrNothing() public {
        vm.prank(ALICE);
        vm.expectRevert(CentralPredictionEngine.NotResolved.selector);
        engine.redeem(MID);

        vm.warp(resolutionTime);
        vm.prank(ORACLE);
        engine.resolveMarket(MID, 1);
        _passDispute(MID);

        vm.prank(CAROL);
        vm.expectRevert(CentralPredictionEngine.NothingToRedeem.selector);
        engine.redeem(MID);
    }

    /* --------------------------- Timeout fallback ------------------------- */

    function test_EmergencyRefund_AnyoneAfterWindow() public {
        _buy(ALICE, MID, 1, 100e6);

        vm.prank(CAROL);
        vm.expectRevert(CentralPredictionEngine.RefundWindowNotReached.selector);
        engine.emergencyRefund(MID);

        vm.warp(resolutionTime + 7 days);
        vm.prank(CAROL); // any passer-by may trigger it
        engine.emergencyRefund(MID);

        CentralPredictionEngine.Core memory m = _m(MID);
        assertTrue(m.resolved);
        assertEq(m.outcome, 2);

        vm.prank(ALICE);
        (uint256 payout,) = engine.redeem(MID);
        assertGt(payout, 0);
        _assertSolvent(MID);
    }

    function test_Pause_CannotLockRedemptionPastRefundWindow() public {
        _buy(ALICE, MID, 1, 100e6);
        vm.warp(resolutionTime);
        vm.prank(ORACLE);
        engine.resolveMarket(MID, 1);
        _passDispute(MID);

        vm.prank(ADMIN);
        engine.pause();

        // inside the window: the pause really does block redemption
        vm.prank(ALICE);
        vm.expectRevert(CentralPredictionEngine.EnforcedPause.selector);
        engine.redeem(MID);

        // resolution + 7 days: the pause is overridden and redemption goes through
        vm.warp(resolutionTime + 7 days);
        vm.prank(ALICE);
        (uint256 payout,) = engine.redeem(MID);
        assertGt(payout, 0, "pause must never freeze principal forever");
        _assertSolvent(MID);
    }

    /* ----------------------------- Leftover sweep ------------------------- */

    function test_SweepResidual_OnlyOverflowAboveOwed() public {
        uint256 aliceYes = _buy(ALICE, MID, 1, 100e6);
        _buy(BOB, MID, 0, 400e6);

        vm.prank(ADMIN);
        vm.expectRevert(CentralPredictionEngine.NotResolved.selector);
        engine.sweepResidual(MID);

        vm.warp(resolutionTime);
        vm.prank(ORACLE);
        engine.resolveMarket(MID, 1);

        uint256 owedBefore = _m(MID).owed;
        assertEq(owedBefore, aliceYes);

        // no sweeping during the dispute window: the Safe may still re-rule owed
        assertEq(engine.sweepable(MID), 0, "nothing sweepable while disputing");
        vm.prank(ADMIN);
        vm.expectRevert(CentralPredictionEngine.DisputeWindowOpen.selector);
        engine.sweepResidual(MID);

        _passDispute(MID);

        uint256 sweepable = engine.sweepable(MID);
        assertEq(sweepable, _m(MID).cash - owedBefore);

        uint256 balBefore = usdc.balanceOf(TREASURY);
        vm.prank(ALICE);
        vm.expectRevert(CentralPredictionEngine.OnlyAdmin.selector);
        engine.sweepResidual(MID);

        vm.prank(ADMIN);
        uint256 swept = engine.sweepResidual(MID);
        assertEq(swept, sweepable);
        assertEq(usdc.balanceOf(TREASURY) - balBefore, swept);

        // owed is untouched, so winners still redeem in full
        assertEq(_m(MID).owed, owedBefore);
        _assertSolvent(MID);

        vm.prank(ALICE);
        (uint256 payout, uint256 fee) = engine.redeem(MID);
        assertEq(payout + fee, owedBefore, "winner still gets the full committed amount");
        assertGt(payout, 100e6);

        vm.prank(ADMIN);
        vm.expectRevert(CentralPredictionEngine.NothingToSweep.selector);
        engine.sweepResidual(MID);
    }

    /* --------------------------- Market isolation ------------------------- */

    function test_MultiMarket_IndependentPoolsAndFees() public {
        bytes32 id2 = keccak256("ETH-ABOVE-4K");
        _createMarket(id2, "ETH above 4,000 USDC within a week?", block.timestamp + 3 days);
        _seed(BOT, id2, 500e6);

        _buy(ALICE, MID, 1, 200e6);
        _buy(BOB, id2, 0, 50e6);

        assertEq(_m(MID).cash, 10_000e6 + 197e6);
        assertEq(_m(id2).cash, 500e6 + 49_250_000);
        _assertCashReconciles(MID, id2);

        uint256 cash2Before = _m(id2).cash;
        vm.warp(resolutionTime);
        vm.prank(ORACLE);
        engine.resolveMarket(MID, 1);
        _passDispute(MID); // settle market A only

        assertFalse(_m(id2).resolved, "B must stay unresolved");
        assertEq(_m(id2).cash, cash2Before, "A's settlement must not touch B's cash");
        _assertSolvent(MID);
        _assertSolvent(id2);
    }

    /* ------------------------ Hermes end-to-end flow ---------------------- */

    function test_Integration_HermesCreateTradeResolveRedeem() public {
        // 1) Hermes (BOT) creates the market and seeds liquidity
        bytes32 hermesId = keccak256("hermes-auto-1");
        vm.prank(BOT);
        engine.createMarketWithMeta(
            hermesId, "Will BTC break 105,000 USDC within 24 hours?", "crypto", block.timestamp + 2 days
        );
        _seed(BOT, hermesId, 20_000e6);

        // 2) retail trades: 500 YES + 300 NO
        uint256 aliceYes = _buy(ALICE, hermesId, 1, 500e6);
        uint256 bobNo = _buy(BOB, hermesId, 0, 300e6);
        assertGt(engine.priceYes(hermesId), 0.5e18);
        _assertSolvent(hermesId);

        // 3) at expiry Hermes, acting as the oracle, rules YES
        vm.warp(block.timestamp + 2 days);
        vm.prank(ORACLE);
        engine.resolveMarket(hermesId, 1);
        _passDispute(hermesId);

        // 4) the winner can withdraw immediately (> principal)
        vm.prank(ALICE);
        (uint256 payout, uint256 fee) = engine.redeem(hermesId);
        assertGt(payout, 500e6);
        assertEq(payout + fee, aliceYes);

        // 5) the loser gets nothing
        vm.prank(BOB);
        vm.expectRevert(CentralPredictionEngine.NothingToRedeem.selector);
        engine.redeem(hermesId);

        // 6) protocol take: 1.5% on both buys + 0.5% on the winning redemption
        assertEq(feeVault.pendingFees(), 12_000_000 + fee, "trade fees + settle fee");

        // 7) the leftover (loser collateral + pool inventory) is swept to treasury without touching owed
        uint256 alb = usdc.balanceOf(TREASURY);
        vm.prank(ADMIN);
        uint256 swept = engine.sweepResidual(hermesId);
        assertGt(swept, 0);
        assertEq(usdc.balanceOf(TREASURY) - alb, swept);

        _assertSolvent(hermesId);
        assertEq(engine.yesOf(hermesId, ALICE), 0);
        assertEq(engine.noOf(hermesId, BOB), bobNo, "loser keeps worthless shares");
        assertEq(_m(hermesId).cash, _m(hermesId).owed, "nothing left unaccounted");
    }

    /* -------------------------- Invariant stress -------------------------- */

    function test_Invariants_HoldAcrossInterleavedTrades() public {
        bytes32 id2 = keccak256("FUZZ-MARKET");
        _createMarket(id2, "random interleaved trading keeps the vault solvent", block.timestamp + 5 days);
        _seed(BOT, id2, 20_000e6);

        address[3] memory users = [ALICE, BOB, CAROL];
        for (uint256 i = 0; i < 3; i++) {
            usdc.mint(users[i], 50_000e6);
            vm.prank(users[i]);
            usdc.approve(address(engine), type(uint256).max);
        }

        for (uint256 round = 0; round < 25; round++) {
            uint8 who = uint8(uint256(keccak256(abi.encode("who", round))) % 3);
            uint8 outcome = uint8(uint256(keccak256(abi.encode("out", round))) % 2);
            uint256 amount = 5e6 + (uint256(keccak256(abi.encode("amt", round))) % 60e6);

            vm.prank(users[who]);
            engine.buyShares(id2, outcome, amount, 0);

            _assertSolvent(id2);
            _assertCashReconciles(id2, MID);
        }

        for (uint256 i = 0; i < 3; i++) {
            uint256 yesBal = engine.yesOf(id2, users[i]);
            uint256 chunk = yesBal / 2 > 500e6 ? 500e6 : yesBal / 2; // stay under the 5% impact cap
            if (chunk > 1e6) {
                vm.prank(users[i]);
                engine.sellShares(id2, 1, chunk, 0);
                _assertSolvent(id2);
            }
        }

        vm.warp(block.timestamp + 5 days);
        vm.prank(ORACLE);
        engine.resolveMarket(id2, 0);
        _passDispute(id2);
        _assertSolvent(id2);

        for (uint256 i = 0; i < 3; i++) {
            if (engine.noOf(id2, users[i]) > 0) {
                vm.prank(users[i]);
                engine.redeem(id2);
                _assertSolvent(id2);
            }
        }

        // after the sweep the books still reconcile: engine balance == sum of every market's cash
        vm.prank(ADMIN);
        engine.sweepResidual(id2);
        _assertSolvent(id2);
        assertEq(usdc.balanceOf(address(engine)), _m(id2).cash + _m(MID).cash);
    }

    /* ------------------------------- Admin -------------------------------- */

    function test_Admin_RolesAndTwoStepHandover() public {
        vm.prank(ALICE);
        vm.expectRevert(CentralPredictionEngine.OnlyAdmin.selector);
        engine.setCreator(ALICE, true);

        vm.startPrank(ADMIN);
        engine.setCreator(ALICE, true);
        engine.setOracle(CAROL, true);
        engine.setFeeVault(address(0xFEE));
        engine.setTreasury(address(0x777));
        engine.transferAdmin(address(0xAD));
        vm.stopPrank();

        assertTrue(engine.creators(ALICE));
        assertTrue(engine.oracles(CAROL));
        assertEq(engine.feeVault(), address(0xFEE));
        assertEq(engine.treasury(), address(0x777));
        assertEq(engine.pendingAdmin(), address(0xAD));
        assertEq(engine.admin(), ADMIN, "admin unchanged until step 2");

        vm.prank(ALICE);
        vm.expectRevert(CentralPredictionEngine.NotPendingAdmin.selector);
        engine.acceptAdmin();

        vm.prank(address(0xAD));
        engine.acceptAdmin();
        assertEq(engine.admin(), address(0xAD));
        assertEq(engine.pendingAdmin(), address(0));
    }

    function test_Constructor_RejectsZeroAndEoa() public {
        vm.expectRevert(CentralPredictionEngine.ZeroAddress.selector);
        new CentralPredictionEngine(address(0), address(feeVault), TREASURY, ADMIN);

        vm.expectRevert(CentralPredictionEngine.NotContract.selector);
        new CentralPredictionEngine(address(0xDEAD), address(feeVault), TREASURY, ADMIN);
    }

    /* ---------------------- Dispute buffer (1h) --------------------------- */

    function test_Dispute_ResolveOpensOneHourWindowAndBlocksRedeem() public {
        uint256 aliceYes = _buy(ALICE, MID, 1, 100e6);

        vm.warp(resolutionTime);
        vm.prank(ORACLE);
        engine.resolveMarket(MID, 1);

        (bool resolved, bool finalized, bool disputing, uint8 outcome, uint256 endsAt, uint256 owed) =
            engine.resolutionState(MID);
        assertTrue(resolved, "resolved right away");
        assertFalse(finalized, "not payable yet: dispute window is open");
        assertTrue(disputing);
        assertEq(outcome, 1);
        assertEq(endsAt, block.timestamp + 1 hours, "hardcoded 1h window");
        assertEq(owed, aliceYes);
        assertEq(engine.DISPUTE_WINDOW(), 1 hours);

        vm.prank(ALICE);
        vm.expectRevert(CentralPredictionEngine.DisputeWindowOpen.selector);
        engine.redeem(MID);

        // no leftover sweep during the dispute window either
        vm.prank(ADMIN);
        vm.expectRevert(CentralPredictionEngine.DisputeWindowOpen.selector);
        engine.sweepResidual(MID);

        // the window lapses (no transaction needed) and the result applies
        vm.warp(endsAt);
        assertTrue(engine.isFinal(MID), "finality is timestamp-driven, not tx-driven");

        vm.prank(ALICE);
        (uint256 payout,) = engine.redeem(MID);
        assertGt(payout, 100e6);
        _assertSolvent(MID);
    }

    function test_Dispute_WindowBoundaryIsInclusive() public {
        _buy(ALICE, MID, 1, 50e6);

        vm.warp(resolutionTime);
        vm.prank(ORACLE);
        engine.resolveMarket(MID, 1);

        (, , , , uint256 endsAt, ) = engine.resolutionState(MID);
        vm.warp(endsAt - 1);
        vm.prank(ALICE);
        vm.expectRevert(CentralPredictionEngine.DisputeWindowOpen.selector);
        engine.redeem(MID);

        vm.warp(endsAt); // the exact end timestamp is already allowed
        vm.prank(ALICE);
        (uint256 payout,) = engine.redeem(MID);
        assertGt(payout, 0);
    }

    function test_Dispute_AdminCanFlipOutcomeToTheRealWinner() public {
        uint256 aliceYes = _buy(ALICE, MID, 1, 100e6);
        uint256 bobNo = _buy(BOB, MID, 0, 100e6);

        vm.warp(resolutionTime);
        vm.prank(ORACLE);
        engine.resolveMarket(MID, 1); // the oracle rules YES first

        // the Safe finds contradicting evidence inside the window -> one-click re-rule to NO
        vm.prank(ADMIN);
        engine.overrideResolution(MID, 0);

        (bool resolved, bool finalized, bool disputing, uint8 outcome, uint256 endsAt, uint256 owed) =
            engine.resolutionState(MID);
        assertTrue(resolved);
        assertFalse(finalized);
        assertTrue(disputing);
        assertEq(outcome, 0, "outcome flipped to NO");
        assertEq(owed, bobNo, "owed recomputed against the new winner");
        assertEq(endsAt, resolutionTime + 1 hours, "override must not extend the window");
        assertGe(_m(MID).cash, owed, "A1 still holds after override");

        vm.warp(endsAt);

        // the new winners are paid in full, the old outcome is void
        vm.prank(BOB);
        (uint256 bobPayout,) = engine.redeem(MID);
        assertGt(bobPayout, 100e6, "NO holder now gets paid");

        vm.prank(ALICE);
        vm.expectRevert(CentralPredictionEngine.NothingToRedeem.selector);
        engine.redeem(MID);

        assertEq(engine.noOf(MID, BOB), 0);
        assertEq(engine.yesOf(MID, ALICE), aliceYes, "loser shares are untouched, just worthless");
        _assertSolvent(MID);
    }

    function test_Dispute_OverrideToInvalidSplitsHalfHalf() public {
        uint256 aliceYes = _buy(ALICE, MID, 1, 100e6);
        uint256 bobNo = _buy(BOB, MID, 0, 100e6);

        vm.warp(resolutionTime);
        vm.prank(ORACLE);
        engine.resolveMarket(MID, 1);

        vm.prank(ADMIN);
        engine.overrideResolution(MID, 2);

        (, , , uint8 outcome, , uint256 owed) = engine.resolutionState(MID);
        assertEq(outcome, 2);
        assertEq(owed, (aliceYes + bobNo) / 2, "INVALID owes half of each side");

        _passDispute(MID);
        vm.prank(ALICE);
        (uint256 pA, uint256 feeA) = engine.redeem(MID);
        assertEq(feeA, 0, "no settle fee on INVALID");
        assertEq(pA, aliceYes / 2);

        vm.prank(BOB);
        (uint256 pB,) = engine.redeem(MID);
        assertEq(pB, bobNo / 2);
        _assertSolvent(MID);
    }

    function test_Dispute_OverrideCanBeAppliedMultipleTimesButNeverExtends() public {
        _buy(ALICE, MID, 1, 100e6);

        vm.warp(resolutionTime);
        vm.prank(ORACLE);
        engine.resolveMarket(MID, 1);
        (, , , , uint256 endsAt, ) = engine.resolutionState(MID);

        vm.startPrank(ADMIN);
        engine.overrideResolution(MID, 0);
        engine.overrideResolution(MID, 2);
        engine.overrideResolution(MID, 1);
        vm.stopPrank();

        (, , , uint8 outcome, uint256 endsAtAfter, ) = engine.resolutionState(MID);
        assertEq(outcome, 1);
        assertEq(endsAtAfter, endsAt, "window is absolute, admin cannot keep postponing");
    }

    function test_Revert_Override_WrongCallerOutcomeOrWindow() public {
        _buy(ALICE, MID, 1, 100e6);

        // not ruled yet
        vm.prank(ADMIN);
        vm.expectRevert(CentralPredictionEngine.NotResolved.selector);
        engine.overrideResolution(MID, 1);

        vm.warp(resolutionTime);
        vm.prank(ORACLE);
        engine.resolveMarket(MID, 1);

        // not the admin (including the oracle itself)
        vm.prank(ORACLE);
        vm.expectRevert(CentralPredictionEngine.OnlyAdmin.selector);
        engine.overrideResolution(MID, 0);

        vm.prank(ALICE);
        vm.expectRevert(CentralPredictionEngine.OnlyAdmin.selector);
        engine.overrideResolution(MID, 0);

        // same outcome
        vm.prank(ADMIN);
        vm.expectRevert(CentralPredictionEngine.SameOutcome.selector);
        engine.overrideResolution(MID, 1);

        // illegal outcome value
        vm.prank(ADMIN);
        vm.expectRevert(CentralPredictionEngine.InvalidOutcome.selector);
        engine.overrideResolution(MID, 3);

        // window already passed
        _passDispute(MID);
        vm.prank(ADMIN);
        vm.expectRevert(CentralPredictionEngine.DisputeWindowClosed.selector);
        engine.overrideResolution(MID, 0);
    }

    function test_Finalize_PermissionlessAfterWindowEmitsEvent() public {
        _buy(ALICE, MID, 1, 100e6);

        vm.warp(resolutionTime);
        vm.prank(ORACLE);
        engine.resolveMarket(MID, 1);
        (, , , , uint256 endsAt, uint256 owed) = engine.resolutionState(MID);

        // no finalisation inside the window
        vm.prank(CAROL);
        vm.expectRevert(CentralPredictionEngine.DisputeWindowOpen.selector);
        engine.finalize(MID);

        vm.warp(endsAt);
        vm.expectEmit(true, false, false, true, address(engine));
        emit CentralPredictionEngine.ResolutionFinalized(MID, 1, owed);

        vm.prank(CAROL); // anyone
        engine.finalize(MID);
        assertTrue(engine.isFinal(MID));

        vm.prank(CAROL);
        vm.expectRevert(CentralPredictionEngine.MarketResolvedAlready.selector);
        engine.finalize(MID);
    }

    function test_Dispute_EventCarriesWindowAndOwed() public {
        uint256 aliceYes = _buy(ALICE, MID, 1, 100e6);
        vm.warp(resolutionTime);

        vm.expectEmit(true, false, false, true, address(engine));
        emit CentralPredictionEngine.DisputeWindowOpened(MID, 1, block.timestamp + 1 hours, aliceYes);

        vm.prank(ORACLE);
        engine.resolveMarket(MID, 1);
    }

    function test_EmergencyRefund_IsFinalImmediatelyNoDisputeWait() public {
        _buy(ALICE, MID, 1, 100e6);

        vm.warp(resolutionTime + 7 days);
        vm.prank(CAROL);
        engine.emergencyRefund(MID);

        (bool resolved, bool finalized, bool disputing, uint8 outcome, , ) = engine.resolutionState(MID);
        assertTrue(resolved);
        assertTrue(finalized, "refund fallback must not add another 1h delay");
        assertFalse(disputing);
        assertEq(outcome, 2);

        vm.prank(ALICE);
        (uint256 payout,) = engine.redeem(MID);
        assertGt(payout, 0);
        _assertSolvent(MID);
    }

    function test_Finalize_RejectsUnknownMarket() public {
        vm.expectRevert(CentralPredictionEngine.MarketNotFound.selector);
        engine.finalize(keccak256("nope"));
    }
}
