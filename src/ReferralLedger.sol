// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ReferralLedger
 * @notice Accrual and payout of affiliate rebates for the Aura prediction markets.
 *
 *  The engine routes the entire 1.5% trading fee to ProtocolFeeVault, whose recipient is immutable
 *  per deployment. Referral rebates are therefore settled here instead of inside the trading path:
 *  this ledger holds a rebate pool funded by the protocol, an off-chain indexer writes each
 *  attributed trade in (operator role), and referrers pull their balance whenever they want.
 *
 *  Why an operator-written ledger rather than an on-chain fee split:
 *   - the trading hot path stays untouched, so a bug here can never block or re-price a trade;
 *   - the referrer address travels in the order's calldata metadata, which the engine ignores, so
 *     attribution costs one address of calldata and no extra storage write per trade;
 *   - payouts are a pull pattern, so a broken referrer address cannot grief settlement.
 *
 *  Trust model: the operator can only *credit* an address, never debit one, and every credited
 *  trade is deduplicated by its tradeId. Misbehaviour is bounded to over-crediting — which is why
 *  the pool must be funded explicitly and claims revert when the pool is short.
 */
contract ReferralLedger is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice engine trading fee, mirrored from CentralPredictionEngine.TRADE_FEE_BPS (1.5%)
    uint16 public constant TRADE_FEE_BPS = 150;

    /// @notice hard ceiling on the referrer's share of that fee (50%): the protocol always keeps half
    uint16 public constant MAX_REBATE_BPS = 5_000;

    event ReferrerAccrued(
        bytes32 indexed tradeId,
        address indexed referrer,
        uint256 volume,
        uint256 rebate
    );
    event RebateClaimed(address indexed referrer, address indexed to, uint256 amount);
    event Funded(address indexed from, uint256 amount);
    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);
    event RebateBpsUpdated(uint16 oldBps, uint16 newBps);

    error ZeroAddress();
    error ZeroAmount();
    error NotOperator();
    error DuplicateTrade();
    error RebateTooHigh();
    error NothingToClaim();
    error InsufficientLiquidity();
    error RenounceDisabled();

    IERC20 public immutable collateral;

    /// @notice keeper/indexer allowed to write attributed trades
    address public operator;

    /// @notice referrer share of the trading fee, in basis points (2000 = 20% of the 1.5%)
    uint16 public rebateBps;

    /// @notice credited but unclaimed rebates per referrer
    mapping(address => uint256) public accrued;

    /// @notice lifetime claimed rebates per referrer (accounting only)
    mapping(address => uint256) public claimed;

    /// @notice tradeId => already credited, so a replayed batch cannot double-pay
    mapping(bytes32 => bool) public creditedTrade;

    uint256 public totalAccrued;
    uint256 public totalClaimed;

    constructor(address collateral_, address operator_, address owner_, uint16 rebateBps_) Ownable(owner_) {
        if (collateral_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        if (rebateBps_ > MAX_REBATE_BPS) revert RebateTooHigh();
        collateral = IERC20(collateral_);
        operator = operator_;
        rebateBps = rebateBps_;
        emit OperatorUpdated(address(0), operator_);
        emit RebateBpsUpdated(0, rebateBps_);
    }

    /* ------------------------------- admin ------------------------------- */

    /// @notice renounce disabled: a zero owner would permanently freeze the rebate parameters
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    /// @notice refuse transferring ownership to the zero address (Ownable2Step does not check itself)
    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        super.transferOwnership(newOwner);
    }

    /// @notice rotate the indexer key that writes attributed trades
    function setOperator(address operator_) external onlyOwner {
        emit OperatorUpdated(operator, operator_);
        operator = operator_;
    }

    /// @notice update the referrer share of the trading fee
    function setRebateBps(uint16 rebateBps_) external onlyOwner {
        if (rebateBps_ > MAX_REBATE_BPS) revert RebateTooHigh();
        emit RebateBpsUpdated(rebateBps, rebateBps_);
        rebateBps = rebateBps_;
    }

    /* ------------------------------- pool ------------------------------- */

    /// @notice move USDC into the rebate pool; caller must have approved this contract
    function fund(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        collateral.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    /**
     * @notice credit the referrer of a settled trade (operator only)
     * @param tradeId  unique id of the trade (engine tx hash, or tx hash + log index) — deduplicated
     * @param referrer address carried in the order metadata; zero address is skipped off-chain
     * @param volume   traded volume in USDC base units (6 decimals)
     * @return rebate  amount credited to the referrer
     */
    function accrue(bytes32 tradeId, address referrer, uint256 volume)
        external
        returns (uint256 rebate)
    {
        if (msg.sender != operator) revert NotOperator();
        if (referrer == address(0)) revert ZeroAddress();
        if (volume == 0) revert ZeroAmount();
        if (creditedTrade[tradeId]) revert DuplicateTrade();

        // volume × fee × share, divided once at the end to keep precision
        rebate = (volume * TRADE_FEE_BPS * rebateBps) / (10_000 * 10_000);
        if (rebate == 0) revert ZeroAmount();

        creditedTrade[tradeId] = true;
        accrued[referrer] += rebate;
        totalAccrued += rebate;

        emit ReferrerAccrued(tradeId, referrer, volume, rebate);
    }

    /* ------------------------------- payout ------------------------------- */

    /// @notice claim the caller's accrued rebates
    function claim() external nonReentrant returns (uint256 amount) {
        amount = accrued[msg.sender];
        if (amount == 0) revert NothingToClaim();
        if (collateral.balanceOf(address(this)) < amount) revert InsufficientLiquidity();

        accrued[msg.sender] = 0;
        claimed[msg.sender] += amount;
        totalClaimed += amount;

        collateral.safeTransfer(msg.sender, amount);
        emit RebateClaimed(msg.sender, msg.sender, amount);
    }

    /// @notice claim on behalf of a referrer and pay out to another address (useful for smart accounts)
    function claimTo(address to) external nonReentrant returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        amount = accrued[msg.sender];
        if (amount == 0) revert NothingToClaim();
        if (collateral.balanceOf(address(this)) < amount) revert InsufficientLiquidity();

        accrued[msg.sender] = 0;
        claimed[msg.sender] += amount;
        totalClaimed += amount;

        collateral.safeTransfer(to, amount);
        emit RebateClaimed(msg.sender, to, amount);
    }

    /* -------------------------------- views -------------------------------- */

    /// @notice USDC a referrer can pull right now
    function claimable(address referrer) external view returns (uint256) {
        return accrued[referrer];
    }

    /// @notice USDC still available in the pool for outstanding claims
    function poolBalance() external view returns (uint256) {
        return collateral.balanceOf(address(this));
    }

    /// @notice rebate a given traded volume earns at the current parameters (preview for the UI)
    function rebateFor(uint256 volume) external view returns (uint256) {
        return (volume * TRADE_FEE_BPS * rebateBps) / (10_000 * 10_000);
    }
}
