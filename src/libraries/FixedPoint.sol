// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title FixedPoint
 * @notice 定点数运算库。所有舍入方向都显式命名，禁止依赖隐式除法，
 *         以避免"用户多拿 1 wei"这类累积性精度攻击。
 *
 * 约定：
 *  - *Down 系列：向下取整（对协议有利，用户少拿）
 *  - *Up   系列：向上取整（对协议有利，用户多付）
 *  - 任何给用户结算的路径必须用 Down；任何向用户收费的路径必须用 Up。
 */
library FixedPoint {
    /// @notice 基点分母（100% = 10_000）
    uint256 internal constant BPS = 10_000;

    /// @notice a * b / d，向下取整；d == 0 时返回 0（调用方必须先校验）
    function mulDivDown(uint256 a, uint256 b, uint256 d) internal pure returns (uint256) {
        if (d == 0) return 0;
        return Math.mulDiv(a, b, d, Math.Rounding.Floor);
    }

    /// @notice a * b / d，向上取整
    function mulDivUp(uint256 a, uint256 b, uint256 d) internal pure returns (uint256) {
        if (d == 0) return 0;
        return Math.mulDiv(a, b, d, Math.Rounding.Ceil);
    }

    /// @notice 取 value 的 bps 基点，向上取整（用于向用户收费）
    function bpsUp(uint256 value, uint256 bps) internal pure returns (uint256) {
        return mulDivUp(value, bps, BPS);
    }
}
