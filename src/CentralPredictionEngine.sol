// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FixedPoint} from "./libraries/FixedPoint.sol";

/**
 * @title CentralPredictionEngine
 * @notice 单合约承载无限盘口的二元预测市场（Multi-Market Single Contract）。
 *
 *  与「一盘口一合约」的差别：
 *    - 一个合约 = 一个 USDC 金库 + N 个独立账本（`mapping(bytes32 => Market)`）；
 *    - 每个盘口有自己的 CPMM 储备、用户 YES/NO 份额、cash 账面与应付（owed）账面；
 *    - 部署成本与运维面从「每盘一次部署」降到「每盘一条 createMarket」。
 *
 *  CPMM（与 PredictionVault 同一套数学，已通过不变式测试）：
 *      池内持有 y 份 YES、n 份 NO，k = y * n 恒定。
 *      买 YES（净额 net，已扣 1.5%）：n' = n + net，y' = ceil(y*n/n')，out = y - y'
 *      卖 YES（sharesIn）：            y' = y + sharesIn，n' = ceil(y*n/y')，out = n - n'
 *
 *  资金安全（每个盘口独立成立，且被 invariant 测试钉住）：
 *      A1  cash >= owed                    —— 已承诺但未领取的赔付永远有足额现金
 *      A2  cash >= max(yesSupply, noSupply) —— 结算前任何时刻都偿付得起单边全赢
 *      A3  owed 在争议期结束后只减不增（每笔 redeem 递减）；
 *          争议期内 admin 可改判一次/多次，每次改判后仍强制 cash >= owed
 *
 *  结算后池内库存直接作废（做市方的对手盘风险），剩余现金 = cash - owed 是
 *  做市利润，只能由 admin 扫给 treasury，永远动不到 owed 那一份。
 */
