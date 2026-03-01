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
// Deploy script  (single deployer broadcast — no multi-signer approvals)
// Approvals are done post-deploy via cast send in 02_deploy.sh.
//
// Run from contracts/: forge script script/LocalSetup.s.sol --rpc-url http://localhost:8545 --broadcast
// Output written to ../deployments/local.json (repo root)
// ─────────────────────────────────────────────────────────────────────────────

contract LocalSetup is Script {
    // Anvil deterministic account 0 (deployer)
    uint256 constant DEPLOYER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    address constant LENDER1    = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address constant LENDER2    = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
    address constant BORROWER   = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;
    address constant SOLVER     = 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65;
    address constant LIQUIDATOR = 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc;

    function run() external {
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

        // Fund all participants with generous amounts of every token.
        // Any address can act as lender or borrower from the UI.
        uint256 USDC_AMOUNT = 1_000_000e6;  // 1 000 000 USDC
        uint256 WBTC_AMOUNT = 100e8;         // 100 WBTC
        uint256 WETH_AMOUNT = 1_000 ether;   // 1 000 WETH

        usdc.mint(LENDER1,    USDC_AMOUNT); wbtc.mint(LENDER1,    WBTC_AMOUNT); weth.mint(LENDER1,    WETH_AMOUNT);
        usdc.mint(LENDER2,    USDC_AMOUNT); wbtc.mint(LENDER2,    WBTC_AMOUNT); weth.mint(LENDER2,    WETH_AMOUNT);
        usdc.mint(BORROWER,   USDC_AMOUNT); wbtc.mint(BORROWER,   WBTC_AMOUNT); weth.mint(BORROWER,   WETH_AMOUNT);
        usdc.mint(SOLVER,     USDC_AMOUNT); wbtc.mint(SOLVER,     WBTC_AMOUNT); weth.mint(SOLVER,     WETH_AMOUNT);
        usdc.mint(LIQUIDATOR, USDC_AMOUNT); wbtc.mint(LIQUIDATOR, WBTC_AMOUNT); weth.mint(LIQUIDATOR, WETH_AMOUNT);

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
