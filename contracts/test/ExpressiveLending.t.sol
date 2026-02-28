// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {ExpressiveLending} from "../src/ExpressiveLending.sol";
import {IOracle} from "../src/IOracle.sol";
import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Test doubles
// ─────────────────────────────────────────────────────────────────────────────

contract MockERC20 is ERC20 {
    uint8 private _dec;

    constructor(string memory name, string memory symbol, uint8 dec) ERC20(name, symbol) {
        _dec = dec;
    }

    function decimals() public view override returns (uint8) { return _dec; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockOracle is IOracle {
    uint256 public price;
    constructor(uint256 _price) { price = _price; }
    function setPrice(uint256 _price) external { price = _price; }
    function getPrice() external view returns (uint256) { return price; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main test contract
// ─────────────────────────────────────────────────────────────────────────────

contract ExpressiveLendingTest is Test {
    ExpressiveLending internal protocol;
    MockERC20         internal usdc;   // borrow asset  (6 decimals)
    MockERC20         internal wbtc;   // collateral    (8 decimals)
    MockERC20         internal weth;   // collateral    (18 decimals)
    MockOracle        internal btcOracle;
    MockOracle        internal ethOracle;

    address internal lender1  = address(0x1111);
    address internal lender2  = address(0x2222);
    address internal borrower = address(0x3333);
    address internal solver   = address(0x4444);
    address internal liquidator = address(0x5555);

    uint256 constant BATCH_WINDOW   = 30;
    uint256 constant SOLVER_FEE     = 10;    // 0.10% in bps
    uint256 constant LIQ_BONUS      = 500;   // 5% in bps

    // BTC price: 80 000 USDC per BTC.
    // Oracle: price * collateralAmount / 10**collateralDecimals = USDC value
    // So: price = 80_000 * 10**6 per 1e8 wbtc => price = 80_000e6 (since 1 BTC = 1e8 satoshi)
    // collateralValue = price * collateralAmount / 1e8
    //   = 80_000e6 * 1e8 / 1e8 = 80_000e6 USDC   ✓
    uint256 constant BTC_PRICE  = 80_000e6;   // 80k USDC per BTC; price has collateral(8) decimals scale

    // ETH price: 3 000 USDC per ETH.
    // collateralValue = price * collateralAmount / 1e18
    uint256 constant ETH_PRICE  = 3_000e6;    // price * 1e18 / 1e18 = 3_000e6 USDC per ETH

    function setUp() public {
        // Deploy mock tokens
        usdc = new MockERC20("USD Coin",  "USDC", 6);
        wbtc = new MockERC20("Wrapped BTC", "WBTC", 8);
        weth = new MockERC20("Wrapped ETH", "WETH", 18);

        // Deploy mock oracles
        btcOracle = new MockOracle(BTC_PRICE);
        ethOracle = new MockOracle(ETH_PRICE);

        // Whitelist assets
        address[] memory collaterals = new address[](2);
        collaterals[0] = address(wbtc);
        collaterals[1] = address(weth);

        address[] memory borrows = new address[](1);
        borrows[0] = address(usdc);

        address[] memory oracles = new address[](2);
        oracles[0] = address(btcOracle);
        oracles[1] = address(ethOracle);

        protocol = new ExpressiveLending(
            BATCH_WINDOW,
            SOLVER_FEE,
            LIQ_BONUS,
            collaterals,
            borrows,
            oracles
        );

        // Fund participants
        usdc.mint(lender1,   10_000e6);
        usdc.mint(lender2,   10_000e6);
        wbtc.mint(borrower,  2e8);       // 2 BTC
        weth.mint(borrower,  10 ether);

        vm.prank(lender1);  usdc.approve(address(protocol), type(uint256).max);
        vm.prank(lender2);  usdc.approve(address(protocol), type(uint256).max);
        vm.prank(borrower); wbtc.approve(address(protocol), type(uint256).max);
        vm.prank(borrower); weth.approve(address(protocol), type(uint256).max);
        vm.prank(borrower); usdc.approve(address(protocol), type(uint256).max);
        vm.prank(liquidator); usdc.approve(address(protocol), type(uint256).max);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helper: create a standard lend order
    // ─────────────────────────────────────────────────────────────────────────

    function _placeLendOrder(address lender, uint256 minRateBps, uint256 amount)
        internal returns (uint256)
    {
        address[] memory acceptable = new address[](2);
        acceptable[0] = address(wbtc);
        acceptable[1] = address(weth);

        vm.prank(lender);
        return protocol.placeLendOrder(
            address(usdc),
            acceptable,
            minRateBps,   // minRate
            7_000,        // maxLTV  70%
            365 days,     // maxDuration
            8_000,        // maxLLTV 80%
            amount
        );
    }

    // Helper: create a standard borrow order (BTC collateral)
    function _placeBorrowOrderBTC(address _borrower, uint256 maxRateBps, uint256 principalAmount)
        internal returns (uint256)
    {
        address[] memory cols = new address[](1);
        cols[0] = address(wbtc);

        // Post enough BTC to satisfy 65% LTV on the principal.
        // 65% LTV means collateral_value = principal / 0.65
        // collateral_value_usdc = principalAmount / 0.65
        // btc_needed = collateral_value / BTC_PRICE * 1e8
        // Simplify: post 1 BTC (= 80_000 USDC) collateral for 1000 USDC borrow → LTV = 1000/80000 = 1.25% << 65%
        // For tests we just post generous collateral.
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1e8; // 1 BTC

        vm.prank(_borrower);
        return protocol.placeBorrowOrder(
            address(usdc),
            cols,
            amounts,
            maxRateBps,   // maxRate
            5_000,        // minLTV  50%
            180 days,     // minDuration
            7_000,        // minLLTV 70%
            principalAmount,
            false
        );
    }

    // Build a single-pair batch submission.
    function _buildBatch(uint256 lId, uint256 bId, uint256 amount)
        internal pure returns (
            ExpressiveLending.Pair[] memory pairs,
            ExpressiveLending.Consumption[] memory consumptions
        )
    {
        pairs = new ExpressiveLending.Pair[](1);
        pairs[0] = ExpressiveLending.Pair({lendOrderId: lId, borrowOrderId: bId, amount: amount});

        // consumptions must be sorted by orderId
        consumptions = new ExpressiveLending.Consumption[](2);
        if (lId < bId) {
            consumptions[0] = ExpressiveLending.Consumption({orderId: lId, totalConsumed: amount});
            consumptions[1] = ExpressiveLending.Consumption({orderId: bId, totalConsumed: amount});
        } else {
            consumptions[0] = ExpressiveLending.Consumption({orderId: bId, totalConsumed: amount});
            consumptions[1] = ExpressiveLending.Consumption({orderId: lId, totalConsumed: amount});
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tests: order placement
    // ─────────────────────────────────────────────────────────────────────────

    function test_PlaceLendOrder() public {
        uint256 id = _placeLendOrder(lender1, 400, 1_000e6);
        assertEq(id, 0);
        assertEq(protocol.isLendOrder(0), true);

        ExpressiveLending.LendOrder memory lo = protocol.getLendOrder(0);
        assertEq(lo.owner, lender1);
        assertEq(lo.amount, 1_000e6);
        assertEq(lo.minRate, 400);
        assertEq(usdc.balanceOf(address(protocol)), 1_000e6);
    }

    function test_PlaceBorrowOrder() public {
        uint256 id = _placeBorrowOrderBTC(borrower, 700, 1_000e6);
        assertEq(id, 0);
        assertEq(protocol.isLendOrder(0), false);

        ExpressiveLending.BorrowOrder memory bo = protocol.getBorrowOrder(0);
        assertEq(bo.owner, borrower);
        assertEq(bo.amount, 1_000e6);
        assertEq(bo.maxRate, 700);
        assertEq(wbtc.balanceOf(address(protocol)), 1e8);
    }

    function test_PlaceLendOrder_revertsOnInvalidAsset() public {
        address[] memory acceptable = new address[](1);
        acceptable[0] = address(wbtc);
        vm.prank(lender1);
        vm.expectRevert(ExpressiveLending.InvalidBorrowAsset.selector);
        protocol.placeLendOrder(address(wbtc), acceptable, 400, 7_000, 365 days, 8_000, 1_000e6);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tests: batch auction
    // ─────────────────────────────────────────────────────────────────────────

    function test_SubmitAndExecuteBatch() public {
        uint256 lId = _placeLendOrder(lender1, 400, 1_000e6);
        uint256 bId = _placeBorrowOrderBTC(borrower, 700, 1_000e6);

        (ExpressiveLending.Pair[] memory pairs, ExpressiveLending.Consumption[] memory consumptions)
            = _buildBatch(lId, bId, 1_000e6);

        vm.prank(solver);
        protocol.submitBatch(pairs, consumptions);

        assertEq(protocol.currentWinner(), solver);
        assertGt(protocol.currentBestSurplus(), 0);

        // Advance time past window
        skip(BATCH_WINDOW + 1);

        uint256 borrowerUSDCBefore = usdc.balanceOf(borrower);
        uint256 solverUSDCBefore   = usdc.balanceOf(solver);

        vm.prank(solver);
        protocol.executeBatch();

        // Borrower received principal - fee
        uint256 fee       = 1_000e6 * SOLVER_FEE / 10_000;
        uint256 principal = 1_000e6 - fee;
        assertEq(usdc.balanceOf(borrower) - borrowerUSDCBefore, principal);
        assertEq(usdc.balanceOf(solver)   - solverUSDCBefore,   fee);

        // Loan created
        ExpressiveLending.Loan memory loan = protocol.getLoan(0);
        assertEq(loan.borrower, borrower);
        assertEq(loan.lender,   lender1);
        assertEq(loan.principal, principal);
        assertEq(uint8(loan.status), uint8(ExpressiveLending.LoanStatus.Active));

        // Rate = midpoint of 400 and 700 = 550 bps
        assertEq(loan.rate, 550);

        // Lender received NFT tokenId 0
        assertEq(protocol.ownerOf(0), lender1);
    }

    function test_SubmitBatch_revertsOnLowerSurplus() public {
        uint256 lId = _placeLendOrder(lender1, 400, 1_000e6);
        uint256 bId = _placeBorrowOrderBTC(borrower, 700, 1_000e6);

        (ExpressiveLending.Pair[] memory pairs, ExpressiveLending.Consumption[] memory consumptions)
            = _buildBatch(lId, bId, 1_000e6);

        vm.prank(solver);
        protocol.submitBatch(pairs, consumptions);

        // Same solver submits again with same batch → not higher surplus
        vm.prank(solver);
        vm.expectRevert(ExpressiveLending.SurplusNotHigher.selector);
        protocol.submitBatch(pairs, consumptions);
    }

    function test_SubmitBatch_revertsOnIncompatibleRate() public {
        // Lender wants minRate 800, borrower maxRate 600 → incompatible
        uint256 lId = _placeLendOrder(lender1, 800, 1_000e6);
        uint256 bId = _placeBorrowOrderBTC(borrower, 600, 1_000e6);

        (ExpressiveLending.Pair[] memory pairs, ExpressiveLending.Consumption[] memory consumptions)
            = _buildBatch(lId, bId, 1_000e6);

        vm.prank(solver);
        vm.expectRevert(ExpressiveLending.IncompatibleRate.selector);
        protocol.submitBatch(pairs, consumptions);
    }

    function test_ExecuteBatch_revertsWhileWindowOpen() public {
        vm.expectRevert(ExpressiveLending.WindowStillOpen.selector);
        protocol.executeBatch();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tests: loan repayment
    // ─────────────────────────────────────────────────────────────────────────

    function _createActiveLoan(uint256 lenderMinRate, uint256 borrowerMaxRate, uint256 amount)
        internal returns (uint256 loanId)
    {
        uint256 lId = _placeLendOrder(lender1, lenderMinRate, amount);
        uint256 bId = _placeBorrowOrderBTC(borrower, borrowerMaxRate, amount);

        (ExpressiveLending.Pair[] memory pairs, ExpressiveLending.Consumption[] memory consumptions)
            = _buildBatch(lId, bId, amount);

        vm.prank(solver);
        protocol.submitBatch(pairs, consumptions);

        skip(BATCH_WINDOW + 1);
        protocol.executeBatch();
        loanId = protocol.nextLoanId() - 1;
    }

    function test_Repay() public {
        uint256 loanId = _createActiveLoan(400, 700, 1_000e6);
        ExpressiveLending.Loan memory loan = protocol.getLoan(loanId);

        // Give borrower enough USDC to repay (they already received principal)
        uint256 interest = protocol.getAccruedInterest(loanId);
        uint256 total    = loan.principal + interest;
        usdc.mint(borrower, interest + 1e6); // buffer

        uint256 btcBefore = wbtc.balanceOf(borrower);

        vm.prank(borrower);
        protocol.repay(loanId);

        // Collateral returned
        assertEq(wbtc.balanceOf(borrower) - btcBefore, 1e8);

        // Loan status = Repaid
        assertEq(uint8(protocol.getLoan(loanId).status), uint8(ExpressiveLending.LoanStatus.Repaid));

        // NFT is redeemable
        uint256 tokenId = protocol.loanToNft(loanId);
        uint256 usdcBefore = usdc.balanceOf(lender1);
        vm.prank(lender1);
        protocol.redeem(tokenId);
        assertGe(usdc.balanceOf(lender1) - usdcBefore, loan.principal);
    }

    function test_Repay_revertsIfNotBorrower() public {
        uint256 loanId = _createActiveLoan(400, 700, 1_000e6);
        vm.prank(lender1);
        vm.expectRevert(ExpressiveLending.NotBorrower.selector);
        protocol.repay(loanId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tests: liquidation
    // ─────────────────────────────────────────────────────────────────────────

    function test_Liquidate_LLTVBreach() public {
        uint256 loanId = _createActiveLoan(400, 700, 1_000e6);

        // BTC crashes: drop price so collateral value < lltv * principal
        // loan.lltv = B.minLLTV = 70% = 7000 bps
        // loan.principal = 1_000e6 - fee ≈ 999e6
        // threshold = principal * lltv / 10000 ≈ 999e6 * 0.70 ≈ 699.3e6
        // collateral = 1 BTC; need oracle price such that 1 BTC < 699.3 USDC
        // price * 1e8 / 1e8 < 699.3e6  → price < 699.3e6
        btcOracle.setPrice(500e6); // BTC now worth 500 USDC → unhealthy

        address[] memory cols = new address[](1);
        cols[0] = address(wbtc);
        uint256[] memory amts = new uint256[](1);
        amts[0] = 1e8; // take all BTC

        usdc.mint(liquidator, 10_000e6);
        uint256 liqUSDCBefore = usdc.balanceOf(liquidator);
        uint256 liqBTCBefore  = wbtc.balanceOf(liquidator);

        vm.prank(liquidator);
        protocol.liquidate(loanId, cols, amts);

        // Liquidator received BTC
        assertEq(wbtc.balanceOf(liquidator) - liqBTCBefore, 1e8);

        // Liquidator paid some USDC
        assertLt(usdc.balanceOf(liquidator), liqUSDCBefore);

        // Loan closed
        assertEq(uint8(protocol.getLoan(loanId).status), uint8(ExpressiveLending.LoanStatus.Liquidated));
    }

    function test_Liquidate_revertsIfHealthy() public {
        uint256 loanId = _createActiveLoan(400, 700, 1_000e6);
        // Price unchanged → loan is healthy
        address[] memory cols = new address[](1);
        cols[0] = address(wbtc);
        uint256[] memory amts = new uint256[](1);
        amts[0] = 1e7; // try to take 0.1 BTC

        usdc.mint(liquidator, 1_000e6);
        vm.prank(liquidator);
        vm.expectRevert(ExpressiveLending.CollateralStillHealthy.selector);
        protocol.liquidate(loanId, cols, amts);
    }

    function test_Liquidate_postMaturityDefault() public {
        uint256 loanId = _createActiveLoan(400, 700, 1_000e6);
        ExpressiveLending.Loan memory loan = protocol.getLoan(loanId);

        // Warp past maturity
        skip(loan.duration + 1);

        address[] memory cols = new address[](1);
        cols[0] = address(wbtc);
        uint256[] memory amts = new uint256[](1);
        amts[0] = 1e8;

        usdc.mint(liquidator, 10_000e6);
        vm.prank(liquidator);
        protocol.liquidate(loanId, cols, amts);

        assertEq(uint8(protocol.getLoan(loanId).status), uint8(ExpressiveLending.LoanStatus.Liquidated));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tests: NFT token URI
    // ─────────────────────────────────────────────────────────────────────────

    function test_TokenURI_isOnChain() public {
        uint256 loanId = _createActiveLoan(400, 700, 1_000e6);
        uint256 tokenId = protocol.loanToNft(loanId);
        string memory uri = protocol.tokenURI(tokenId);
        // Should be a data URI
        assertEq(bytes(uri)[0], bytes("d")[0]);
        assertEq(bytes(uri)[1], bytes("a")[0]);
        assertEq(bytes(uri)[2], bytes("t")[0]);
        assertEq(bytes(uri)[3], bytes("a")[0]);
        assertTrue(bytes(uri).length > 100);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tests: multi-pair batch (worked example from spec)
    // ─────────────────────────────────────────────────────────────────────────

    function test_MultiPairBatch() public {
        // L1: min 4%  (400 bps)
        // L2: min 3.5% (350 bps)
        // B1: max 7%  (700 bps) — BTC collateral
        // B2: max 5%  (500 bps) — ETH collateral

        // Place L1
        address[] memory accL1 = new address[](2);
        accL1[0] = address(wbtc);
        accL1[1] = address(weth);
        vm.prank(lender1);
        uint256 l1 = protocol.placeLendOrder(address(usdc), accL1, 400, 7_000, 365 days, 8_000, 100e6);

        // Place L2
        address[] memory accL2 = new address[](1);
        accL2[0] = address(wbtc);
        vm.prank(lender2);
        uint256 l2 = protocol.placeLendOrder(address(usdc), accL2, 350, 7_000, 365 days, 8_000, 100e6);

        // Place B1 (BTC collateral)
        address[] memory colB1 = new address[](1);
        colB1[0] = address(wbtc);
        uint256[] memory amtB1 = new uint256[](1);
        amtB1[0] = 1e8;
        vm.prank(borrower);
        uint256 b1 = protocol.placeBorrowOrder(
            address(usdc), colB1, amtB1, 700, 5_000, 180 days, 7_000, 100e6, false
        );

        // Place B2 (ETH collateral) — borrower posts weth
        address[] memory colB2 = new address[](1);
        colB2[0] = address(weth);
        uint256[] memory amtB2 = new uint256[](1);
        amtB2[0] = 1 ether;
        vm.prank(borrower);
        uint256 b2 = protocol.placeBorrowOrder(
            address(usdc), colB2, amtB2, 500, 5_000, 180 days, 7_000, 100e6, false
        );

        // Optimal batch: (L2→B1, L1→B2) surplus = 3.5%*100 + 1%*100 = 4.5%*100
        // Sub-optimal:   (L1→B1)                    surplus = 3%*100  = 3%*100
        ExpressiveLending.Pair[] memory pairs = new ExpressiveLending.Pair[](2);
        pairs[0] = ExpressiveLending.Pair({lendOrderId: l2, borrowOrderId: b1, amount: 100e6});
        pairs[1] = ExpressiveLending.Pair({lendOrderId: l1, borrowOrderId: b2, amount: 100e6});

        // consumptions sorted by orderId: l1=0, l2=1, b1=2, b2=3
        ExpressiveLending.Consumption[] memory consumptions = new ExpressiveLending.Consumption[](4);
        uint256[] memory ids = new uint256[](4);
        ids[0] = l1; ids[1] = l2; ids[2] = b1; ids[3] = b2;
        // sort ids ascending
        for (uint256 i; i < 4; ++i) {
            for (uint256 j = i + 1; j < 4; ++j) {
                if (ids[i] > ids[j]) {
                    (ids[i], ids[j]) = (ids[j], ids[i]);
                }
            }
        }
        for (uint256 i; i < 4; ++i) {
            consumptions[i] = ExpressiveLending.Consumption({orderId: ids[i], totalConsumed: 100e6});
        }

        vm.prank(solver);
        protocol.submitBatch(pairs, consumptions);

        skip(BATCH_WINDOW + 1);
        protocol.executeBatch();

        // Two loans created
        assertEq(protocol.nextLoanId(), 2);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tests: markDefaulted
    // ─────────────────────────────────────────────────────────────────────────

    function test_MarkDefaulted() public {
        uint256 loanId = _createActiveLoan(400, 700, 1_000e6);
        ExpressiveLending.Loan memory loan = protocol.getLoan(loanId);

        skip(loan.duration + 1);
        protocol.markDefaulted(loanId);

        assertEq(uint8(protocol.getLoan(loanId).status), uint8(ExpressiveLending.LoanStatus.Defaulted));
    }

    function test_MarkDefaulted_revertsBeforeMaturity() public {
        uint256 loanId = _createActiveLoan(400, 700, 1_000e6);
        vm.expectRevert(ExpressiveLending.LoanNotMatured.selector);
        protocol.markDefaulted(loanId);
    }
}
