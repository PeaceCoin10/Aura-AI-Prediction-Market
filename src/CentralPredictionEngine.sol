// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FixedPoint} from "./libraries/FixedPoint.sol";

/**
 * @title CentralPredictionEngine
 * @notice Binary prediction markets for an unbounded number of markets in a single contract.
 *
 *  Differences from one-contract-per-market:
 *    - one contract = one USDC vault + N independent ledgers (`mapping(bytes32 => Market)`);
 *    - every market carries its own CPMM reserves, user YES/NO shares, cash book and owed book;
 *    - deployment and ops cost drop from one deploy per market to one `createMarket` call.
 *
 *  CPMM (same math as PredictionVault, pinned by invariant tests):
 *      the pool holds y YES and n NO, with k = y * n constant.
 *      buy YES (net amount, after the 1.5% fee): n' = n + net, y' = ceil(y*n/n'), out = y - y'
 *      sell YES (sharesIn):                      y' = y + sharesIn, n' = ceil(y*n/y'), out = n - n'
 *
 *  Fund safety (per market, pinned by invariant tests):
 *      A1  cash >= owed                     — every promised payout stays fully backed
 *      A2  cash >= max(yesSupply, noSupply) — either side is payable in full at any time before settlement
 *      A3  owed only decreases after the dispute window closes (one decrement per redeem);
 *          inside the window an admin may re-rule, and each re-rule re-asserts cash >= owed
 *
 *  After settlement the pool inventory is written off (that is the market maker's risk);
 *  the leftover cash - owed is market-maker profit that only the admin may sweep to treasury,
 *  and it can never touch the owed slice.
 */
