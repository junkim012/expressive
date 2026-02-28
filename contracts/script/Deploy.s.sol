// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {ExpressiveLending} from "../src/ExpressiveLending.sol";

contract Deploy is Script {
    function run() external returns (ExpressiveLending protocol) {
        // ── Deployment parameters ───────────────────────────────────────────
        uint256 batchWindowSeconds   = 30;    // 30s windows on Monad
        uint256 solverFeeRate        = 10;    // 0.10% solver fee
        uint256 liquidationBonusRate = 500;   // 5% liquidation bonus

        // These must be real addresses on the target chain.
        // For local/Anvil testing, deploy mock ERC20s and oracles first.
        address[] memory collateralAssets = new address[](0);
        address[] memory borrowAssets     = new address[](0);
        address[] memory oracles          = new address[](0);

        vm.startBroadcast();
        protocol = new ExpressiveLending(
            batchWindowSeconds,
            solverFeeRate,
            liquidationBonusRate,
            collateralAssets,
            borrowAssets,
            oracles
        );
        vm.stopBroadcast();

        console.log("ExpressiveLending deployed at:", address(protocol));
    }
}