contract CentralPredictionEngine is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /* ------------------------------ 常量 ------------------------------ */

    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// @notice 交易抽成 1.5%，成交瞬间直接进 FeeVault
    uint256 public constant TRADE_FEE_BPS = 150;
    /// @notice 赢家赎回抽成 0.5%
    uint256 public constant SETTLE_FEE_BPS = 50;
    /// @notice 单笔最低下注 5 USDC
    uint256 public constant MIN_BET = 5e6;
    /// @notice 单笔最高下注 10,000 USDC
    uint256 public constant MAX_BET = 10_000e6;
    /// @notice 单笔价格影响硬上限 5%
    uint256 public constant MAX_IMPACT_BPS_CAP = 500;
    /// @notice 结算超时自动退款窗口：7 天
    uint256 public constant REFUND_DELAY = 7 days;
    /// @notice 盘口最短存活时间（防「建盘即可退款」套利）
    uint256 public constant MIN_TRADING_WINDOW = 1 hours;
    /// @notice 盘口最长存续时间
    uint256 public constant MAX_TRADING_WINDOW = 365 days;
    /// @notice 做市种子下限（防 0 深度盘口被一次买穿）
    uint256 public constant MIN_SEED = 10e6;
    /**
     * @notice 裁决争议缓冲期：预言机提交结果后的 1 小时。
     *         期间禁止 redeem / sweep，admin（Safe 多签）可一键改判；
     *         窗口一过自动生效，不需要任何人再发交易。
     */
    uint256 public constant DISPUTE_WINDOW = 1 hours;

    uint8 public constant OUTCOME_NO = 0;
    uint8 public constant OUTCOME_YES = 1;
    uint8 public constant OUTCOME_INVALID = 2;

    /* ------------------------------ 结构 ------------------------------ */

    struct Market {
        string question;
        string category;
        uint256 resolutionTime;
        uint256 createdAt;
        address creator;
        /// @notice 池内 YES / NO 库存（AMM 定价用）
        uint256 yesReserve;
        uint256 noReserve;
        /// @notice 本盘口专属现金账面（USDC）
        uint256 cash;
        /// @notice 已承诺但尚未领取的赔付（含结算费之前的毛额）
        uint256 owed;
        /// @notice 累计成交额（对账用）
        uint256 totalVolume;
        uint8 outcome;
        bool resolved;
        bool exists;
        /// @notice 争议期结束时间戳（0 = 尚未裁决）
        uint64 disputeEndsAt;
        /// @notice 是否已终结（争议期自然结束或被 finalize/紧急退款确认）
        bool finalized;
        /// @notice 结果被 admin 覆盖的次数（审计用）
        uint8 disputes;
        /// @notice 结算瞬间的用户侧份额（改判时重算 owed 的唯一依据）
        uint256 yesUserAtSettle;
        uint256 noUserAtSettle;
    }

    /// @notice 盘口核心数值快照（不含字符串，方便链上/前端一次读完）
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

    /* ------------------------------ 状态 ------------------------------ */

    /// @notice 抵押品（USDC），部署后不可改
    IERC20 public immutable collateral;
    address public feeVault;
    address public treasury;

    address public admin;
    address public pendingAdmin;

    /// @notice 被授权建盘的 AI / Keeper
    mapping(address => bool) public creators;
    /// @notice 被授权裁决的预言机（Hermes）
    mapping(address => bool) public oracles;

    bool public paused;

    /// @notice 全部盘口
    mapping(bytes32 => Market) public markets;
    /// @notice 建盘顺序（前端/大脑遍历用）
    bytes32[] public marketIds;

    /// @notice 每个盘口的份额总账
    mapping(bytes32 => uint256) public yesSupply;
    mapping(bytes32 => uint256) public noSupply;
    /// @notice 用户份额账本
    mapping(bytes32 => mapping(address => uint256)) public yesOf;
    mapping(bytes32 => mapping(address => uint256)) public noOf;

    /* ------------------------------ 事件 ------------------------------ */

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

    /* ------------------------------ 错误 ------------------------------ */

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

    /* ------------------------------ 修饰器 ------------------------------ */

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
     * @dev 赎回闸：暂停期间禁止赎回，但「结算时间 + 7 天」之后无视暂停强制放行。
     *      管理员不能拥有永久冻结用户本金的能力。
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

    /* ---------------------------- 建盘（AI 入口） ---------------------------- */

    /**
     * @notice 新增盘口：授权 AI / Keeper 可随时发车
     * @param marketId 业务主键（通常 keccak256(question)，由大脑生成）
     * @param question 人类可读问题（8~280 字节）
     * @param resolutionTime 结算时间戳（必须 > now + 1h 且 < now + 365d）
     */
    function createMarket(bytes32 marketId, string memory question, uint256 resolutionTime)
        external
        onlyCreator
        returns (bool)
    {
        _createMarket(marketId, question, "general", resolutionTime);
        return true;
    }

    /// @notice 带分类的建盘（同一条逻辑，供大脑标注 crypto/sports/politics…）
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

    /// @notice 建盘者/预言机可在结算前修正分类标签
    function setCategory(bytes32 marketId, string memory category) external {
        Market storage m = _market(marketId);
        if (msg.sender != admin && msg.sender != m.creator && !oracles[msg.sender]) revert OnlyCreator();
        if (m.resolved) revert MarketResolvedAlready();
        if (bytes(category).length == 0 || bytes(category).length > 32) revert InvalidQuestion();
        m.category = category;
        emit MarketCategoryUpdated(marketId, category);
    }

    /* ---------------------------- 做市（种子流动性） ---------------------------- */

    /**
     * @notice 注入做市资金：铸出等量 YES/NO 库存进池（1 份对 = 1 USDC）
     * @dev 这笔钱是做市方的对手盘风险，结算后不退还；剩余现金（cash - owed）由 admin
     *      扫给 treasury。允许在建盘后、结算前追加。
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

    /* ---------------------------- 交易 ---------------------------- */

    /**
     * @notice 买入份额
     * @param outcome 0 = NO, 1 = YES
     * @param amountIn 支付毛额（含 1.5% 抽成，抽成当场转给 FeeVault）
     * @param minSharesOut 滑点保护
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

        // 经济模型：net 拆成 net 对（net YES + net NO，1 对 = 1 USDC 抵押），
        // net NO 进池子，池子按 CPMM 放出 dy 份 YES —— 用户合计拿到 net + dy。
        // 这样 50% 概率下 1 USDC 能买到 ~2 份（赢则赔 ~2 倍），报价与赔付才一致。
        sharesOut = _applyBuy(m, marketId, outcome, net);

        if (sharesOut == 0) revert ZeroShares();
        if (sharesOut < minSharesOut) revert SlippageExceeded();

        // ---- 落账 + 事件 ----
        m.cash += net;
        m.totalVolume += amountIn;
        if (outcome == OUTCOME_YES) yesOf[marketId][msg.sender] += sharesOut;
        else noOf[marketId][msg.sender] += sharesOut;

        emit SharesBought(marketId, msg.sender, outcome, amountIn, fee, sharesOut, _priceYes(m));

        // ---- 外部调用放最后（CEI）----
        collateral.safeTransferFrom(msg.sender, address(this), amountIn);
        if (fee > 0) collateral.safeTransfer(feeVault, fee);
    }

    /**
     * @notice 卖出份额换回抵押品（同样收 1.5%）
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

        // 卖出 = 把 sharesIn 份 YES（或 NO）连同等量对手份额合并销毁（1 对 = 1 USDC），
        // 用户按本次成交的平均价拿走现金，价差留作池子（= 对手方）收益。
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

    /// @dev 买入的状态搬运：mint net 对、池子放出 got、用户净得 net + got
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

    /// @dev 卖出报价：取「成交前价格 + 成交后价格」的中点，保证买一卖一必亏手续费
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

    /// @dev 卖出的状态搬运：双边供应各减 sharesIn，池子烧掉等量对手库存
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

    /* ---------------------------- 结算 ---------------------------- */

    /**
     * @notice 预言机裁定结果（必须已到结算时间）
     * @param outcome 0 = NO, 1 = YES, 2 = INVALID（各赔 0.5）
     * @dev 结算瞬间把池内库存作废，并把「用户侧份额应得的赔付」定死进 owed。
     */
    function resolveMarket(bytes32 marketId, uint8 outcome) external onlyOracle {
        Market storage m = _market(marketId);
        if (m.resolved) revert MarketResolvedAlready();
        if (block.timestamp < m.resolutionTime) revert TooEarlyToResolve();
        if (outcome > OUTCOME_INVALID) revert InvalidOutcome();

        _settle(marketId, m, outcome, false);
    }

    /**
     * @notice 超时兜底：结算时间 + 7 天仍未裁定，任何人可触发，按 0.5/0.5 退款
     */
    function emergencyRefund(bytes32 marketId) external {
        Market storage m = _market(marketId);
        if (m.resolved) revert MarketResolvedAlready();
        if (block.timestamp < m.resolutionTime + REFUND_DELAY) revert RefundWindowNotReached();

        _settle(marketId, m, OUTCOME_INVALID, true);
    }

    function _settle(bytes32 marketId, Market storage m, uint8 outcome, bool emergency) internal {
        // 用户侧份额 = 总供应 - 池内库存（池内那部分属于做市方，结算即作废）。
        // 这两个数在结算瞬间快照下来，争议期内 admin 改判时用它重算 owed，
        // 避免「池内库存已清零」之后算出错误金额。
        uint256 userYes = yesSupply[marketId] - m.yesReserve;
        uint256 userNo = noSupply[marketId] - m.noReserve;

        m.resolved = true;
        m.outcome = outcome;
        m.yesUserAtSettle = userYes;
        m.noUserAtSettle = userNo;
        m.owed = _owedFor(m, outcome);
        m.yesReserve = 0;
        m.noReserve = 0;

        // A1：结算是资金安全的最后一道闸 —— 现金必须覆盖全部应付
        require(m.cash >= m.owed, "INSOLVENT");

        if (emergency) {
            // 超时退款是「兜底」：没有可争议的裁定，直接终结
            m.disputeEndsAt = uint64(block.timestamp);
            m.finalized = true;
        } else {
            m.disputeEndsAt = uint64(block.timestamp + DISPUTE_WINDOW);
            m.finalized = false;
        }

        emit MarketResolved(marketId, outcome, block.timestamp, emergency, m.owed);
        emit DisputeWindowOpened(marketId, outcome, m.disputeEndsAt, m.owed);
    }

    /// @dev 某个结果下应付总额（只由结算瞬间的用户份额决定）
    function _owedFor(Market storage m, uint8 outcome) internal view returns (uint256) {
        if (outcome == OUTCOME_INVALID) return (m.yesUserAtSettle + m.noUserAtSettle) / 2;
        if (outcome == OUTCOME_YES) return m.yesUserAtSettle;
        return m.noUserAtSettle;
    }

    /// @dev 是否已终结（争议期自然到期，或被显式终结）
    function _isFinal(Market storage m) internal view returns (bool) {
        if (!m.resolved) return false;
        return m.finalized || block.timestamp >= m.disputeEndsAt;
    }

    /**
     * @notice 争议期内一键改判（仅 admin / Safe 多签）
     * @dev 争议期内 redeem 全封，因此 owed 可以被安全重算；改判后仍强制 cash >= owed。
     *      窗口不因改判而延长，避免 admin 无限拖延。
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
     * @notice 争议期结束后把盘口标记为终结（任何人可调，只为给索引器一条明确日志）
     * @dev 赎回不依赖它 —— 到期后 redeem 自动可用的判断基于时间戳，不存在「没人调就卡死」。
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
     * @notice 兑换：赢家按 1.0 赔付并扣 0.5%；INVALID 下 YES/NO 各赔 0.5、不收费
     */
    function redeem(bytes32 marketId)
        external
        nonReentrant
        redeemGuard(marketId)
        returns (uint256 payout, uint256 fee)
    {
        Market storage m = _market(marketId);
        if (!m.resolved) revert NotResolved();
        // 争议缓冲期：结果可能被 Safe 覆盖，此时提现会把钱按错的结果付出去
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

        // ---- 落账：份额清零、owed 递减、cash 递减 ----
        yesOf[marketId][msg.sender] = 0;
        noOf[marketId][msg.sender] = 0;
        m.owed -= gross;
        m.cash -= gross;

        emit Redeemed(marketId, msg.sender, yesBal, noBal, payout, fee);

        if (fee > 0) collateral.safeTransfer(feeVault, fee);
        if (payout > 0) collateral.safeTransfer(msg.sender, payout);
    }

    /**
     * @notice 扫走做市残余（= cash - owed），只能进 treasury
     * @dev 永远动不到「已承诺但未领取」的那一份；结算前不可调用。
     */
    function sweepResidual(bytes32 marketId) external onlyAdmin nonReentrant returns (uint256 amount) {
        Market storage m = _market(marketId);
        if (!m.resolved) revert NotResolved();
        // 争议期内 owed 还可能变，先扫走会让账面失去 owed 兜底
        if (!_isFinal(m)) revert DisputeWindowOpen();

        amount = m.cash - m.owed;
        if (amount == 0) revert NothingToSweep();

        m.cash -= amount;
        emit ResidualSwept(marketId, treasury, amount);
        collateral.safeTransfer(treasury, amount);
    }

    /* ---------------------------- 管理 ---------------------------- */

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

    /* ---------------------------- 视图 ---------------------------- */

    function marketCount() external view returns (uint256) {
        return marketIds.length;
    }

    /// @notice 单个盘口的数值快照（字符串另用 marketQuestion / marketCategory 取）
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

    /// @notice YES 价格（1e18）
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

    /// @notice 结算后可扫的残余（cash - owed）；争议期内恒为 0
    function sweepable(bytes32 marketId) external view returns (uint256) {
        Market storage m = markets[marketId];
        if (!_isFinal(m)) return 0;
        return m.cash - m.owed;
    }

    /**
     * @notice 裁决与争议状态一次读完（前端/大脑/索引器用）
     * @return resolved 是否已有裁定（含争议中）
     * @return finalized 是否已终结（可提现）
     * @return disputing 是否正处在争议缓冲期
     * @return outcome 当前结果（0 NO / 1 YES / 2 INVALID）
     * @return disputeEndsAt 争议期结束时间戳（0 = 未裁决）
     * @return owed 当前应付总额
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

    /// @notice 是否已经可以提现
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
