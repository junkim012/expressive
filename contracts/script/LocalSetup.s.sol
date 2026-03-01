// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {ExpressiveLending} from "src/ExpressiveLending.sol";
import {IOracle} from "src/IOracle.sol";
import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Test doubles (same as unit test suite)
// ─────────────────────────────────────────────────────────────────────────────

contract MockERC20 is ERC20 {
    uint8 private _dec;
    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) { _dec = d; }
    function decimals() public view override returns (uint8) { return _dec; }
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

contract MockOracle is IOracle {
    uint256 public price;
    constructor(uint256 p) { price = p; }
    function setPrice(uint256 p) external { price = p; }
    function getPrice() external view returns (uint256) { return price; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Deploy script
// Run from contracts/: forge script script/LocalSetup.s.sol --rpc-url http://localhost:8545 --broadcast
// Output written to ../deployments/local.json (repo root)
// ─────────────────────────────────────────────────────────────────────────────

contract LocalSetup is Script {
    // Anvil deterministic accounts
    uint256 constant DEPLOYER_KEY   = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant LENDER1_KEY    = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 constant LENDER2_KEY    = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
    uint256 constant BORROWER_KEY   = 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6;
    uint256 constant LIQUIDATOR_KEY = 0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba;

    address constant LENDER1    = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address constant LENDER2    = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
    address constant BORROWER   = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;
    address constant LIQUIDATOR = 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc;

    function run() external {
        // ── Deploy tokens and protocol ────────────────────────────────────────
        vm.startBroadcast(DEPLOYER_KEY);

        MockERC20 usdc = new MockERC20("USD Coin",    "USDC", 6);
        MockERC20 wbtc = new MockERC20("Wrapped BTC", "WBTC", 8);
        MockERC20 weth = new MockERC20("Wrapped ETH", "WETH", 18);

        // Oracle price convention: price * collateralAmountWei / 10**collateralDecimals = USDC value
        MockOracle btcOracle = new MockOracle(80_000e6); // 80 000 USDC / BTC
        MockOracle ethOracle = new MockOracle(3_000e6);  //  3 000 USDC / ETH

        address[] memory collaterals = new address[](2);
        collaterals[0] = address(wbtc);
        collaterals[1] = address(weth);

        address[] memory borrows = new address[](1);
        borrows[0] = address(usdc);

        address[] memory oracles = new address[](2);
        oracles[0] = address(btcOracle);
        oracles[1] = address(ethOracle);

        ExpressiveLending protocol = new ExpressiveLending(
            30,   // batchWindowSeconds
            10,   // solverFeeRate (0.10 bps)
            500,  // liquidationBonusRate (5%)
            collaterals,
            borrows,
            oracles
        );

        // Fund participants
        usdc.mint(LENDER1,    10_000e6);
        usdc.mint(LENDER2,    10_000e6);
        usdc.mint(LIQUIDATOR, 50_000e6);
        wbtc.mint(BORROWER,   5e8);       // 5 BTC
        weth.mint(BORROWER,   50 ether);

        vm.stopBroadcast();

        // ── Approvals (each user approves max to protocol) ────────────────────
        vm.startBroadcast(LENDER1_KEY);
        usdc.approve(address(protocol), type(uint256).max);
        vm.stopBroadcast();

        vm.startBroadcast(LENDER2_KEY);
        usdc.approve(address(protocol), type(uint256).max);
        vm.stopBroadcast();

        vm.startBroadcast(BORROWER_KEY);
        wbtc.approve(address(protocol), type(uint256).max);
        weth.approve(address(protocol), type(uint256).max);
        usdc.approve(address(protocol), type(uint256).max); // for repayment
        vm.stopBroadcast();

        vm.startBroadcast(LIQUIDATOR_KEY);
        usdc.approve(address(protocol), type(uint256).max);
        vm.stopBroadcast();

        // ── Write deployment output ───────────────────────────────────────────
        // Path is relative to the foundry project root (contracts/).
        // ../deployments/ is allowed by fs_permissions in foundry.toml.
        string memory json = "local";
        vm.serializeAddress(json, "usdc",      address(usdc));
        vm.serializeAddress(json, "wbtc",      address(wbtc));
        vm.serializeAddress(json, "weth",      address(weth));
        vm.serializeAddress(json, "btcOracle", address(btcOracle));
        vm.serializeAddress(json, "ethOracle", address(ethOracle));
        vm.serializeAddress(json, "protocol",  address(protocol));
        string memory out = vm.serializeUint(json, "startBlock", block.number);
        vm.writeJson(out, "../deployments/local.json");

        console.log("=== LocalSetup deployed ===");
        console.log("USDC:        ", address(usdc));
        console.log("WBTC:        ", address(wbtc));
        console.log("WETH:        ", address(weth));
        console.log("BTC oracle:  ", address(btcOracle));
        console.log("ETH oracle:  ", address(ethOracle));
        console.log("Protocol:    ", address(protocol));
        console.log("Start block: ", block.number);
        console.log("Output:       deployments/local.json");
    }
}
