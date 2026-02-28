// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {ExpressiveLending} from "../src/ExpressiveLending.sol";
import {IOracle} from "../src/IOracle.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Testnet mock contracts
// ─────────────────────────────────────────────────────────────────────────────

contract MockERC20 is ERC20 {
    uint8 private _dec;

    constructor(string memory name, string memory symbol, uint8 decimals_)
        ERC20(name, symbol)
    {
        _dec = decimals_;
    }

    function decimals() public view override returns (uint8) { return _dec; }

    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockOracle is IOracle {
    uint256 private _price;

    /// @param price  Value of 1 whole collateral token in borrow-asset wei.
    ///               E.g. WBTC/USDC: 80_000 * 1e6 = 80_000_000_000
    constructor(uint256 price) { _price = price; }

    function getPrice() external view returns (uint256) { return _price; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Deployment script
// ─────────────────────────────────────────────────────────────────────────────

contract Deploy is Script {
    // ── Protocol parameters ──────────────────────────────────────────────────
    uint256 constant BATCH_WINDOW      = 30;   // seconds (fast on Monad ~1s blocks)
    uint256 constant SOLVER_FEE_RATE   = 10;   // 0.10% in basis points
    uint256 constant LIQUIDATION_BONUS = 500;  // 5.00% in basis points

    // ── Testnet oracle prices (in USDC, 6 decimals) ──────────────────────────
    uint256 constant WBTC_PRICE_USDC = 80_000 * 1e6;  // $80,000 per BTC
    uint256 constant WETH_PRICE_USDC =  3_000 * 1e6;  // $ 3,000 per ETH

    // ── Testnet faucet amounts minted to deployer ─────────────────────────────
    uint256 constant USDC_MINT = 10_000_000 * 1e6;  // 10 000 000 USDC
    uint256 constant WBTC_MINT =         100 * 1e8;  //        100 WBTC
    uint256 constant WETH_MINT =      10_000 * 1e18; //     10 000 WETH

    function run() external returns (
        MockERC20         usdc,
        MockERC20         wbtc,
        MockERC20         weth,
        MockOracle        wbtcOracle,
        MockOracle        wethOracle,
        ExpressiveLending protocol
    ) {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");

        vm.startBroadcast();

        // ── 1. Mock tokens ────────────────────────────────────────────────────
        usdc = new MockERC20("USD Coin",        "USDC", 6);
        wbtc = new MockERC20("Wrapped Bitcoin", "WBTC", 8);
        weth = new MockERC20("Wrapped Ether",   "WETH", 18);

        // ── 2. Mock oracles ───────────────────────────────────────────────────
        wbtcOracle = new MockOracle(WBTC_PRICE_USDC);
        wethOracle = new MockOracle(WETH_PRICE_USDC);

        // ── 3. Protocol ───────────────────────────────────────────────────────
        address[] memory collateralAssets = new address[](2);
        collateralAssets[0] = address(wbtc);
        collateralAssets[1] = address(weth);

        address[] memory borrowAssets = new address[](1);
        borrowAssets[0] = address(usdc);

        address[] memory oracles = new address[](2);
        oracles[0] = address(wbtcOracle);
        oracles[1] = address(wethOracle);

        protocol = new ExpressiveLending(
            BATCH_WINDOW,
            SOLVER_FEE_RATE,
            LIQUIDATION_BONUS,
            collateralAssets,
            borrowAssets,
            oracles
        );

        // ── 4. Faucet: mint test tokens to deployer ───────────────────────────
        usdc.mint(deployer, USDC_MINT);
        wbtc.mint(deployer, WBTC_MINT);
        weth.mint(deployer, WETH_MINT);

        vm.stopBroadcast();

        // ── 5. Write deployment artifact ──────────────────────────────────────
        // Written to <repo-root>/deployments/<chainId>.json so that the
        // frontend (app/) and backend can both import it from a known path.
        _writeDeployment(deployer, usdc, wbtc, weth, wbtcOracle, wethOracle, protocol);

        // ── 6. Console summary ────────────────────────────────────────────────
        console.log("=== Expressive Lending Testnet Deployment ===");
        console.log("");
        console.log("USDC        :", address(usdc));
        console.log("WBTC        :", address(wbtc));
        console.log("WETH        :", address(weth));
        console.log("WBTC Oracle :", address(wbtcOracle));
        console.log("WETH Oracle :", address(wethOracle));
        console.log("Protocol    :", address(protocol));
        console.log("");
        console.log("Chain ID    :", block.chainid);
        console.log("Deployer    :", deployer);
    }

    // ── Writes <repo-root>/deployments/<chainId>.json ─────────────────────────
    // The JSON is consumed by the frontend and backend via a direct import or
    // by reading the file path CONTRACT_ADDRESS from the file at startup.
    //
    // Shape:
    // {
    //   "chainId":     10143,
    //   "network":     "monad_testnet",
    //   "deployer":    "0x...",
    //   "protocol":    "0x...",
    //   "tokens":    { "USDC": "0x...", "WBTC": "0x...", "WETH": "0x..." },
    //   "oracles":   { "WBTC": "0x...", "WETH": "0x..." }
    // }
    function _writeDeployment(
        address           deployer,
        MockERC20         usdc,
        MockERC20         wbtc,
        MockERC20         weth,
        MockOracle        wbtcOracle,
        MockOracle        wethOracle,
        ExpressiveLending protocol
    ) internal {
        // Build "tokens" sub-object
        string memory tokens = "tokens";
        vm.serializeAddress(tokens, "USDC", address(usdc));
        vm.serializeAddress(tokens, "WBTC", address(wbtc));
        string memory tokensJson = vm.serializeAddress(tokens, "WETH", address(weth));

        // Build "oracles" sub-object
        string memory oracles = "oracles";
        vm.serializeAddress(oracles, "WBTC", address(wbtcOracle));
        string memory oraclesJson = vm.serializeAddress(oracles, "WETH", address(wethOracle));

        // Build root object
        string memory root = "root";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeString(root, "network", _networkName(block.chainid));
        vm.serializeAddress(root, "deployer", deployer);
        vm.serializeAddress(root, "protocol", address(protocol));
        vm.serializeString(root, "tokens", tokensJson);
        string memory json = vm.serializeString(root, "oracles", oraclesJson);

        // Write to <repo-root>/deployments/<chainId>.json
        // vm.projectRoot() returns the contracts/ directory; go one level up.
        string memory path = string(abi.encodePacked(
            vm.projectRoot(), "/../deployments/",
            vm.toString(block.chainid), ".json"
        ));
        vm.writeJson(json, path);
        console.log("Deployment artifact written to:", path);
    }

    function _networkName(uint256 chainId) internal pure returns (string memory) {
        if (chainId == 10143) return "monad_testnet";
        if (chainId == 31337) return "anvil";
        return "unknown";
    }
}
