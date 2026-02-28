// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {ExpressiveLending} from "../../src/ExpressiveLending.sol";
import {IOracle} from "../../src/IOracle.sol";
import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Minimal test doubles
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
// Integration test suite
// ─────────────────────────────────────────────────────────────────────────────

/// @notice End-to-end integration tests for the Expressive Lending protocol.
///
/// Oracle price convention:
///   collateralValueInBorrowWei = price * collateralAmountWei / 10**collateralDecimals
///
/// Assets:
///   USDC  - borrow asset, 6 decimals
///   WBTC  - collateral, 8 decimals,  price = 80_000e6  (80 000 USDC/BTC)
///   WETH  - collateral, 18 decimals, price =  3_000e6  ( 3 000 USDC/ETH)
contract ProtocolIntegrationTest is Test {
    // ── Deployment params ────────────────────────────────────────────────────
    uint256 constant BATCH_WINDOW  = 30;
    uint256 constant SOLVER_FEE    = 10;   // 0.10 % in bps
    uint256 constant LIQ_BONUS     = 500;  // 5.00 % in bps
    uint256 constant BP            = 10_000;
    uint256 constant SECS_PER_YEAR = 365 days;

    uint256 constant BTC_PRICE = 80_000e6;
    uint256 constant ETH_PRICE =  3_000e6;

    // ── Actors ───────────────────────────────────────────────────────────────
    address lender1    = address(0x1001);
    address lender2    = address(0x1002);
    address borrower1  = address(0x2001);
    address borrower2  = address(0x2002);
    address solverA    = address(0x3001);
    address solverB    = address(0x3002);
    address liquidator = address(0x4001);
    address nftBuyer   = address(0x5001);

    // ── Contracts ────────────────────────────────────────────────────────────
    ExpressiveLending protocol;
    MockERC20 usdc;
    MockERC20 wbtc;
    MockERC20 weth;
    MockOracle btcOracle;
    MockOracle ethOracle;

    // ─────────────────────────────────────────────────────────────────────────
    // Setup
    // ─────────────────────────────────────────────────────────────────────────

    function setUp() public {
        usdc = new MockERC20("USD Coin",    "USDC", 6);
        wbtc = new MockERC20("Wrapped BTC", "WBTC", 8);
        weth = new MockERC20("Wrapped ETH", "WETH", 18);
        btcOracle = new MockOracle(BTC_PRICE);
        ethOracle = new MockOracle(ETH_PRICE);

        address[] memory collaterals = new address[](2);
        collaterals[0] = address(wbtc);
        collaterals[1] = address(weth);
        address[] memory borrows = new address[](1);
        borrows[0] = address(usdc);
        address[] memory oracles = new address[](2);
        oracles[0] = address(btcOracle);
        oracles[1] = address(ethOracle);

        protocol = new ExpressiveLending(
            BATCH_WINDOW, SOLVER_FEE, LIQ_BONUS,
            collaterals, borrows, oracles
        );

        usdc.mint(lender1,    500_000e6);
        usdc.mint(lender2,    500_000e6);
        usdc.mint(borrower1,  200_000e6);
        usdc.mint(borrower2,  200_000e6);
        usdc.mint(liquidator, 500_000e6);
        wbtc.mint(borrower1,  10e8);
        wbtc.mint(borrower2,  10e8);
        weth.mint(borrower1,  100 ether);
        weth.mint(borrower2,  100 ether);

        _approveAll(lender1);
        _approveAll(lender2);
        _approveAll(borrower1);
        _approveAll(borrower2);
        _approveAll(liquidator);
    }

    function _approveAll(address actor) internal {
        vm.startPrank(actor);
        usdc.approve(address(protocol), type(uint256).max);
        wbtc.approve(address(protocol), type(uint256).max);
        weth.approve(address(protocol), type(uint256).max);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Batch construction helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Build pairs + sorted consumptions from parallel arrays.
    function _buildBatch(
        uint256[] memory lIds,
        uint256[] memory bIds,
        uint256[] memory amounts
    )
        internal
        pure
        returns (
            ExpressiveLending.Pair[]        memory pairs,
            ExpressiveLending.Consumption[] memory consumptions
        )
    {
        uint256 n = lIds.length;
        pairs = new ExpressiveLending.Pair[](n);
        for (uint256 i; i < n; ++i) {
            pairs[i] = ExpressiveLending.Pair({
                lendOrderId:  lIds[i],
                borrowOrderId: bIds[i],
                amount:       amounts[i]
            });
        }

        // Aggregate: orderId -> totalConsumed
        uint256[] memory aggIds  = new uint256[](n * 2);
        uint256[] memory aggAmts = new uint256[](n * 2);
        uint256 unique;

        for (uint256 i; i < n; ++i) {
            unique = _upsert(aggIds, aggAmts, unique, lIds[i], amounts[i]);
            unique = _upsert(aggIds, aggAmts, unique, bIds[i], amounts[i]);
        }

        // Insertion sort ascending by orderId
        for (uint256 i = 1; i < unique; ++i) {
            uint256 keyId  = aggIds[i];
            uint256 keyAmt = aggAmts[i];
            uint256 j      = i;
            while (j > 0 && aggIds[j - 1] > keyId) {
                aggIds[j]  = aggIds[j - 1];
                aggAmts[j] = aggAmts[j - 1];
                --j;
            }
            aggIds[j]  = keyId;
            aggAmts[j] = keyAmt;
        }

        consumptions = new ExpressiveLending.Consumption[](unique);
        for (uint256 i; i < unique; ++i) {
            consumptions[i] = ExpressiveLending.Consumption({
                orderId:      aggIds[i],
                totalConsumed: aggAmts[i]
            });
        }
    }

    function _upsert(
        uint256[] memory ids,
        uint256[] memory amts,
        uint256 count,
        uint256 id,
        uint256 amount
    ) internal pure returns (uint256) {
        for (uint256 k; k < count; ++k) {
            if (ids[k] == id) {
                amts[k] += amount;
                return count;
            }
        }
        ids[count]  = id;
        amts[count] = amount;
        return count + 1;
    }

    // Convenience: single-pair batch
    function _buildBatch1(uint256 lId, uint256 bId, uint256 amount)
        internal pure returns (
            ExpressiveLending.Pair[]        memory pairs,
            ExpressiveLending.Consumption[] memory consumptions
        )
    {
        uint256[] memory l = new uint256[](1); l[0] = lId;
        uint256[] memory b = new uint256[](1); b[0] = bId;
        uint256[] memory a = new uint256[](1); a[0] = amount;
        return _buildBatch(l, b, a);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Interest helper (mirrors _accrued in the contract)
    // ─────────────────────────────────────────────────────────────────────────

    function _interest(uint256 principal, uint256 rateBps, uint256 elapsed)
        internal pure returns (uint256)
    {
        return (principal * rateBps / BP) * elapsed / SECS_PER_YEAR;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Submit + execute helper
    // ─────────────────────────────────────────────────────────────────────────

    function _submitAndExecute(
        uint256[] memory lIds,
        uint256[] memory bIds,
        uint256[] memory amounts,
        address solver
    ) internal {
        (ExpressiveLending.Pair[] memory pairs,
         ExpressiveLending.Consumption[] memory consumptions) = _buildBatch(lIds, bIds, amounts);
        vm.prank(solver);
        protocol.submitBatch(pairs, consumptions);
        skip(BATCH_WINDOW + 1);
        protocol.executeBatch();
    }

    // ═════════════════════════════════════════════════════════════════════════
    // TEST 1: Protocol Spec Worked Example — Optimal vs Suboptimal Matching
    //
    // Exact replication of 01_Protocol.md example:
    //   L1: minRate=400, accepts {BTC,ETH}, 100 USDC
    //   L2: minRate=350, accepts {BTC},     100 USDC
    //   B1: maxRate=700, BTC collateral,    100 USDC  -- spread vs L1 = 300, vs L2 = 350
    //   B2: maxRate=500, ETH collateral,    100 USDC  -- spread vs L1 = 100, vs L2 = INCOMPAT
    //
    // Optimal:    (L2->B1)+(L1->B2)  surplus = 350*100e6 + 100*100e6 = 45_000_000_000
    // Suboptimal: (L1->B1)           surplus = 300*100e6             = 30_000_000_000
    // ═════════════════════════════════════════════════════════════════════════
    function test_SpecExample_OptimalBeatsSuboptimal() public {
        uint256 AMOUNT = 100e6;

        // L1: accepts BTC and ETH
        address[] memory l1Col = new address[](2);
        l1Col[0] = address(wbtc);
        l1Col[1] = address(weth);
        vm.prank(lender1);
        uint256 l1 = protocol.placeLendOrder(
            address(usdc), l1Col, 400, 7_000, 730 days, 8_000, AMOUNT
        );

        // L2: accepts BTC only
        address[] memory l2Col = new address[](1);
        l2Col[0] = address(wbtc);
        vm.prank(lender2);
        uint256 l2 = protocol.placeLendOrder(
            address(usdc), l2Col, 350, 7_000, 730 days, 8_000, AMOUNT
        );

        // B1: BTC collateral
        address[] memory b1Col = new address[](1);
        b1Col[0] = address(wbtc);
        uint256[] memory b1Amt = new uint256[](1);
        b1Amt[0] = 2e8; // 2 BTC = 160 000 USDC >> 100 USDC principal
        vm.prank(borrower1);
        uint256 b1 = protocol.placeBorrowOrder(
            address(usdc), b1Col, b1Amt, 700, 6_500, 365 days, 7_500, AMOUNT, false
        );

        // B2: ETH collateral
        address[] memory b2Col = new address[](1);
        b2Col[0] = address(weth);
        uint256[] memory b2Amt = new uint256[](1);
        b2Amt[0] = 1 ether; // 1 ETH = 3 000 USDC >> 100 USDC principal
        vm.prank(borrower2);
        uint256 b2 = protocol.placeBorrowOrder(
            address(usdc), b2Col, b2Amt, 500, 7_000, 365 days, 7_500, AMOUNT, false
        );

        // ── Solver A submits suboptimal batch: L1->B1 (surplus = 300 * 100e6) ──
        {
            (ExpressiveLending.Pair[] memory pairs,
             ExpressiveLending.Consumption[] memory consumptions) = _buildBatch1(l1, b1, AMOUNT);
            vm.prank(solverA);
            protocol.submitBatch(pairs, consumptions);
        }
        assertEq(protocol.currentWinner(),      solverA,         "solverA leads");
        assertEq(protocol.currentBestSurplus(), 300 * AMOUNT,    "suboptimal surplus");

        // ── Solver B submits optimal batch: L2->B1 + L1->B2 ─────────────────
        {
            uint256[] memory l = new uint256[](2); l[0] = l2; l[1] = l1;
            uint256[] memory b = new uint256[](2); b[0] = b1; b[1] = b2;
            uint256[] memory a = new uint256[](2); a[0] = AMOUNT; a[1] = AMOUNT;
            (ExpressiveLending.Pair[] memory pairs,
             ExpressiveLending.Consumption[] memory consumptions) = _buildBatch(l, b, a);
            vm.prank(solverB);
            protocol.submitBatch(pairs, consumptions);
        }
        assertEq(protocol.currentWinner(),      solverB,              "solverB now leads");
        assertEq(protocol.currentBestSurplus(), 350*AMOUNT + 100*AMOUNT, "optimal surplus");

        // ── Equal-surplus resubmission rejected (tiebreaker: first wins) ─────
        {
            uint256[] memory l = new uint256[](2); l[0] = l2; l[1] = l1;
            uint256[] memory b = new uint256[](2); b[0] = b1; b[1] = b2;
            uint256[] memory a = new uint256[](2); a[0] = AMOUNT; a[1] = AMOUNT;
            (ExpressiveLending.Pair[] memory pairs,
             ExpressiveLending.Consumption[] memory consumptions) = _buildBatch(l, b, a);
            vm.prank(solverA);
            vm.expectRevert(ExpressiveLending.SurplusNotHigher.selector);
            protocol.submitBatch(pairs, consumptions);
        }

        // ── Execute and verify exact loan terms ──────────────────────────────
        skip(BATCH_WINDOW + 1);
        protocol.executeBatch();

        assertEq(protocol.nextLoanId(), 2, "two loans created");

        uint256 fee       = AMOUNT * SOLVER_FEE / BP;   // 100_000
        uint256 principal = AMOUNT - fee;               // 99_900_000

        // Loan 0: from the first pair executed (L2->B1)
        // Loan 1: from the second pair executed (L1->B2)
        // (Pairs are executed in submission order)
        bool loan0isL2B1;
        {
            ExpressiveLending.Loan memory loan0 = protocol.getLoan(0);
            if (loan0.lender == lender2) {
                loan0isL2B1 = true;
            }
        }

        uint256 loanL2B1 = loan0isL2B1 ? 0 : 1;
        uint256 loanL1B2 = loan0isL2B1 ? 1 : 0;

        // Verify L2->B1 loan: rate=(350+700)/2=525, ltv=6500, lltv=7500, dur=365d
        {
            ExpressiveLending.Loan memory loan = protocol.getLoan(loanL2B1);
            assertEq(loan.lender,    lender2,   "L2->B1: lender is lender2");
            assertEq(loan.borrower,  borrower1, "L2->B1: borrower is borrower1");
            assertEq(loan.principal, principal, "L2->B1: principal = amount - fee");
            assertEq(loan.rate,      525,       "L2->B1: rate = (350+700)/2 = 525");
            assertEq(loan.ltv,       6_500,     "L2->B1: ltv = B1.minLTV");
            assertEq(loan.lltv,      7_500,     "L2->B1: lltv = B1.minLLTV");
            assertEq(loan.duration,  365 days,  "L2->B1: duration = B1.minDuration");
            // Full borrow order filled -> all 2 BTC assigned
            assertEq(loan.collateralAmounts[0], 2e8, "L2->B1: all BTC in loan");
        }

        // Verify L1->B2 loan: rate=(400+500)/2=450, ltv=7000, lltv=7500, dur=365d
        {
            ExpressiveLending.Loan memory loan = protocol.getLoan(loanL1B2);
            assertEq(loan.lender,    lender1,   "L1->B2: lender is lender1");
            assertEq(loan.borrower,  borrower2, "L1->B2: borrower is borrower2");
            assertEq(loan.principal, principal, "L1->B2: principal = amount - fee");
            assertEq(loan.rate,      450,       "L1->B2: rate = (400+500)/2 = 450");
            assertEq(loan.ltv,       7_000,     "L1->B2: ltv = B2.minLTV");
            assertEq(loan.lltv,      7_500,     "L1->B2: lltv = B2.minLLTV");
            assertEq(loan.duration,  365 days,  "L1->B2: duration = B2.minDuration");
            // Full borrow order -> all 1 ETH assigned
            assertEq(loan.collateralAmounts[0], 1 ether, "L1->B2: all ETH in loan");
        }

        // filledAmounts
        assertEq(protocol.getLendOrder(l1).filledAmount,   AMOUNT, "L1 fully filled");
        assertEq(protocol.getLendOrder(l2).filledAmount,   AMOUNT, "L2 fully filled");
        assertEq(protocol.getBorrowOrder(b1).filledAmount, AMOUNT, "B1 fully filled");
        assertEq(protocol.getBorrowOrder(b2).filledAmount, AMOUNT, "B2 fully filled");

        // Solver B gets aggregate fee for both pairs (single transfer per borrow asset)
        uint256 expectedFee = 2 * fee;
        assertEq(usdc.balanceOf(solverB), expectedFee, "solverB gets aggregate 2-pair fee");
        assertEq(usdc.balanceOf(solverA), 0,           "solverA gets nothing");

        // Borrowers received principal
        assertEq(usdc.balanceOf(borrower1), 200_000e6 + principal, "borrower1 got principal");
        assertEq(usdc.balanceOf(borrower2), 200_000e6 + principal, "borrower2 got principal");

        // Window advanced
        assertEq(protocol.windowId(),        1, "window incremented to 1");
        assertEq(protocol.currentBestSurplus(), 0, "surplus reset");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // TEST 2: Partial Fill Across Two Batch Windows
    //
    // L1: 200 USDC lend order. Two separate 100 USDC borrow orders filled
    // across two consecutive windows. Verifies filledAmount tracking and that
    // collateral pro-ration is exact (matchAmount / totalOrderAmount).
    // ═════════════════════════════════════════════════════════════════════════
    function test_PartialFill_AcrossTwoBatchWindows() public {
        // L1: 200 USDC
        address[] memory lCol = new address[](1);
        lCol[0] = address(wbtc);
        vm.prank(lender1);
        uint256 l1 = protocol.placeLendOrder(
            address(usdc), lCol, 400, 7_000, 730 days, 8_000, 200e6
        );

        // B1: 100 USDC, posts 1 BTC
        address[] memory bCol = new address[](1);
        bCol[0] = address(wbtc);
        uint256[] memory bAmt = new uint256[](1);
        bAmt[0] = 1e8;
        vm.prank(borrower1);
        uint256 b1 = protocol.placeBorrowOrder(
            address(usdc), bCol, bAmt, 700, 5_000, 180 days, 7_000, 100e6, false
        );

        // B2: 100 USDC, posts 1 BTC
        bAmt[0] = 1e8;
        vm.prank(borrower2);
        uint256 b2 = protocol.placeBorrowOrder(
            address(usdc), bCol, bAmt, 600, 5_000, 90 days, 7_000, 100e6, false
        );

        // ── Window 1: match L1->B1 (100 USDC of L1's 200 USDC) ──────────────
        {
            (ExpressiveLending.Pair[] memory pairs,
             ExpressiveLending.Consumption[] memory consumptions) = _buildBatch1(l1, b1, 100e6);
            vm.prank(solverA);
            protocol.submitBatch(pairs, consumptions);
        }
        skip(BATCH_WINDOW + 1);
        protocol.executeBatch();

        assertEq(protocol.getLendOrder(l1).filledAmount, 100e6, "L1: 100e6 filled after W1");
        assertEq(protocol.nextLoanId(), 1, "one loan after W1");

        {
            ExpressiveLending.Loan memory loan = protocol.getLoan(0);
            uint256 fee       = 100e6 * SOLVER_FEE / BP;
            uint256 principal = 100e6 - fee;
            assertEq(loan.principal, principal,           "W1 loan principal");
            assertEq(loan.rate,      (400 + 700) / 2,    "W1 rate midpoint = 550");
            assertEq(loan.duration,  180 days,            "W1 duration = B1.minDuration");
            // B1 fully consumed (100e6 match / 100e6 total) -> all 1 BTC
            assertEq(loan.collateralAmounts[0], 1e8,      "W1 full BTC for fully-consumed B1");
        }

        // ── Window 2: match L1->B2 (remaining 100 USDC of L1) ───────────────
        {
            (ExpressiveLending.Pair[] memory pairs,
             ExpressiveLending.Consumption[] memory consumptions) = _buildBatch1(l1, b2, 100e6);
            vm.prank(solverA);
            protocol.submitBatch(pairs, consumptions);
        }
        skip(BATCH_WINDOW + 1);
        protocol.executeBatch();

        assertEq(protocol.getLendOrder(l1).filledAmount, 200e6, "L1: 200e6 filled after W2");
        assertEq(protocol.nextLoanId(), 2, "two loans after W2");

        {
            ExpressiveLending.Loan memory loan = protocol.getLoan(1);
            uint256 fee       = 100e6 * SOLVER_FEE / BP;
            uint256 principal = 100e6 - fee;
            assertEq(loan.principal, principal,           "W2 loan principal");
            assertEq(loan.rate,      (400 + 600) / 2,    "W2 rate midpoint = 500");
            assertEq(loan.duration,  90 days,             "W2 duration = B2.minDuration");
        }

        // Both lend-side NFTs belong to lender1
        assertEq(protocol.ownerOf(0), lender1, "NFT 0 -> lender1");
        assertEq(protocol.ownerOf(1), lender1, "NFT 1 -> lender1");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // TEST 3: FillOrKill Enforcement
    //
    // Per spec Pass 1: "if B.fillOrKill == true, assert amount == B.amount - B.filledAmount"
    // A partial match (amount < remaining) must revert. A full match succeeds.
    // After full fill, re-matching must fail (FoK violated or over-consumed).
    // ═════════════════════════════════════════════════════════════════════════
    function test_FillOrKill_Enforcement() public {
        address[] memory lCol = new address[](1);
        lCol[0] = address(wbtc);

        // L1: 200 USDC (can fill FoK fully)
        vm.prank(lender1);
        uint256 l1 = protocol.placeLendOrder(
            address(usdc), lCol, 300, 7_000, 730 days, 8_000, 200e6
        );

        // L2: 50 USDC (cannot fill FoK fully)
        vm.prank(lender2);
        uint256 l2 = protocol.placeLendOrder(
            address(usdc), lCol, 300, 7_000, 730 days, 8_000, 50e6
        );

        // B_fok: 100 USDC, fillOrKill = true
        address[] memory bCol = new address[](1);
        bCol[0] = address(wbtc);
        uint256[] memory bAmt = new uint256[](1);
        bAmt[0] = 1e8;
        vm.prank(borrower1);
        uint256 bFok = protocol.placeBorrowOrder(
            address(usdc), bCol, bAmt, 700, 5_000, 90 days, 7_000, 100e6, true
        );

        // Partial match via L2 (50e6 != 100e6 required) -> revert FillOrKillViolation
        {
            (ExpressiveLending.Pair[] memory pairs,
             ExpressiveLending.Consumption[] memory consumptions) = _buildBatch1(l2, bFok, 50e6);
            vm.prank(solverA);
            vm.expectRevert(ExpressiveLending.FillOrKillViolation.selector);
            protocol.submitBatch(pairs, consumptions);
        }

        // Full match via L1 (100e6 == 100e6) -> succeeds
        {
            (ExpressiveLending.Pair[] memory pairs,
             ExpressiveLending.Consumption[] memory consumptions) = _buildBatch1(l1, bFok, 100e6);
            vm.prank(solverA);
            protocol.submitBatch(pairs, consumptions);
            assertEq(protocol.currentWinner(), solverA, "FoK full match accepted");
        }

        skip(BATCH_WINDOW + 1);
        protocol.executeBatch();
        assertEq(protocol.getBorrowOrder(bFok).filledAmount, 100e6, "FoK fully filled");

        // Trying to re-match the FoK order (filledAmount == amount -> remaining = 0)
        // Per FoK check: 0 == amount = 0, but amount in pair must be > 0 -> ZeroAmount
        // OR if amount > 0: FoK check fails (p.amount != 0 remaining)
        {
            (ExpressiveLending.Pair[] memory pairs,
             ExpressiveLending.Consumption[] memory consumptions) = _buildBatch1(l1, bFok, 1e6);
            vm.prank(solverA);
            vm.expectRevert(ExpressiveLending.FillOrKillViolation.selector);
            protocol.submitBatch(pairs, consumptions);
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // TEST 4: Exact Repayment Arithmetic
    //
    // Creates a loan with known terms, waits exactly 180 days, and verifies:
    //   interest = (principal * rate / 10000) * elapsed / SECS_PER_YEAR
    //   lender receives exactly principal + interest on redemption
    // ═════════════════════════════════════════════════════════════════════════
    function test_ExactRepaymentArithmetic() public {
        uint256 AMOUNT = 100e6;

        address[] memory lCol = new address[](1);
        lCol[0] = address(wbtc);
        vm.prank(lender1);
        uint256 l1 = protocol.placeLendOrder(
            address(usdc), lCol, 400, 7_000, 730 days, 8_000, AMOUNT
        );
        address[] memory bCol = new address[](1);
        bCol[0] = address(wbtc);
        uint256[] memory bAmt = new uint256[](1);
        bAmt[0] = 1e8;
        vm.prank(borrower1);
        uint256 b1 = protocol.placeBorrowOrder(
            address(usdc), bCol, bAmt, 700, 5_000, 180 days, 7_000, AMOUNT, false
        );

        {
            (ExpressiveLending.Pair[] memory pairs,
             ExpressiveLending.Consumption[] memory consumptions) = _buildBatch1(l1, b1, AMOUNT);
            vm.prank(solverA);
            protocol.submitBatch(pairs, consumptions);
        }
        skip(BATCH_WINDOW + 1);
        protocol.executeBatch();

        ExpressiveLending.Loan memory loan = protocol.getLoan(0);

        // Derived expected values
        uint256 fee       = AMOUNT * SOLVER_FEE / BP;    // 100_000
        uint256 principal = AMOUNT - fee;                 // 99_900_000
        uint256 rate      = (400 + 700) / 2;              // 550 bps

        assertEq(loan.principal, principal, "principal correct");
        assertEq(loan.rate,      rate,      "rate is midpoint");

        // Advance exactly 180 days
        skip(180 days);

        // Expected interest: (principal * rate / BP) * elapsed / SECS_PER_YEAR
        uint256 expectedInterest = _interest(principal, rate, 180 days);
        uint256 expectedTotal    = principal + expectedInterest;

        // View function matches
        assertEq(protocol.getAccruedInterest(0), expectedInterest, "view: accrued interest");

        // Snapshot balances
        uint256 borrowerUSDCBefore = usdc.balanceOf(borrower1);
        uint256 borrowerBTCBefore  = wbtc.balanceOf(borrower1);
        uint256 contractUSDCBefore = usdc.balanceOf(address(protocol));

        // Borrower repays
        vm.prank(borrower1);
        protocol.repay(0);

        // Borrower paid exact amount
        assertEq(
            borrowerUSDCBefore - usdc.balanceOf(borrower1),
            expectedTotal,
            "borrower paid exact repayment"
        );

        // Contract received repayment
        assertEq(
            usdc.balanceOf(address(protocol)) - contractUSDCBefore,
            expectedTotal,
            "contract holds repayment"
        );

        // WBTC collateral returned to borrower
        assertEq(wbtc.balanceOf(borrower1) - borrowerBTCBefore, 1e8, "BTC returned");

        // Status = Repaid
        assertEq(uint8(protocol.getLoan(0).status), uint8(ExpressiveLending.LoanStatus.Repaid));

        // Lender redeems NFT, gets exactly principal + interest
        uint256 lenderBefore = usdc.balanceOf(lender1);
        vm.prank(lender1);
        protocol.redeem(0);
        assertEq(
            usdc.balanceOf(lender1) - lenderBefore,
            expectedTotal,
            "lender redeems exact amount"
        );

        // NFT burned: ownerOf reverts
        vm.expectRevert();
        protocol.ownerOf(0);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // TEST 5: No Grace Period — Repayment Blocked After Maturity
    //
    // Bug fix: repay() must revert with LoanMatured if block.timestamp >= maturityDate.
    // markDefaulted must succeed, and liquidation must work in Defaulted state.
    // ═════════════════════════════════════════════════════════════════════════
    function test_NoGracePeriod_RepayBlockedAfterMaturity() public {
        address[] memory lCol = new address[](1);
        lCol[0] = address(wbtc);
        vm.prank(lender1);
        uint256 l1 = protocol.placeLendOrder(
            address(usdc), lCol, 400, 7_000, 730 days, 8_000, 100e6
        );
        address[] memory bCol = new address[](1);
        bCol[0] = address(wbtc);
        uint256[] memory bAmt = new uint256[](1);
        bAmt[0] = 1e8;
        vm.prank(borrower1);
        uint256 b1 = protocol.placeBorrowOrder(
            address(usdc), bCol, bAmt, 700, 5_000, 90 days, 7_000, 100e6, false
        );
        {
            (ExpressiveLending.Pair[] memory pairs,
             ExpressiveLending.Consumption[] memory consumptions) = _buildBatch1(l1, b1, 100e6);
            vm.prank(solverA);
            protocol.submitBatch(pairs, consumptions);
        }
        skip(BATCH_WINDOW + 1);
        protocol.executeBatch();

        // Before maturity: repay is fine
        // (we don't actually repay here, just confirm it would not revert yet)

        // Advance past maturity
        ExpressiveLending.Loan memory loan = protocol.getLoan(0);
        skip(loan.duration + 1);

        // Repayment now blocked
        vm.prank(borrower1);
        vm.expectRevert(ExpressiveLending.LoanMatured.selector);
        protocol.repay(0);

        // markDefaulted succeeds
        protocol.markDefaulted(0);
        assertEq(uint8(protocol.getLoan(0).status), uint8(ExpressiveLending.LoanStatus.Defaulted));

        // markDefaulted reverts on re-call (already Defaulted, not Active)
        vm.expectRevert(ExpressiveLending.LoanNotActive.selector);
        protocol.markDefaulted(0);

        // Liquidation of defaulted loan succeeds
        address[] memory seize = new address[](1);
        seize[0] = address(wbtc);
        uint256[] memory seizeAmt = new uint256[](1);
        seizeAmt[0] = 1e8;
        vm.prank(liquidator);
        protocol.liquidate(0, seize, seizeAmt);
        assertEq(uint8(protocol.getLoan(0).status), uint8(ExpressiveLending.LoanStatus.Liquidated));
    }

    // ═════════════════════════════════════════════════════════════════════════
    // TEST 6: Partial Liquidation Health Check, Then Full Close
    //
    // Loan: 10 000 USDC principal, 2 BTC collateral (initially very healthy).
    // Drop BTC price to make loan unhealthy.
    // Case A: seize 1 BTC -> health NOT restored -> revert HealthNotRestored.
    // Case B: seize all 2 BTC -> loan closes (bad debt absorbed by lender).
    // ═════════════════════════════════════════════════════════════════════════
    function test_Liquidation_PartialThenFull_WithBadDebt() public {
        uint256 AMOUNT = 10_000e6;

        address[] memory lCol = new address[](1);
        lCol[0] = address(wbtc);
        vm.prank(lender1);
        uint256 l1 = protocol.placeLendOrder(
            address(usdc), lCol, 400, 7_000, 730 days, 8_000, AMOUNT
        );
        address[] memory bCol = new address[](1);
        bCol[0] = address(wbtc);
        uint256[] memory bAmt = new uint256[](1);
        bAmt[0] = 2e8; // 2 BTC
        vm.prank(borrower1);
        uint256 b1 = protocol.placeBorrowOrder(
            address(usdc), bCol, bAmt, 700, 5_000, 180 days, 7_000, AMOUNT, false
        );
        {
            (ExpressiveLending.Pair[] memory pairs,
             ExpressiveLending.Consumption[] memory consumptions) = _buildBatch1(l1, b1, AMOUNT);
            vm.prank(solverA);
            protocol.submitBatch(pairs, consumptions);
        }
        skip(BATCH_WINDOW + 1);
        protocol.executeBatch();

        ExpressiveLending.Loan memory loan = protocol.getLoan(0);
        uint256 principal = loan.principal;  // ~9990e6

        // Health: 2 BTC at 80 000 = 160 000 USDC >> lltv * principal = 0.7 * ~9990e6 ~= 6993e6
        assertEq(protocol.isHealthy(0), true, "healthy at 80k BTC");

        // Crash BTC: 1000 USDC/BTC -> 2 BTC = 2000 USDC < 6993 USDC threshold
        btcOracle.setPrice(1_000e6);
        assertEq(protocol.isHealthy(0), false, "unhealthy at 1k BTC");

        // ── Case A: seize 1 BTC -- health not restored -> revert ────────────
        // After seizing 1 BTC, remaining collateral = 1 BTC = 1000 USDC
        // Remaining principal after partial = principal - debtCovered
        // debtCovered = 1000e6 * 10000 / 10500 = 952_380_952
        // Remaining principal = ~9990e6 - 952_380_952 = ~9_037_619_048
        // Health threshold = 9_037_619_048 * 7000 / 10000 = ~6_326_333_333
        // Remaining collateral value = 1000e6 << threshold -> NOT healthy
        {
            address[] memory seize = new address[](1);
            seize[0] = address(wbtc);
            uint256[] memory seizeAmt = new uint256[](1);
            seizeAmt[0] = 1e8; // partial: 1 BTC
            vm.prank(liquidator);
            vm.expectRevert(ExpressiveLending.HealthNotRestored.selector);
            protocol.liquidate(0, seize, seizeAmt);
        }

        // ── Case B: seize all 2 BTC -- loan closes (bad debt) ────────────────
        {
            address[] memory seize = new address[](1);
            seize[0] = address(wbtc);
            uint256[] memory seizeAmt = new uint256[](1);
            seizeAmt[0] = 2e8; // full collateral

            uint256 liqBTCBefore  = wbtc.balanceOf(liquidator);
            uint256 liqUSDCBefore = usdc.balanceOf(liquidator);

            vm.prank(liquidator);
            protocol.liquidate(0, seize, seizeAmt);

            // Liquidator got all 2 BTC
            assertEq(wbtc.balanceOf(liquidator) - liqBTCBefore, 2e8, "liquidator got 2 BTC");

            // Liquidator payment = collateralValue * BP / (BP + bonus)
            // = 2 * 1000e6 * 10000 / 10500 = 1_904_761_904
            uint256 collateralValue = 2 * 1_000e6;
            uint256 expectedPayment = collateralValue * BP / (BP + LIQ_BONUS);
            assertEq(
                liqUSDCBefore - usdc.balanceOf(liquidator),
                expectedPayment,
                "liquidator paid discount price"
            );

            // Payment < principal (bad debt scenario)
            assertLt(expectedPayment, principal, "payment less than principal = bad debt");

            // Loan closed as Liquidated
            assertEq(
                uint8(protocol.getLoan(0).status),
                uint8(ExpressiveLending.LoanStatus.Liquidated),
                "loan liquidated"
            );

            // Lender redeems: gets only the liquidator's payment (absorbs shortfall)
            uint256 lenderBefore = usdc.balanceOf(lender1);
            vm.prank(lender1);
            protocol.redeem(0);
            uint256 lenderReceived = usdc.balanceOf(lender1) - lenderBefore;
            assertEq(lenderReceived, expectedPayment, "lender gets what liquidator paid");
            assertLt(lenderReceived, principal, "lender absorbs bad debt shortfall");
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // TEST 7: NFT Transfer — Secondary Market Redemption by New Owner
    //
    // Lender transfers NFT to nftBuyer before repayment.
    // nftBuyer redeems after repayment; original lender cannot redeem.
    // ═════════════════════════════════════════════════════════════════════════
    function test_NFT_SecondaryMarketRedemption() public {
        uint256 AMOUNT = 100e6;

        address[] memory lCol = new address[](1);
        lCol[0] = address(wbtc);
        vm.prank(lender1);
        uint256 l1 = protocol.placeLendOrder(
            address(usdc), lCol, 400, 7_000, 730 days, 8_000, AMOUNT
        );
        address[] memory bCol = new address[](1);
        bCol[0] = address(wbtc);
        uint256[] memory bAmt = new uint256[](1);
        bAmt[0] = 1e8;
        vm.prank(borrower1);
        uint256 b1 = protocol.placeBorrowOrder(
            address(usdc), bCol, bAmt, 700, 5_000, 180 days, 7_000, AMOUNT, false
        );
        {
            (ExpressiveLending.Pair[] memory pairs,
             ExpressiveLending.Consumption[] memory consumptions) = _buildBatch1(l1, b1, AMOUNT);
            vm.prank(solverA);
            protocol.submitBatch(pairs, consumptions);
        }
        skip(BATCH_WINDOW + 1);
        protocol.executeBatch();

        // lender1 transfers NFT to nftBuyer
        vm.prank(lender1);
        protocol.transferFrom(lender1, nftBuyer, 0);
        assertEq(protocol.ownerOf(0), nftBuyer, "nftBuyer holds NFT");

        // Borrower repays
        skip(30 days);
        vm.prank(borrower1);
        protocol.repay(0);

        // lender1 cannot redeem (no longer owns NFT)
        vm.prank(lender1);
        vm.expectRevert("not NFT owner");
        protocol.redeem(0);

        // nftBuyer redeems successfully
        uint256 buyerBefore  = usdc.balanceOf(nftBuyer);
        ExpressiveLending.Loan memory loan = protocol.getLoan(0);
        vm.prank(nftBuyer);
        protocol.redeem(0);
        assertGt(usdc.balanceOf(nftBuyer) - buyerBefore, loan.principal, "nftBuyer got principal + interest");

        // NFT burned
        vm.expectRevert();
        protocol.ownerOf(0);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // TEST 8: Multi-Asset Collateral — BTC + ETH, Partial Fill Pro-Ration
    //
    // Borrower posts 1 BTC + 10 ETH for a 200 USDC order.
    // Only 100 USDC is matched (50% fill). Loan gets 0.5 BTC + 5 ETH.
    // ═════════════════════════════════════════════════════════════════════════
    function test_MultiAssetCollateral_ProRation() public {
        uint256 ORDER_AMT = 200e6;
        uint256 MATCH_AMT = 100e6; // 50% fill

        address[] memory lCol = new address[](2);
        lCol[0] = address(wbtc);
        lCol[1] = address(weth);
        vm.prank(lender1);
        uint256 l1 = protocol.placeLendOrder(
            address(usdc), lCol, 400, 7_000, 730 days, 8_000, ORDER_AMT
        );

        address[] memory bCol = new address[](2);
        bCol[0] = address(wbtc);
        bCol[1] = address(weth);
        uint256[] memory bAmt = new uint256[](2);
        bAmt[0] = 1e8;    // 1 BTC
        bAmt[1] = 10e18;  // 10 ETH
        vm.prank(borrower1);
        uint256 b1 = protocol.placeBorrowOrder(
            address(usdc), bCol, bAmt, 700, 5_000, 180 days, 7_000, ORDER_AMT, false
        );

        // Match only MATCH_AMT (50% of ORDER_AMT)
        {
            (ExpressiveLending.Pair[] memory pairs,
             ExpressiveLending.Consumption[] memory consumptions) = _buildBatch1(l1, b1, MATCH_AMT);
            vm.prank(solverA);
            protocol.submitBatch(pairs, consumptions);
        }
        skip(BATCH_WINDOW + 1);
        protocol.executeBatch();

        ExpressiveLending.Loan memory loan = protocol.getLoan(0);

        // Pro-rated collateral: matchAmount / orderAmount = 100e6 / 200e6 = 0.5
        uint256 expectedBTC = 1e8   * MATCH_AMT / ORDER_AMT;  // 0.5e8 = 5_000_0000
        uint256 expectedETH = 10e18 * MATCH_AMT / ORDER_AMT;  // 5e18

        assertEq(loan.collateralAmounts[0], expectedBTC, "half BTC in loan");
        assertEq(loan.collateralAmounts[1], expectedETH, "half ETH in loan");

        // Remaining order collateral still in contract:
        // Contract holds: (1-0.5) BTC + (10-5) ETH for the unfilled portion of B1
        // plus loan collateral = 0.5 BTC + 5 ETH -> total 1 BTC + 10 ETH = original locked amounts
        assertEq(wbtc.balanceOf(address(protocol)), 1e8,   "contract holds all 1 BTC");
        assertEq(weth.balanceOf(address(protocol)), 10e18, "contract holds all 10 ETH");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // TEST 9: submitBatch Auto-Executes Expired Window
    //
    // Solver A wins Window 0. Window expires without explicit executeBatch.
    // Solver B calls submitBatch for Window 1 -> auto-executes Window 0 first,
    // then registers B's submission in Window 1.
    // ═════════════════════════════════════════════════════════════════════════
    function test_SubmitBatch_AutoExecutesExpiredWindow() public {
        uint256 AMOUNT = 100e6;

        address[] memory lCol = new address[](1);
        lCol[0] = address(wbtc);

        // Window 0 orders
        vm.prank(lender1);
        uint256 l1 = protocol.placeLendOrder(
            address(usdc), lCol, 400, 7_000, 730 days, 8_000, AMOUNT
        );
        address[] memory bCol = new address[](1);
        bCol[0] = address(wbtc);
        uint256[] memory bAmt = new uint256[](1);
        bAmt[0] = 1e8;
        vm.prank(borrower1);
        uint256 b1 = protocol.placeBorrowOrder(
            address(usdc), bCol, bAmt, 700, 5_000, 180 days, 7_000, AMOUNT, false
        );

        // Solver A wins Window 0
        {
            (ExpressiveLending.Pair[] memory pairs,
             ExpressiveLending.Consumption[] memory consumptions) = _buildBatch1(l1, b1, AMOUNT);
            vm.prank(solverA);
            protocol.submitBatch(pairs, consumptions);
        }
        assertEq(protocol.windowId(), 0, "still in window 0");
        assertEq(protocol.nextLoanId(), 0, "no loans yet");

        // Skip past window 0 WITHOUT calling executeBatch
        skip(BATCH_WINDOW + 5);

        // New orders for Window 1
        vm.prank(lender2);
        uint256 l2 = protocol.placeLendOrder(
            address(usdc), lCol, 350, 7_000, 730 days, 8_000, AMOUNT
        );
        bAmt[0] = 1e8;
        vm.prank(borrower2);
        uint256 b2 = protocol.placeBorrowOrder(
            address(usdc), bCol, bAmt, 600, 5_000, 90 days, 7_000, AMOUNT, false
        );

        // Solver B submits for Window 1 -> triggers auto-execution of Window 0
        {
            (ExpressiveLending.Pair[] memory pairs,
             ExpressiveLending.Consumption[] memory consumptions) = _buildBatch1(l2, b2, AMOUNT);
            vm.prank(solverB);
            protocol.submitBatch(pairs, consumptions);
        }

        // Window 0 executed: loan from L1->B1 exists
        assertEq(protocol.nextLoanId(), 1, "W0 loan created by auto-execute");
        assertEq(protocol.windowId(),   1, "now in window 1");
        assertEq(protocol.currentWinner(), solverB, "solverB leads window 1");

        // Solver A's fee from Window 0 was paid
        uint256 expectedW0Fee = AMOUNT * SOLVER_FEE / BP;
        assertEq(usdc.balanceOf(solverA), expectedW0Fee, "solverA got W0 fee");

        // Execute Window 1
        skip(BATCH_WINDOW + 1);
        protocol.executeBatch();
        assertEq(protocol.nextLoanId(), 2, "W1 loan created");
        assertEq(usdc.balanceOf(solverB), expectedW0Fee, "solverB got W1 fee");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // TEST 10: All Six Incompatibility Conditions Independently
    //
    // One lend order; six borrow orders, each violating exactly one condition.
    // Spec conditions:
    //   1. B.collateralAssets not subset of L.acceptableCollateral
    //   2. B.borrowAsset != L.borrowAsset  (cannot test here; only one borrow asset)
    //   3. L.minRate > B.maxRate
    //   4. B.minLTV > L.maxLTV
    //   5. B.minDuration > L.maxDuration
    //   6. B.minLLTV > L.maxLLTV
    // ═════════════════════════════════════════════════════════════════════════
    function test_Incompatibility_AllSixConditions() public {
        uint256 AMOUNT = 100e6;

        // L: accepts BTC only, minRate=500, maxLTV=7000, maxDur=365d, maxLLTV=8000
        address[] memory lCol = new address[](1);
        lCol[0] = address(wbtc);
        vm.prank(lender1);
        uint256 l1 = protocol.placeLendOrder(
            address(usdc), lCol, 500, 7_000, 365 days, 8_000, AMOUNT * 10
        );

        address[] memory btcCol = new address[](1);
        btcCol[0] = address(wbtc);
        address[] memory ethCol = new address[](1);
        ethCol[0] = address(weth);
        uint256[] memory btcAmt = new uint256[](1); btcAmt[0] = 1e8;
        uint256[] memory ethAmt = new uint256[](1); ethAmt[0] = 1 ether;

        // Condition 1: ETH collateral not in L.acceptableCollateral
        vm.prank(borrower1);
        uint256 bC1 = protocol.placeBorrowOrder(
            address(usdc), ethCol, ethAmt, 700, 5_000, 180 days, 7_000, AMOUNT, false
        );
        _assertBatchReverts(l1, bC1, AMOUNT, ExpressiveLending.IncompatibleCollateral.selector);

        // Condition 3: L.minRate(500) > B.maxRate(400)
        vm.prank(borrower1);
        uint256 bC3 = protocol.placeBorrowOrder(
            address(usdc), btcCol, btcAmt, 400, 5_000, 180 days, 7_000, AMOUNT, false
        );
        _assertBatchReverts(l1, bC3, AMOUNT, ExpressiveLending.IncompatibleRate.selector);

        // Condition 4: B.minLTV(8000) > L.maxLTV(7000)
        vm.prank(borrower1);
        uint256 bC4 = protocol.placeBorrowOrder(
            address(usdc), btcCol, btcAmt, 700, 8_000, 180 days, 7_000, AMOUNT, false
        );
        _assertBatchReverts(l1, bC4, AMOUNT, ExpressiveLending.IncompatibleLTV.selector);

        // Condition 5: B.minDuration(730d) > L.maxDuration(365d)
        vm.prank(borrower1);
        uint256 bC5 = protocol.placeBorrowOrder(
            address(usdc), btcCol, btcAmt, 700, 5_000, 730 days, 7_000, AMOUNT, false
        );
        _assertBatchReverts(l1, bC5, AMOUNT, ExpressiveLending.IncompatibleDuration.selector);

        // Condition 6: B.minLLTV(9000) > L.maxLLTV(8000)
        vm.prank(borrower1);
        uint256 bC6 = protocol.placeBorrowOrder(
            address(usdc), btcCol, btcAmt, 700, 5_000, 180 days, 9_000, AMOUNT, false
        );
        _assertBatchReverts(l1, bC6, AMOUNT, ExpressiveLending.IncompatibleLLTV.selector);
    }

    function _assertBatchReverts(
        uint256 lId, uint256 bId, uint256 amount, bytes4 selector
    ) internal {
        (ExpressiveLending.Pair[] memory pairs,
         ExpressiveLending.Consumption[] memory consumptions) = _buildBatch1(lId, bId, amount);
        vm.prank(solverA);
        vm.expectRevert(selector);
        protocol.submitBatch(pairs, consumptions);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // TEST 11: Over-Consumption Rejected
    //
    // Solver submits a pair consuming more of an order than its remaining capacity.
    // The consumption entry claims 150e6 but the order only has 100e6 -> revert.
    // ═════════════════════════════════════════════════════════════════════════
    function test_OverConsumption_Rejected() public {
        uint256 L_AMOUNT = 100e6;
        uint256 B_AMOUNT = 200e6; // borrow order has more capacity

        address[] memory lCol = new address[](1);
        lCol[0] = address(wbtc);
        vm.prank(lender1);
        uint256 l1 = protocol.placeLendOrder(
            address(usdc), lCol, 400, 7_000, 730 days, 8_000, L_AMOUNT
        );
        address[] memory bCol = new address[](1);
        bCol[0] = address(wbtc);
        uint256[] memory bAmt = new uint256[](1);
        bAmt[0] = 2e8;
        vm.prank(borrower1);
        uint256 b1 = protocol.placeBorrowOrder(
            address(usdc), bCol, bAmt, 700, 5_000, 180 days, 7_000, B_AMOUNT, false
        );

        // Claim 150e6 from L1 which only has 100e6 capacity
        ExpressiveLending.Pair[] memory pairs = new ExpressiveLending.Pair[](1);
        pairs[0] = ExpressiveLending.Pair({lendOrderId: l1, borrowOrderId: b1, amount: 150e6});

        ExpressiveLending.Consumption[] memory consumptions = new ExpressiveLending.Consumption[](2);
        if (l1 < b1) {
            consumptions[0] = ExpressiveLending.Consumption({orderId: l1, totalConsumed: 150e6});
            consumptions[1] = ExpressiveLending.Consumption({orderId: b1, totalConsumed: 150e6});
        } else {
            consumptions[0] = ExpressiveLending.Consumption({orderId: b1, totalConsumed: 150e6});
            consumptions[1] = ExpressiveLending.Consumption({orderId: l1, totalConsumed: 150e6});
        }

        vm.prank(solverA);
        vm.expectRevert(abi.encodeWithSelector(ExpressiveLending.OrderOverconsumed.selector, l1));
        protocol.submitBatch(pairs, consumptions);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // TEST 12: Early Repayment — Interest Pro-Rated to Elapsed Time
    //
    // Spec: "Early repayment is pro-rated to elapsed time only."
    // Repay after 30 days on a 180-day loan. Interest should be 30/365ths
    // of annual interest, not 180/365ths.
    // ═════════════════════════════════════════════════════════════════════════
    function test_EarlyRepayment_ProRatedInterest() public {
        uint256 AMOUNT = 100e6;

        address[] memory lCol = new address[](1);
        lCol[0] = address(wbtc);
        vm.prank(lender1);
        uint256 l1 = protocol.placeLendOrder(
            address(usdc), lCol, 400, 7_000, 730 days, 8_000, AMOUNT
        );
        address[] memory bCol = new address[](1);
        bCol[0] = address(wbtc);
        uint256[] memory bAmt = new uint256[](1);
        bAmt[0] = 1e8;
        vm.prank(borrower1);
        uint256 b1 = protocol.placeBorrowOrder(
            address(usdc), bCol, bAmt, 700, 5_000, 180 days, 7_000, AMOUNT, false
        );
        {
            (ExpressiveLending.Pair[] memory pairs,
             ExpressiveLending.Consumption[] memory consumptions) = _buildBatch1(l1, b1, AMOUNT);
            vm.prank(solverA);
            protocol.submitBatch(pairs, consumptions);
        }
        skip(BATCH_WINDOW + 1);
        protocol.executeBatch();

        ExpressiveLending.Loan memory loan = protocol.getLoan(0);
        uint256 rate = loan.rate; // 550

        // Repay after 30 days
        skip(30 days);
        uint256 earlyInterest    = _interest(loan.principal, rate, 30 days);
        uint256 fullTermInterest = _interest(loan.principal, rate, 180 days);

        assertEq(protocol.getAccruedInterest(0), earlyInterest, "30-day interest");
        assertLt(earlyInterest, fullTermInterest, "early < full-term interest");

        vm.prank(borrower1);
        protocol.repay(0);

        uint256 lenderBefore = usdc.balanceOf(lender1);
        vm.prank(lender1);
        protocol.redeem(0);
        uint256 received = usdc.balanceOf(lender1) - lenderBefore;

        assertEq(received, loan.principal + earlyInterest, "lender gets pro-rated amount");
        assertLt(received, loan.principal + fullTermInterest, "less than full-term amount");
    }
}
