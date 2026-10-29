// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ProtocolFeeVault
 * @notice 平台手续费金库：接收交易费（1.5%）与结算费（0.5%）。
 *
 *  无人值守提现：autoDistributeFee() 允许**任何地址**触发，
 *  把金库内全部 USDC 一次性划转到管理员指定的 treasury 钱包。
 *  触发者既不获得任何权限，也不能指定收款地址 —— 收款地址只能是
 *  owner 预先设定的 treasury，因此"任何人可触发"不构成资金风险，
 *  只解决"管理员私钥不在线时费用无法结算"的运维问题。
 *
 *  所有权：OZ Ownable2Step（transferOwnership 只登记 pendingOwner，
 *  必须由新所有者 acceptOwnership 才生效），并关闭 renounceOwnership
 *  —— 误renounce 会让 setTreasury 永久失效、手续费永远打进旧地址。
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

    /// @notice 累计分发总额（仅统计）
    uint256 public totalDistributed;

    constructor(address collateral_, address treasury_, address owner_) Ownable(owner_) {
        if (collateral_ == address(0)) revert ZeroAddress();
        if (treasury_ == address(0)) revert ZeroAddress();
        collateral = IERC20(collateral_);
        treasury = treasury_;
        emit TreasuryUpdated(address(0), treasury_);
    }

    /// @notice 关闭 renounce：owner 归零会永久锁死 setTreasury
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    /// @notice 拒绝把所有权移交给零地址（Ownable2Step 自身不校验）
    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        super.transferOwnership(newOwner);
    }

    /// @notice 更新收款钱包（仅 owner）
    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, treasury_);
        treasury = treasury_;
    }

    /**
     * @notice 无人值守提现：任何人可调用，全部余额划转至 treasury
     * @dev 不引入任何参数，避免"调用者指定收款地址"的越权面
     */
    function autoDistributeFee() external nonReentrant returns (uint256 amount) {
        if (treasury == address(0)) revert TreasuryNotSet();
        amount = collateral.balanceOf(address(this));
        // 纯早退守卫：等于 0 才是"无事可做"，比较结果不影响任何状态分支，也无法被构造获利
        // slither-disable-next-line incorrect-equality
        if (amount == 0) revert NoFeesToDistribute();

        totalDistributed += amount;
        collateral.safeTransfer(treasury, amount);

        emit FeeDistributed(msg.sender, treasury, amount);
    }

    /// @notice 当前待分发金额
    function pendingFees() external view returns (uint256) {
        return collateral.balanceOf(address(this));
    }
}