contract CentralPredictionEngine is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /* ----------------------------- Constants ---------------------------- */

    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// @notice 1.5% trading fee, forwarded to the FeeVault on every fill
    uint256 public constant TRADE_FEE_BPS = 150;
    /// @notice 0.5% fee on winning redemptions
    uint256 public constant SETTLE_FEE_BPS = 50;
    /// @notice minimum stake per trade: 5 USDC
    uint256 public constant MIN_BET = 5e6;
    /// @notice maximum stake per trade: 10,000 USDC
    uint256 public constant MAX_BET = 10_000e6;
    /// @notice hard cap on price impact per trade: 5%
    uint256 public constant MAX_IMPACT_BPS_CAP = 500;
    /// @notice emergency refund window after the resolution time: 7 days
    uint256 public constant REFUND_DELAY = 7 days;
    /// @notice shortest market lifetime (blocks create-then-refund arbitrage)
    uint256 public constant MIN_TRADING_WINDOW = 1 hours;
    /// @notice longest market lifetime
    uint256 public constant MAX_TRADING_WINDOW = 365 days;
    /// @notice floor for the market-making seed (a zero-depth book must not be bought out in one trade)
    uint256 public constant MIN_SEED = 10e6;
    /**
     * @notice Ruling dispute buffer: 1 hour after the oracle submits a result.
     *         redeem / sweep are frozen during the window and the admin (Safe multisig)
     *         may re-rule; once it lapses the result applies with no further transaction.
     */
    uint256 public constant DISPUTE_WINDOW = 1 hours;

    uint8 public constant OUTCOME_NO = 0;
    uint8 public constant OUTCOME_YES = 1;
    uint8 public constant OUTCOME_INVALID = 2;

    /* ----------------------------- Structs ------------------------------ */

    struct Market {
        string question;
        string category;
        uint256 resolutionTime;
        uint256 createdAt;
        address creator;
        /// @notice YES / NO inventory held by the pool (drives AMM pricing)
        uint256 yesReserve;
        uint256 noReserve;
        /// @notice market-scoped cash book (USDC)
        uint256 cash;
        /// @notice payouts promised but not yet redeemed (gross, before the settlement fee)
        uint256 owed;
        /// @notice cumulative traded volume (reconciliation)
        uint256 totalVolume;
        uint8 outcome;
        bool resolved;
        bool exists;
        /// @notice dispute window end timestamp (0 = not yet ruled)
        uint64 disputeEndsAt;
        /// @notice whether the market is final (window lapsed, or finalize / emergency refund)
        bool finalized;
        /// @notice how many times the admin overrode the result (audit trail)
        uint8 disputes;
        /// @notice user-side shares at settlement (the only input for recomputing owed on a re-rule)
        uint256 yesUserAtSettle;
        uint256 noUserAtSettle;
    }

    /// @notice numeric snapshot of a market (no strings, so chain and UI state read in one call)
    struct Core {
        uint256 yesReserve;
        uint256 noReserve;
        uint256 cash;
        uint256 owed;
        uint256 totalVolume;
        uint256 resolutionTime;
        uint256 createdAt;
        address creator;
        uint8 outcome;
        bool resolved;
        bool exists;
    }

    /* ------------------------------ State ------------------------------- */

    /// @notice collateral (USDC), immutable after deployment
    IERC20 public immutable collateral;
    address public feeVault;
    address public treasury;

    address public admin;
    address public pendingAdmin;

    /// @notice AI / keeper allowed to create markets
    mapping(address => bool) public creators;
    /// @notice oracle allowed to rule (Hermes)
    mapping(address => bool) public oracles;

    bool public paused;

    /// @notice every market
    mapping(bytes32 => Market) public markets;
    /// @notice creation order (front end and agent iterators)
    bytes32[] public marketIds;

    /// @notice share supply per market
    mapping(bytes32 => uint256) public yesSupply;
    mapping(bytes32 => uint256) public noSupply;
    /// @notice per-user share ledger
    mapping(bytes32 => mapping(address => uint256)) public yesOf;
    mapping(bytes32 => mapping(address => uint256)) public noOf;

    /* ----------------------------- Events ------------------------------- */

    event MarketCreated(
        bytes32 indexed marketId,
        address indexed creator,
        string question,
        string category,
        uint256 resolutionTime
    );
    event MarketCategoryUpdated(bytes32 indexed marketId, string category);
    event LiquiditySeeded(bytes32 indexed marketId, address indexed seeder, uint256 amount);
    event SharesBought(
        bytes32 indexed marketId,
        address indexed buyer,
        uint8 outcome,
        uint256 amountIn,
        uint256 fee,
        uint256 sharesOut,
        uint256 priceYes
    );
    event SharesSold(
        bytes32 indexed marketId,
        address indexed seller,
        uint8 outcome,
        uint256 sharesIn,
        uint256 amountOut,
        uint256 fee,
        uint256 priceYes
    );
    event MarketResolved(
        bytes32 indexed marketId, uint8 outcome, uint256 timestamp, bool emergency, uint256 owed
    );
    event DisputeWindowOpened(
        bytes32 indexed marketId, uint8 outcome, uint256 disputeEndsAt, uint256 owed
    );
    event ResolutionOverridden(
        bytes32 indexed marketId, uint8 oldOutcome, uint8 newOutcome, uint256 newOwed, uint8 disputes
    );
    event ResolutionFinalized(bytes32 indexed marketId, uint8 outcome, uint256 owed);
    event Redeemed(
        bytes32 indexed marketId,
        address indexed account,
        uint256 yesBurned,
        uint256 noBurned,
        uint256 payout,
        uint256 fee
    );
    event ResidualSwept(bytes32 indexed marketId, address indexed treasury, uint256 amount);
    event FeeVaultUpdated(address indexed oldFeeVault, address indexed newFeeVault);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event CreatorUpdated(address indexed account, bool allowed);
    event OracleUpdated(address indexed account, bool allowed);
    event Paused(address account);
    event Unpaused(address account);
    event AdminTransferStarted(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);

    /* ----------------------------- Errors ------------------------------- */

    error ZeroAddress();
    error NotContract();
    error OnlyAdmin();
    error NotPendingAdmin();
    error SameAdmin();
    error OnlyCreator();
    error OnlyOracle();
    error MarketExists();
    error MarketNotFound();
    error MarketResolvedAlready();
    error NotResolved();
    error InvalidOutcome();
    error InvalidResolutionTime();
    error InvalidQuestion();
    error TradingClosed();
    error EnforcedPause();
    error BelowMinBet();
    error AboveMaxBet();
    error ImpactTooHigh();
    error InsufficientLiquidity();
    error ZeroShares();
    error SlippageExceeded();
    error TooEarlyToResolve();
    error RefundWindowNotReached();
    error NothingToRedeem();
    error NothingToSweep();
    error BelowMinSeed();
    error DisputeWindowOpen();
    error DisputeWindowClosed();
    error SameOutcome();

    /* --------------------------- Modifiers ------------------------------ */

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    modifier onlyCreator() {
        if (msg.sender != admin && !creators[msg.sender]) revert OnlyCreator();
        _;
    }

    modifier onlyOracle() {
        if (msg.sender != admin && !oracles[msg.sender]) revert OnlyOracle();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert EnforcedPause();
        _;
    }

    /**
     * @dev Redemption gate: paused blocks redemption, but any market past resolution + 7 days
     *      bypasses the pause. An admin can never freeze principal forever.
     */
    modifier redeemGuard(bytes32 marketId) {
        if (paused) {
            Market storage m = markets[marketId];
            if (block.timestamp < m.resolutionTime + REFUND_DELAY) revert EnforcedPause();
        }
        _;
    }

    constructor(address collateral_, address feeVault_, address treasury_, address admin_) {
        if (collateral_ == address(0) || feeVault_ == address(0) || treasury_ == address(0) || admin_ == address(0)) {
            revert ZeroAddress();
        }
        if (collateral_.code.length == 0) revert NotContract();
        collateral = IERC20(collateral_);
        feeVault = feeVault_;
        treasury = treasury_;
        admin = admin_;
        emit AdminTransferred(address(0), admin_);
    }

    /* ------------------------ Create (AI entry) -------------------------- */

    /**
     * @notice Create a market: any authorised AI / keeper may open one at any time
     * @param marketId business key (usually keccak256(question), produced by the agent)
     * @param question human-readable question (8..280 bytes)
     * @param resolutionTime settlement timestamp (must be > now + 1h and < now + 365d)
     */
    function createMarket(bytes32 marketId, string memory question, uint256 resolutionTime)
        external
        onlyCreator
        returns (bool)
    {
        _createMarket(marketId, question, "general", resolutionTime);
        return true;
    }

    /// @notice Create a market with a category (same path; the agent tags crypto/sports/politics)
    function createMarketWithMeta(bytes32 marketId, string memory question, string memory category, uint256 resolutionTime)
        external
        onlyCreator
        returns (bool)
    {
        _createMarket(marketId, question, category, resolutionTime);
        return true;
    }

    function _createMarket(bytes32 marketId, string memory question, string memory category, uint256 resolutionTime)
        internal
    {
        if (marketId == bytes32(0)) revert InvalidQuestion();
        if (markets[marketId].exists) revert MarketExists();

        uint256 qlen = bytes(question).length;
        if (qlen < 8 || qlen > 280) revert InvalidQuestion();
        if (bytes(category).length == 0 || bytes(category).length > 32) revert InvalidQuestion();
        if (resolutionTime <= block.timestamp + MIN_TRADING_WINDOW) revert InvalidResolutionTime();
        if (resolutionTime > block.timestamp + MAX_TRADING_WINDOW) revert InvalidResolutionTime();

        Market storage m = markets[marketId];
        m.question = question;
        m.category = category;
        m.resolutionTime = resolutionTime;
        m.createdAt = block.timestamp;
        m.creator = msg.sender;
        m.exists = true;

        marketIds.push(marketId);
        emit MarketCreated(marketId, msg.sender, question, category, resolutionTime);
    }

    /// @notice creator / oracle may correct the category tag before settlement
    function setCategory(bytes32 marketId, string memory category) external {
        Market storage m = _market(marketId);
        if (msg.sender != admin && msg.sender != m.creator && !oracles[msg.sender]) revert OnlyCreator();
        if (m.resolved) revert MarketResolvedAlready();
        if (bytes(category).length == 0 || bytes(category).length > 32) revert InvalidQuestion();
        m.category = category;
        emit MarketCategoryUpdated(marketId, category);
    }

    /* --------------------- Market making (seed liquidity) ---------------- */

    /**
     * @notice Seed liquidity: mint an equal amount of YES/NO inventory into the pool (1 pair = 1 USDC)
     * @dev This capital is the market maker's risk and is not returned at settlement; leftover cash
     *      (cash - owed) is swept to treasury by the admin. Top-ups are allowed before settlement.
     */
    function seedLiquidity(bytes32 marketId, uint256 amount) external onlyCreator nonReentrant {
        Market storage m = _market(marketId);
        if (m.resolved) revert MarketResolvedAlready();
        if (block.timestamp >= m.resolutionTime) revert TradingClosed();
        if (amount < MIN_SEED) revert BelowMinSeed();

        m.cash += amount;
        m.yesReserve += amount;
        m.noReserve += amount;
        yesSupply[marketId] += amount;
        noSupply[marketId] += amount;

        emit LiquiditySeeded(marketId, msg.sender, amount);
        collateral.safeTransferFrom(msg.sender, address(this), amount);
    }

    /* ----------------------------- Trading ------------------------------- */

    /**
     * @notice Buy shares
     * @param outcome 0 = NO, 1 = YES
     * @param amountIn gross payment (the 1.5% fee is charged here and forwarded to the FeeVault)
     * @param minSharesOut slippage guard
     */
    function buyShares(bytes32 marketId, uint8 outcome, uint256 amountIn, uint256 minSharesOut)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 sharesOut)
    {
        Market storage m = _market(marketId);
        if (m.resolved) revert MarketResolvedAlready();
        if (block.timestamp >= m.resolutionTime) revert TradingClosed();
        if (outcome > OUTCOME_YES) revert InvalidOutcome();
        if (amountIn < MIN_BET) revert BelowMinBet();
        if (amountIn > MAX_BET) revert AboveMaxBet();
        if (amountIn > FixedPoint.mulDivDown(m.yesReserve + m.noReserve, MAX_IMPACT_BPS_CAP, BPS_DENOMINATOR)) {
            revert ImpactTooHigh();
        }

        uint256 fee = FixedPoint.bpsUp(amountIn, TRADE_FEE_BPS);
        uint256 net = amountIn - fee;
        if (net == 0) revert ZeroShares();

        // Economics: net is split into net pairs (net YES + net NO, 1 pair = 1 USDC of collateral),
        // the net NO leg enters the pool and the pool releases dy YES via CPMM — the user gets net + dy.
        // That is why 1 USDC buys ~2 shares at 50%, keeping price and payout consistent.
        sharesOut = _applyBuy(m, marketId, outcome, net);

        if (sharesOut == 0) revert ZeroShares();
        if (sharesOut < minSharesOut) revert SlippageExceeded();

        // ---- book the fill + emit ----
        m.cash += net;
        m.totalVolume += amountIn;
        if (outcome == OUTCOME_YES) yesOf[marketId][msg.sender] += sharesOut;
        else noOf[marketId][msg.sender] += sharesOut;

        emit SharesBought(marketId, msg.sender, outcome, amountIn, fee, sharesOut, _priceYes(m));

        // ---- external calls last (CEI) ----
        collateral.safeTransferFrom(msg.sender, address(this), amountIn);
        if (fee > 0) collateral.safeTransfer(feeVault, fee);
    }

    /**
     * @notice Sell shares back for collateral (same 1.5% fee)
     */
    function sellShares(bytes32 marketId, uint8 outcome, uint256 sharesIn, uint256 minAmountOut)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 amountOut)
    {
        Market storage m = _market(marketId);
        if (m.resolved) revert MarketResolvedAlready();
        if (block.timestamp >= m.resolutionTime) revert TradingClosed();
        if (outcome > OUTCOME_YES) revert InvalidOutcome();
        if (sharesIn == 0) revert ZeroShares();
        if (sharesIn > (outcome == OUTCOME_YES ? yesOf[marketId][msg.sender] : noOf[marketId][msg.sender])) {
            revert InsufficientLiquidity();
        }
        if (sharesIn > FixedPoint.mulDivDown(m.yesReserve + m.noReserve, MAX_IMPACT_BPS_CAP, BPS_DENOMINATOR)) {
            revert ImpactTooHigh();
        }

        // Selling = burn sharesIn YES (or NO) plus an equal amount of the opposite leg (1 pair = 1 USDC);
        // the user is paid at the average execution price and the spread stays in the pool.
        uint256 grossOut = _quoteSell(m, outcome, sharesIn);
        if (grossOut == 0) revert ZeroShares();
        if (grossOut > m.cash) revert InsufficientLiquidity();

        uint256 fee = FixedPoint.bpsUp(grossOut, TRADE_FEE_BPS);
        amountOut = grossOut - fee;
        if (amountOut == 0) revert ZeroShares();
        if (amountOut < minAmountOut) revert SlippageExceeded();

        _applySell(m, marketId, outcome, sharesIn, grossOut);
        m.cash -= grossOut;
        m.totalVolume += grossOut;

        emit SharesSold(marketId, msg.sender, outcome, sharesIn, amountOut, fee, _priceYes(m));

        if (fee > 0) collateral.safeTransfer(feeVault, fee);
        collateral.safeTransfer(msg.sender, amountOut);
    }

    /// @dev Buy transition: mint net pairs, the pool releases got, the user nets net + got
    function _applyBuy(Market storage m, bytes32 marketId, uint8 outcome, uint256 net)
        internal
        returns (uint256 sharesOut)
    {
        uint256 ys = m.yesReserve;
        uint256 ns = m.noReserve;
        if (outcome == OUTCOME_YES) {
            uint256 got = ys - FixedPoint.mulDivUp(ys, ns, ns + net);
            m.yesReserve = ys - got;
            m.noReserve = ns + net;
            sharesOut = net + got;
        } else {
            uint256 got = ns - FixedPoint.mulDivUp(ns, ys, ys + net);
            m.noReserve = ns - got;
            m.yesReserve = ys + net;
            sharesOut = net + got;
        }
        yesSupply[marketId] += net;
        noSupply[marketId] += net;
    }

    /// @dev Sell quote: midpoint of pre- and post-trade price, so round-tripping always loses the fee
    function _quoteSell(Market storage m, uint8 outcome, uint256 sharesIn) internal view returns (uint256 gross) {
        uint256 d = m.yesReserve + m.noReserve;
        if (d == 0) return 0;
        uint256 pBefore;
        uint256 pAfter;
        if (outcome == OUTCOME_YES) {
            if (sharesIn > m.noReserve) return 0;
            pBefore = FixedPoint.mulDivDown(m.noReserve, 1e18, d);
            pAfter = FixedPoint.mulDivDown(m.noReserve - sharesIn, 1e18, d - sharesIn);
        } else {
            if (sharesIn > m.yesReserve) return 0;
            pBefore = FixedPoint.mulDivDown(m.yesReserve, 1e18, d);
            pAfter = FixedPoint.mulDivDown(m.yesReserve - sharesIn, 1e18, d - sharesIn);
        }
        gross = FixedPoint.mulDivDown(sharesIn, pBefore + pAfter, 2e18);
    }

    /// @dev Sell transition: both sides of the supply shrink by sharesIn, the pool burns the matching inventory
    function _applySell(Market storage m, bytes32 marketId, uint8 outcome, uint256 sharesIn, uint256) internal {
        if (outcome == OUTCOME_YES) {
            yesOf[marketId][msg.sender] -= sharesIn;
            m.noReserve -= sharesIn;
        } else {
            noOf[marketId][msg.sender] -= sharesIn;
            m.yesReserve -= sharesIn;
        }
        yesSupply[marketId] -= sharesIn;
        noSupply[marketId] -= sharesIn;
    }

    /* --------------------------- Settlement ----------------------------- */

    /**
     * @notice Oracle rules on the outcome (only after the resolution time)
     * @param outcome 0 = NO, 1 = YES, 2 = INVALID (pays 0.5 to each side)
     * @dev Settlement writes off the pool inventory and locks the user-side payout into owed.
     */
    function resolveMarket(bytes32 marketId, uint8 outcome) external onlyOracle {
        Market storage m = _market(marketId);
        if (m.resolved) revert MarketResolvedAlready();
        if (block.timestamp < m.resolutionTime) revert TooEarlyToResolve();
        if (outcome > OUTCOME_INVALID) revert InvalidOutcome();

        _settle(marketId, m, outcome, false);
    }

    /**
     * @notice Timeout fallback: no ruling by resolution + 7 days lets anyone trigger a 0.5/0.5 refund
     */
    function emergencyRefund(bytes32 marketId) external {
        Market storage m = _market(marketId);
        if (m.resolved) revert MarketResolvedAlready();
        if (block.timestamp < m.resolutionTime + REFUND_DELAY) revert RefundWindowNotReached();

        _settle(marketId, m, OUTCOME_INVALID, true);
    }

    function _settle(bytes32 marketId, Market storage m, uint8 outcome, bool emergency) internal {
        // user-side shares = total supply - pool inventory (the pool leg belongs to the market maker
        // and is written off at settlement). Both numbers are snapshotted here so a re-rule inside
        // the dispute window recomputes owed correctly even after the pool has been zeroed.
        uint256 userYes = yesSupply[marketId] - m.yesReserve;
        uint256 userNo = noSupply[marketId] - m.noReserve;

        m.resolved = true;
        m.outcome = outcome;
        m.yesUserAtSettle = userYes;
        m.noUserAtSettle = userNo;
        m.owed = _owedFor(m, outcome);
        m.yesReserve = 0;
        m.noReserve = 0;

        // A1: settlement is the last safety gate — cash must cover every promised payout
        require(m.cash >= m.owed, "INSOLVENT");

        if (emergency) {
            // a timeout refund is a fallback: there is no ruling to dispute, so the market closes directly
            m.disputeEndsAt = uint64(block.timestamp);
            m.finalized = true;
        } else {
            m.disputeEndsAt = uint64(block.timestamp + DISPUTE_WINDOW);
            m.finalized = false;
        }

        emit MarketResolved(marketId, outcome, block.timestamp, emergency, m.owed);
        emit DisputeWindowOpened(marketId, outcome, m.disputeEndsAt, m.owed);
    }

    /// @dev total payout for one outcome (driven only by user-side shares at settlement)
    function _owedFor(Market storage m, uint8 outcome) internal view returns (uint256) {
        if (outcome == OUTCOME_INVALID) return (m.yesUserAtSettle + m.noUserAtSettle) / 2;
        if (outcome == OUTCOME_YES) return m.yesUserAtSettle;
        return m.noUserAtSettle;
    }

    /// @dev whether the market is final (window lapsed or explicitly finalised)
    function _isFinal(Market storage m) internal view returns (bool) {
        if (!m.resolved) return false;
        return m.finalized || block.timestamp >= m.disputeEndsAt;
    }

    /**
     * @notice Re-rule inside the dispute window (admin / Safe multisig only)
     * @dev redeem is frozen for the whole window, so owed can be recomputed safely; the window
     *      is never extended by a re-rule, which keeps an admin from stalling indefinitely.
     */
    function overrideResolution(bytes32 marketId, uint8 newOutcome) external onlyAdmin {
        Market storage m = _market(marketId);
        if (!m.resolved) revert NotResolved();
        if (m.finalized || block.timestamp >= m.disputeEndsAt) revert DisputeWindowClosed();
        if (newOutcome > OUTCOME_INVALID) revert InvalidOutcome();
        if (newOutcome == m.outcome) revert SameOutcome();

        uint8 oldOutcome = m.outcome;
        uint256 newOwed = _owedFor(m, newOutcome);
        require(m.cash >= newOwed, "INSOLVENT");

        m.outcome = newOutcome;
        m.owed = newOwed;
        m.disputes += 1;

        emit ResolutionOverridden(marketId, oldOutcome, newOutcome, newOwed, m.disputes);
    }

    /**
     * @notice Mark the market final once the dispute window has lapsed (anyone may call; emits an indexer hint)
     * @dev Redemption does not depend on it — after the window redeem is timestamp-gated, so a market cannot wedge.
     */
    function finalize(bytes32 marketId) external {
        Market storage m = _market(marketId);
        if (!m.resolved) revert NotResolved();
        if (m.finalized) revert MarketResolvedAlready();
        if (block.timestamp < m.disputeEndsAt) revert DisputeWindowOpen();

        m.finalized = true;
        emit ResolutionFinalized(marketId, m.outcome, m.owed);
    }

    /**
     * @notice Redeem: winners get 1.0 minus the 0.5% fee; under INVALID both sides get 0.5 fee-free
     */
    function redeem(bytes32 marketId)
        external
        nonReentrant
        redeemGuard(marketId)
        returns (uint256 payout, uint256 fee)
    {
        Market storage m = _market(marketId);
        if (!m.resolved) revert NotResolved();
        // dispute buffer: the result may still be overridden, paying out now could pay the wrong outcome
        if (!_isFinal(m)) revert DisputeWindowOpen();

        uint256 yesBal = yesOf[marketId][msg.sender];
        uint256 noBal = noOf[marketId][msg.sender];
        if (yesBal == 0 && noBal == 0) revert NothingToRedeem();

        uint256 gross;
        if (m.outcome == OUTCOME_INVALID) {
            gross = (yesBal + noBal) / 2;
            fee = 0;
            payout = gross;
        } else {
            uint256 winning = m.outcome == OUTCOME_YES ? yesBal : noBal;
            if (winning == 0) revert NothingToRedeem();
            fee = FixedPoint.bpsUp(winning, SETTLE_FEE_BPS);
            payout = winning - fee;
            gross = winning;
        }
        if (gross == 0 || gross > m.owed) revert InsufficientLiquidity();

        // ---- book it: zero the shares, decrement owed and cash ----
        yesOf[marketId][msg.sender] = 0;
        noOf[marketId][msg.sender] = 0;
        m.owed -= gross;
        m.cash -= gross;

        emit Redeemed(marketId, msg.sender, yesBal, noBal, payout, fee);

        if (fee > 0) collateral.safeTransfer(feeVault, fee);
        if (payout > 0) collateral.safeTransfer(msg.sender, payout);
    }

    /**
     * @notice Sweep the market-making leftover (= cash - owed); treasury only
     * @dev Never touches the promised-but-unclaimed slice; not callable before settlement.
     */
    function sweepResidual(bytes32 marketId) external onlyAdmin nonReentrant returns (uint256 amount) {
        Market storage m = _market(marketId);
        if (!m.resolved) revert NotResolved();
        // owed may still move during the dispute window; sweeping early would break the owed backstop
        if (!_isFinal(m)) revert DisputeWindowOpen();

        amount = m.cash - m.owed;
        if (amount == 0) revert NothingToSweep();

        m.cash -= amount;
        emit ResidualSwept(marketId, treasury, amount);
        collateral.safeTransfer(treasury, amount);
    }

    /* ---------------------------- Admin -------------------------------- */

    function pause() external onlyAdmin {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyAdmin {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setFeeVault(address feeVault_) external onlyAdmin {
        if (feeVault_ == address(0)) revert ZeroAddress();
        emit FeeVaultUpdated(feeVault, feeVault_);
        feeVault = feeVault_;
    }

    function setTreasury(address treasury_) external onlyAdmin {
        if (treasury_ == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, treasury_);
        treasury = treasury_;
    }

    function setCreator(address account, bool allowed) external onlyAdmin {
        if (account == address(0)) revert ZeroAddress();
        creators[account] = allowed;
        emit CreatorUpdated(account, allowed);
    }

    function setOracle(address account, bool allowed) external onlyAdmin {
        if (account == address(0)) revert ZeroAddress();
        oracles[account] = allowed;
        emit OracleUpdated(account, allowed);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        if (newAdmin == admin) revert SameAdmin();
        pendingAdmin = newAdmin;
        emit AdminTransferStarted(admin, newAdmin);
    }

    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert NotPendingAdmin();
        address old = admin;
        admin = msg.sender;
        pendingAdmin = address(0);
        emit AdminTransferred(old, msg.sender);
    }

    /* ----------------------------- Views ------------------------------- */

    function marketCount() external view returns (uint256) {
        return marketIds.length;
    }

    /// @notice numeric snapshot of one market (strings live in marketQuestion / marketCategory)
    function marketCore(bytes32 marketId) external view returns (Core memory) {
        Market storage m = markets[marketId];
        return Core({
            yesReserve: m.yesReserve,
            noReserve: m.noReserve,
            cash: m.cash,
            owed: m.owed,
            totalVolume: m.totalVolume,
            resolutionTime: m.resolutionTime,
            createdAt: m.createdAt,
            creator: m.creator,
            outcome: m.outcome,
            resolved: m.resolved,
            exists: m.exists
        });
    }

    function marketQuestion(bytes32 marketId) external view returns (string memory) {
        return markets[marketId].question;
    }

    function marketCategory(bytes32 marketId) external view returns (string memory) {
        return markets[marketId].category;
    }

    /// @notice YES price (1e18)
    function priceYes(bytes32 marketId) external view returns (uint256) {
        return _priceYes(markets[marketId]);
    }

    function _priceYes(Market storage m) internal view returns (uint256) {
        uint256 poolDepth = m.yesReserve + m.noReserve;
        if (poolDepth == 0) return 0;
        return FixedPoint.mulDivDown(m.noReserve, 1e18, poolDepth);
    }

    function priceNo(bytes32 marketId) external view returns (uint256) {
        Market storage m = markets[marketId];
        uint256 poolDepth = m.yesReserve + m.noReserve;
        if (poolDepth == 0) return 0;
        return FixedPoint.mulDivDown(m.yesReserve, 1e18, poolDepth);
    }

    function depth(bytes32 marketId) external view returns (uint256) {
        Market storage m = markets[marketId];
        return m.yesReserve + m.noReserve;
    }

    function tradingOpen(bytes32 marketId) external view returns (bool) {
        Market storage m = markets[marketId];
        return m.exists && !m.resolved && !paused && block.timestamp < m.resolutionTime;
    }

    function refundAvailableAt(bytes32 marketId) external view returns (uint256) {
        return markets[marketId].resolutionTime + REFUND_DELAY;
    }

    /// @notice sweepable leftover after settlement (cash - owed); always 0 during the dispute window
    function sweepable(bytes32 marketId) external view returns (uint256) {
        Market storage m = markets[marketId];
        if (!_isFinal(m)) return 0;
        return m.cash - m.owed;
    }

    /**
     * @notice Ruling and dispute state in one call (front end / agent / indexer)
     * @return resolved whether a result exists (including during the dispute)
     * @return finalized whether the market is final (redeemable)
     * @return disputing whether the dispute buffer is active
     * @return outcome current outcome (0 NO / 1 YES / 2 INVALID)
     * @return disputeEndsAt dispute window end timestamp (0 = not ruled)
     * @return owed current total payout due
     */
    function resolutionState(bytes32 marketId)
        external
        view
        returns (bool resolved, bool finalized, bool disputing, uint8 outcome, uint256 disputeEndsAt, uint256 owed)
    {
        Market storage m = markets[marketId];
        resolved = m.resolved;
        finalized = _isFinal(m);
        disputing = m.resolved && !finalized;
        outcome = m.outcome;
        disputeEndsAt = m.disputeEndsAt;
        owed = m.owed;
    }

    /// @notice whether redemption is allowed yet
    function isFinal(bytes32 marketId) external view returns (bool) {
        return _isFinal(markets[marketId]);
    }

    function previewBuy(bytes32 marketId, uint8 outcome, uint256 amountIn) external view returns (uint256) {
        Market storage m = markets[marketId];
        if (m.noReserve == 0 || m.yesReserve == 0) return 0;
        uint256 fee = FixedPoint.bpsUp(amountIn, TRADE_FEE_BPS);
        uint256 net = amountIn - fee;
        if (outcome == OUTCOME_YES) {
            return net + (m.yesReserve - FixedPoint.mulDivUp(m.yesReserve, m.noReserve, m.noReserve + net));
        }
        return net + (m.noReserve - FixedPoint.mulDivUp(m.noReserve, m.yesReserve, m.yesReserve + net));
    }

    function previewSell(bytes32 marketId, uint8 outcome, uint256 sharesIn) external view returns (uint256) {
        uint256 gross = _quoteSell(markets[marketId], outcome, sharesIn);
        return gross - FixedPoint.bpsUp(gross, TRADE_FEE_BPS);
    }

    function _market(bytes32 marketId) internal view returns (Market storage) {
        Market storage m = markets[marketId];
        if (!m.exists) revert MarketNotFound();
        return m;
    }
}
