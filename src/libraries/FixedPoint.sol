// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title FixedPoint
 * @notice Fixed-point maths. Every rounding direction is named explicitly and implicit division is
 *         banned, so "the user takes one extra wei" style cumulative precision attacks stay impossible.
 *
 * Conventions:
 *  - *Down: round down (protocol-favourable, the user receives less)
 *  - *Up:   round up   (protocol-favourable, the user pays more)
 *  - payouts must use Down; charges must use Up.
 */
library FixedPoint {
    /// @notice basis-point denominator (100% = 10_000)
    uint256 internal constant BPS = 10_000;

    /// @notice a * b / d rounded down; returns 0 when d == 0 (callers must validate first)
    function mulDivDown(uint256 a, uint256 b, uint256 d) internal pure returns (uint256) {
        if (d == 0) return 0;
        return Math.mulDiv(a, b, d, Math.Rounding.Floor);
    }

    /// @notice a * b / d rounded up
    function mulDivUp(uint256 a, uint256 b, uint256 d) internal pure returns (uint256) {
        if (d == 0) return 0;
        return Math.mulDiv(a, b, d, Math.Rounding.Ceil);
    }

    /// @notice bps of value, rounded up (used when charging the user)
    function bpsUp(uint256 value, uint256 bps) internal pure returns (uint256) {
        return mulDivUp(value, bps, BPS);
    }
}
