// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {ProtocolFeeVault} from "../src/ProtocolFeeVault.sol";
import {CentralPredictionEngine} from "../src/CentralPredictionEngine.sol";

/**
 * @notice CentralPredictionEngine 一键部署（单合约多盘口）
 *
 *  本地 anvil：   forge script script/DeployCentral.s.sol:DeployCentral --rpc-url http://127.0.0.1:8545 --broadcast
 *  Base 主网：    forge script script/DeployCentral.s.sol:DeployCentral --rpc-url $BASE_RPC_URL --broadcast --verify ...
 *
 * 环境变量：
 *   PRIVATE_KEY   部署私钥（必需）
 *   TREASURY      手续费收款地址（默认 = 部署者；主网必须是合约，例如 Safe）
 *   ADMIN         引擎 admin（默认 = 部署者；主网必须是合约，例如 Safe）
 *   CREATOR       Hermes 建盘地址（默认 = 部署者；可以是 EOA）
 *   ORACLE        Hermes 裁决地址（默认 = 部署者；可以是 EOA）
 *   COLLATERAL    覆盖抵押品地址（默认按 chainid 选 USDC；本地自动发 MockUSDC）
 *   SEED_DEMO     1 = 顺便建一个 24h 演示盘口（需要部署者本身有建盘权）
 *
 *   REQUIRE_SAFE_CONTRACT  1（默认）= 主网强制多签模式；0 = 单钱包模式
 *
 * 主网（8453）双模式：
 *   REQUIRE_SAFE_CONTRACT=1（默认，生产推荐）
 *     - ADMIN / TREASURY 必须是合约（Safe）
 *     - 部署者不能同时是最终 admin
 *     - CREATOR 与 ORACLE 必须是不同地址（职责分离）
 *   REQUIRE_SAFE_CONTRACT=0（单钱包，一把 EOA 兼任 ADMIN/TREASURY/CREATOR/ORACLE）
 *     - 跳过上述三条合约/分离校验，其余（USDC 6 位小数、地址非零）照旧
 *     - 单点风险：私钥泄露 = 资金全失、admin 特权被夺；脚本会打印显式告警
 * 若 ADMIN 是 Safe，脚本不会（也无法）替你调 setCreator/setOracle —— 会打印出
 * Safe Transaction Builder 需要的 calldata，由多签执行。
 */
