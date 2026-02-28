// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Price oracle interface. Every whitelisted collateral asset maps to one oracle.
/// getPrice() returns the price of 1 unit of collateral expressed in borrow-asset units,
/// scaled by 10**collateralDecimals. That is:
///   collateralValueInBorrowWei = price * collateralAmountWei / 10**collateralDecimals
interface IOracle {
    function getPrice() external view returns (uint256 price);
}
