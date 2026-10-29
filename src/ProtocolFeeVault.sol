// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ProtocolFeeVault
 * @notice Protocol fee vault: collects the trading fee (1.5%) and the settlement fee (0.5%).
 *
 *  Unattended distribution: autoDistributeFee() may be called by **any address** and moves the whole
 *  USDC balance to the treasury wallet chosen by the admin.
 *  The caller gains no privilege and cannot choose the recipient — the recipient is always the
 *  treasury set by the owner, so "anyone can trigger" carries no fund risk; it only removes the
 *  operational dependency on the admin key being online.
 *
 *  Ownership: OZ Ownable2Step (transferOwnership only records pendingOwner, the new owner must call
 *  acceptOwnership), and renounceOwnership is disabled — an accidental renounce would permanently
 *  break setTreasury and pin fees to a stale address.
 */
contract ProtocolFeeVault is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    event FeeDistributed(address indexed caller, address indexed treasury, uint256 amount);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    error ZeroAddress();
    error NoFeesToDistribute();
    error TreasuryNotSet();
    error RenounceDisabled();

    IERC20 public immutable collateral;
    address public treasury;

    /// @notice cumulative distributed amount (accounting only)
    uint256 public totalDistributed;

    constructor(address collateral_, address treasury_, address owner_) Ownable(owner_) {
        if (collateral_ == address(0)) revert ZeroAddress();
        if (treasury_ == address(0)) revert ZeroAddress();
        collateral = IERC20(collateral_);
        treasury = treasury_;
        emit TreasuryUpdated(address(0), treasury_);
    }

    /// @notice renounce disabled: a zero owner would permanently lock setTreasury
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    /// @notice refuse transferring ownership to the zero address (Ownable2Step does not check itself)
    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        super.transferOwnership(newOwner);
    }

    /// @notice update the treasury wallet (owner only)
    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, treasury_);
        treasury = treasury_;
    }

    /**
     * @notice Unattended distribution: anyone may call, the full balance goes to treasury
     * @dev No parameters, so there is no "caller picks the recipient" surface
     */
    function autoDistributeFee() external nonReentrant returns (uint256 amount) {
        if (treasury == address(0)) revert TreasuryNotSet();
        amount = collateral.balanceOf(address(this));
        // pure early exit: only zero means nothing to do; the comparison cannot steer state or be gamed
        // slither-disable-next-line incorrect-equality
        if (amount == 0) revert NoFeesToDistribute();

        totalDistributed += amount;
        collateral.safeTransfer(treasury, amount);

        emit FeeDistributed(msg.sender, treasury, amount);
    }

    /// @notice amount currently pending distribution
    function pendingFees() external view returns (uint256) {
        return collateral.balanceOf(address(this));
    }
}