contract DeployCentral is Script {
    address constant BASE_MAINNET_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    uint256 constant BASE_MAINNET_CHAIN_ID = 8453;

    struct Cfg {
        address collateral;
        address treasury;
        address admin;
        address creator;
        address oracle;
        bool seedDemo;
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        Cfg memory c = Cfg({
            collateral: vm.envOr("COLLATERAL", _defaultUsdc()),
            treasury: vm.envOr("TREASURY", deployer),
            admin: vm.envOr("ADMIN", deployer),
            creator: vm.envOr("CREATOR", deployer),
            oracle: vm.envOr("ORACLE", deployer),
            seedDemo: vm.envOr("SEED_DEMO", uint256(0)) == 1
        });

        bool requireSafe = vm.envOr("REQUIRE_SAFE_CONTRACT", uint256(1)) == 1;
        bool mainnet = block.chainid == BASE_MAINNET_CHAIN_ID;
        if (mainnet) _checkMainnetConfig(c, deployer, requireSafe);

        vm.startBroadcast(pk);

        // Non-Base chain with no explicit collateral -> deploy a 6-decimal MockUSDC so one command works
        bool localMock;
        if (c.collateral == address(0)) {
            c.collateral = address(new MockUSDC());
            localMock = true;
            console2.log("local MockUSDC deployed at:", c.collateral);
        }
        if (c.collateral.code.length == 0) revert("collateral has no code");
        if (_decimals(c.collateral) != 6) revert("collateral decimals must be 6");

        ProtocolFeeVault feeVault = new ProtocolFeeVault(c.collateral, c.treasury, c.admin);
        CentralPredictionEngine engine =
            new CentralPredictionEngine(c.collateral, address(feeVault), c.treasury, c.admin);

        // 部署者恰好就是 admin 时才能自己授权；否则交给 Safe 执行（见 _report）
        bool canSelfAdmin = deployer == c.admin;
        if (canSelfAdmin) {
            if (c.creator != c.admin) engine.setCreator(c.creator, true);
            if (c.oracle != c.admin) engine.setOracle(c.oracle, true);
        }

        bytes32 demoId;
        if (c.seedDemo) {
            require(canSelfAdmin || deployer == c.creator, "SEED_DEMO needs creator rights");
            string memory q = "Demo market: will BTC close up 1.5% within 24 hours?";
            demoId = keccak256(bytes(q));
            engine.createMarketWithMeta(demoId, q, "demo", block.timestamp + 24 hours);
            // The local mock starts with a zero balance: mint the seed, otherwise seeding always reverts.
            if (localMock) MockUSDC(c.collateral).mint(deployer, 1_000e6);
            IERC20(c.collateral).approve(address(engine), 1_000e6);
            engine.seedLiquidity(demoId, 1_000e6);
        }

        vm.stopBroadcast();

        _report(c, address(feeVault), address(engine), demoId, canSelfAdmin, requireSafe, deployer);
    }

    /* ------------------------------ 内部 ------------------------------ */

    function _checkMainnetConfig(Cfg memory c, address deployer, bool requireSafe) internal view {
        require(c.collateral != address(0), "mainnet: COLLATERAL required");
        require(c.admin != address(0) && c.treasury != address(0), "mainnet: ADMIN/TREASURY required");
        if (requireSafe) {
            require(c.admin.code.length > 0, "mainnet: ADMIN must be a Safe contract");
            require(c.treasury.code.length > 0, "mainnet: TREASURY must be a Safe contract");
            require(c.admin != deployer, "mainnet: ADMIN must not be the deployer EOA");
            require(c.creator != c.oracle, "mainnet: keep creator and oracle separate");
        }
        require(c.creator != address(0) && c.oracle != address(0), "mainnet: CREATOR/ORACLE required");
    }

    function _decimals(address token) internal view returns (uint256) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("decimals()"));
        require(ok && data.length >= 32, "collateral decimals() failed");
        return abi.decode(data, (uint256));
    }

    function _defaultUsdc() internal view returns (address) {
        if (block.chainid == BASE_MAINNET_CHAIN_ID) return BASE_MAINNET_USDC;
        if (block.chainid == 84532) return BASE_SEPOLIA_USDC;
        return address(0);
    }

    function _report(
        Cfg memory c,
        address feeVault,
        address engine,
        bytes32 demoId,
        bool canSelfAdmin,
        bool requireSafe,
        address deployer
    ) internal view {
        console2.log("");
        console2.log("=== CentralPredictionEngine deployed ===");
        console2.log("chainid   :", block.chainid);
        console2.log("collateral:", c.collateral);
        console2.log("feeVault  :", feeVault);
        console2.log("engine    :", engine);
        console2.log("admin     :", c.admin);
        console2.log("treasury  :", c.treasury);
        console2.log("creator   :", c.creator);
        console2.log("oracle    :", c.oracle);
        if (demoId != bytes32(0)) console2.logBytes32(demoId);

        if (!requireSafe && block.chainid == BASE_MAINNET_CHAIN_ID) {
            console2.log("");
            console2.log("!! ===== SINGLE-WALLET MODE (REQUIRE_SAFE_CONTRACT=0) =====");
            console2.log("!! admin/treasury/creator/oracle are the SAME EOA:", deployer);
            console2.log("!! whoever holds that key can mint markets, resolve outcomes, override results and move fees.");
            console2.log("!! migrate to a Safe as soon as possible: engine has no admin transfer for treasury,");
            console2.log("!! so plan the Safe as TREASURY/ADMIN from the very first market if you can.");
            console2.log("!! =======================================================");
        }

        console2.log("");
        console2.log("brain env:");
        console2.log("  export ENGINE=%s", engine);
        console2.log("  export USDC=%s", c.collateral);

        if (!canSelfAdmin) {
            console2.log("");
            console2.log("!! roles NOT granted: admin is a Safe, the deployer cannot call setCreator/setOracle.");
            console2.log("!! execute these two calls from the Safe (Transaction Builder -> contract interaction):");
            console2.log("   to   : %s", engine);
            console2.log("   setCreator data:");
            console2.logBytes(abi.encodeWithSignature("setCreator(address,bool)", c.creator, true));
            console2.log("   setOracle data:");
            console2.logBytes(abi.encodeWithSignature("setOracle(address,bool)", c.oracle, true));
        }
    }
}
