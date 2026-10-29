// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {ProtocolFeeVault} from "../src/ProtocolFeeVault.sol";
import {CentralPredictionEngine} from "../src/CentralPredictionEngine.sol";

/**
 * @notice One-command deployment of CentralPredictionEngine (single contract, many markets)
 *
 *  Local anvil: forge script script/DeployCentral.s.sol:DeployCentral --rpc-url http://127.0.0.1:8545 --broadcast
 *  Base mainnet: forge script script/DeployCentral.s.sol:DeployCentral --rpc-url $BASE_RPC_URL --broadcast --verify ...
 *
 * Environment:
 *   PRIVATE_KEY   deployer key (required)
 *   TREASURY      fee recipient (default: deployer; on mainnet it must be a contract such as a Safe)
 *   ADMIN         engine admin (default: deployer; on mainnet it must be a contract such as a Safe)
 *   CREATOR       Hermes market creator (default: deployer; an EOA is fine)
 *   ORACLE        Hermes oracle (default: deployer; an EOA is fine)
 *   COLLATERAL    collateral override (default: USDC per chain id; a MockUSDC is deployed locally)
 *   SEED_DEMO     1 = also create a 24h demo market (the deployer needs creation rights)
 *
 *   REQUIRE_SAFE_CONTRACT  1 (default) = enforce multisig mode on mainnet; 0 = single-wallet mode
 *
 * Mainnet (8453), two modes:
 *   REQUIRE_SAFE_CONTRACT=1 (default, recommended in production)
 *     - ADMIN / TREASURY must be contracts (Safes)
 *     - the deployer cannot also be the final admin
 *     - CREATOR and ORACLE must be different addresses (separation of duties)
 *   REQUIRE_SAFE_CONTRACT=0 (single wallet: one EOA holds ADMIN/TREASURY/CREATOR/ORACLE)
 *     - skips the three checks above, everything else still applies (6-decimal USDC, non-zero addresses)
 *     - single point of failure: a leaked key loses the funds and the admin privileges; the script warns loudly
 *  When ADMIN is a Safe the script cannot (and will not) call setCreator/setOracle for you — it prints
 *  the calldata for the Safe Transaction Builder so the multisig can execute it.
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

        // the deployer can only self-authorise when it is the admin; otherwise the Safe executes (see _report)
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

    /* ------------------------------ Internals ----------------------------- */

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
