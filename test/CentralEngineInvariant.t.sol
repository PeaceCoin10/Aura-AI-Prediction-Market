// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {ProtocolFeeVault} from "../src/ProtocolFeeVault.sol";
import {CentralPredictionEngine} from "../src/CentralPredictionEngine.sol";

/**
 * @notice 不变式测试：随机买卖 / 结算 / 赎回 / 扫残余之后，资金必须始终足额
 *
 *  A1  cash >= owed               已承诺未领取的赔付永远有现金兜底
 *  A2  cash >= max(供应)          结算前任何时刻都偿付得起单边全赢
 *  A3  引擎 USDC 余额 == Σ cash    没有资金被偷偷挪出账本
 */
contract CentralEngineHandler is Test {
    CentralPredictionEngine public engine;
    MockUSDC public usdc;
    address public admin;
    address public oracle;
    address public treasury;

    bytes32[] public ids;
    address[] public actors;

    constructor(
        CentralPredictionEngine engine_,
        MockUSDC usdc_,
        address admin_,
        address oracle_,
        address treasury_,
        bytes32[] memory ids_,
        address[] memory actors_
    ) {
        engine = engine_;
        usdc = usdc_;
        admin = admin_;
        oracle = oracle_;
        treasury = treasury_;
        ids = ids_;
        actors = actors_;
    }

    function _id(uint256 seed) internal view returns (bytes32) {
        return ids[seed % ids.length];
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function buy(uint256 idSeed, uint256 actorSeed, uint8 outcome, uint256 amount) external {
        bytes32 id = _id(idSeed);
        address who = _actor(actorSeed);
        if (engine.marketCore(id).resolved) return;
        uint256 depth = engine.depth(id);
        if (depth == 0) return;
        uint256 cap = (depth * engine.MAX_IMPACT_BPS_CAP()) / engine.BPS_DENOMINATOR();
        amount = bound(amount, engine.MIN_BET(), cap);
        usdc.mint(who, amount);
        vm.startPrank(who);
        usdc.approve(address(engine), amount);
        try engine.buyShares(id, outcome % 2, amount, 0) {} catch {}
        vm.stopPrank();
    }

    function sell(uint256 idSeed, uint256 actorSeed, uint8 outcome, uint256 shares) external {
        bytes32 id = _id(idSeed);
        address who = _actor(actorSeed);
        if (engine.marketCore(id).resolved) return;
        uint256 held = outcome % 2 == 1 ? engine.yesOf(id, who) : engine.noOf(id, who);
        if (held == 0) return;
        uint256 cap = (engine.depth(id) * engine.MAX_IMPACT_BPS_CAP()) / engine.BPS_DENOMINATOR();
        shares = bound(shares, 1, held);
        if (shares > cap) shares = cap;
        vm.prank(who);
        try engine.sellShares(id, outcome % 2, shares, 0) {} catch {}
    }

    function resolve(uint256 idSeed, uint8 outcome) external {
        bytes32 id = _id(idSeed);
        if (engine.marketCore(id).resolved) return;
        if (block.timestamp < engine.marketCore(id).resolutionTime) {
            vm.warp(engine.marketCore(id).resolutionTime + 1);
        }
        vm.prank(oracle);
        try engine.resolveMarket(id, outcome % 3) {} catch {}
    }

    function redeem(uint256 idSeed, uint256 actorSeed) external {
        bytes32 id = _id(idSeed);
        address who = _actor(actorSeed);
        if (!engine.isFinal(id)) {
            (, , , , uint256 endsAt, ) = engine.resolutionState(id);
            if (endsAt > block.timestamp) vm.warp(endsAt); // 跨过争议缓冲期
        }
        vm.prank(who);
        try engine.redeem(id) {} catch {}
    }

    /// @dev 争议期内 admin 改判（覆盖 owed 重算路径）
    function overrideOutcome(uint256 idSeed, uint8 outcome) external {
        bytes32 id = _id(idSeed);
        if (!engine.marketCore(id).resolved) return;
        vm.prank(admin);
        try engine.overrideResolution(id, outcome % 3) {} catch {}
    }

    /// @dev 争议期结束后显式终结
    function finalizeMarket(uint256 idSeed) external {
        bytes32 id = _id(idSeed);
        (, , , , uint256 endsAt, ) = engine.resolutionState(id);
        if (endsAt > block.timestamp) vm.warp(endsAt);
        try engine.finalize(id) {} catch {}
    }

    function sweep(uint256 idSeed) external {
        bytes32 id = _id(idSeed);
        vm.prank(admin);
        try engine.sweepResidual(id) {} catch {}
    }

    function warp(uint256 seconds_) external {
        vm.warp(block.timestamp + bound(seconds_, 1 hours, 30 days));
    }
}

contract CentralEngineInvariantTest is Test {
    MockUSDC internal usdc;
    ProtocolFeeVault internal feeVault;
    CentralPredictionEngine internal engine;
    CentralEngineHandler internal handler;

    address internal constant ADMIN = address(0xA11CE);
    address internal constant TREASURY = address(0xBEEF);
    address internal constant ORACLE = address(0x0AC1E);
    address internal constant BOT = address(0xB07);

    bytes32[] internal ids;

    function setUp() public {
        usdc = new MockUSDC();
        feeVault = new ProtocolFeeVault(address(usdc), TREASURY, address(this));
        engine = new CentralPredictionEngine(address(usdc), address(feeVault), TREASURY, ADMIN);

        vm.startPrank(ADMIN);
        engine.setCreator(BOT, true);
        engine.setOracle(ORACLE, true);
        vm.stopPrank();

        address[] memory actors = new address[](3);
        actors[0] = address(0xA1);
        actors[1] = address(0xB1);
        actors[2] = address(0xC1);

        for (uint256 i = 0; i < 3; i++) {
            bytes32 id = keccak256(abi.encode("invariant-market", i));
            ids.push(id);
            vm.prank(BOT);
            engine.createMarketWithMeta(
                id, "invariant market with random flow", "test", block.timestamp + 2 days + i * 1 hours
            );
            usdc.mint(BOT, 20_000e6);
            vm.startPrank(BOT);
            usdc.approve(address(engine), 20_000e6);
            engine.seedLiquidity(id, 20_000e6);
            vm.stopPrank();

            for (uint256 k = 0; k < 3; k++) {
                usdc.mint(actors[k], 100_000e6);
                vm.prank(actors[k]);
                usdc.approve(address(engine), type(uint256).max);
            }
        }

        handler = new CentralEngineHandler(
            engine,
            usdc,
            ADMIN,
            ORACLE,
            TREASURY,
            ids,
            actors
        );

        targetContract(address(handler));
    }

    /// @notice A1：现金永远覆盖已承诺未领取的赔付
    function invariant_CashCoversOwed() public view {
        for (uint256 i = 0; i < ids.length; i++) {
            CentralPredictionEngine.Core memory c = engine.marketCore(ids[i]);
            assertGe(c.cash, c.owed, "A1 violated: cash < owed");
        }
    }

    /// @notice A2：结算前现金覆盖任一边的全部份额（单边全赢也赔得出）
    function invariant_CashCoversBothSides() public view {
        for (uint256 i = 0; i < ids.length; i++) {
            CentralPredictionEngine.Core memory c = engine.marketCore(ids[i]);
            if (c.resolved) continue;
            assertGe(c.cash, engine.yesSupply(ids[i]), "A2 violated: cash < YES supply");
            assertGe(c.cash, engine.noSupply(ids[i]), "A2 violated: cash < NO supply");
        }
    }

    /// @notice A3：引擎实际 USDC 余额 == 所有盘口 cash 之和（费用即时划走，不留暗账）
    function invariant_NoHiddenCash() public view {
        uint256 sum;
        for (uint256 i = 0; i < ids.length; i++) {
            sum += engine.marketCore(ids[i]).cash;
        }
        assertEq(usdc.balanceOf(address(engine)), sum, "A3 violated: hidden cash");
    }

    /// @notice A5：争议期内（未终结）sweepable 必须为 0，且 owed 永远 <= cash
    function invariant_DisputeWindowProtectsOwed() public view {
        for (uint256 i = 0; i < ids.length; i++) {
            (bool resolved, bool finalized, bool disputing,,, uint256 owed) = engine.resolutionState(ids[i]);
            if (resolved) {
                assertGe(engine.marketCore(ids[i]).cash, owed, "A5 violated: owed > cash after override");
            }
            if (disputing) {
                assertFalse(finalized, "disputing must not be final");
                assertEq(engine.sweepable(ids[i]), 0, "A5 violated: swept while disputing");
            }
        }
    }

    /// @notice 池内库存与总供应必须自洽（供应 = 池内 + 用户）
    function invariant_SupplyMatchesInventory() public view {
        for (uint256 i = 0; i < ids.length; i++) {
            CentralPredictionEngine.Core memory c = engine.marketCore(ids[i]);
            if (c.resolved) continue;
            assertGe(engine.yesSupply(ids[i]), c.yesReserve, "YES supply < pool inventory");
            assertGe(engine.noSupply(ids[i]), c.noReserve, "NO supply < pool inventory");
        }
    }
}
