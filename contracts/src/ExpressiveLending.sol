// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "openzeppelin-contracts/contracts/utils/math/Math.sol";
import {Base64} from "openzeppelin-contracts/contracts/utils/Base64.sol";
import {Strings} from "openzeppelin-contracts/contracts/utils/Strings.sol";
import {IOracle} from "./IOracle.sol";

/// @title  ExpressiveLending
/// @notice Constraint-based multi-dimensional lending protocol with batch-auction matching.
///         Lenders and borrowers post orders expressing preferences across all loan dimensions.
///         Off-chain solvers compute maximum-surplus matchings; the contract verifies and executes.
contract ExpressiveLending is ERC721 {
    using Math for uint256;
    using Strings for uint256;
    using Strings for address;

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error InvalidBorrowAsset();
    error InvalidCollateralAsset();
    error ArrayLengthMismatch();
    error ZeroAmount();
    error IncompatibleCollateral();
    error IncompatibleBorrowAsset();
    error IncompatibleRate();
    error IncompatibleLTV();
    error IncompatibleDuration();
    error IncompatibleLLTV();
    error FillOrKillViolation();
    error OrderOverconsumed(uint256 orderId);
    error OrderNotInConsumptions(uint256 orderId);
    error ConsumptionMismatch(uint256 orderId);
    error SurplusNotHigher();
    error WindowStillOpen();
    error WindowClosed();
    error NoWinningBatch();
    error LoanNotActive();
    error LoanMatured();
    error LoanNotMatured();
    error NotBorrower();
    error CollateralStillHealthy();
    error HealthNotRestored();
    error LiquidationNotAllowed();
    error CollateralNotInLoan();
    error ExcessCollateralAmount();
    error NothingToRedeem();
    error LoanNotClosed();

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event LendOrderPlaced(
        uint256 indexed orderId,
        address indexed owner,
        address borrowAsset,
        address[] acceptableCollateral,
        uint256 minRate,
        uint256 maxLTV,
        uint256 maxDuration,
        uint256 maxLLTV,
        uint256 amount,
        uint256 timestamp
    );

    event BorrowOrderPlaced(
        uint256 indexed orderId,
        address indexed owner,
        address borrowAsset,
        address[] collateralAssets,
        uint256[] collateralAmounts,
        uint256 maxRate,
        uint256 minLTV,
        uint256 minDuration,
        uint256 minLLTV,
        uint256 amount,
        bool fillOrKill,
        uint256 timestamp
    );

    event LoanCreated(
        uint256 indexed loanId,
        uint256 indexed lendOrderId,
        uint256 indexed borrowOrderId,
        address lender,
        address borrower,
        uint256 principal,
        uint256 rate,
        uint256 maturityDate
    );

    event BatchExecuted(uint256 indexed windowId, address indexed solver, uint256 totalSurplus, uint256 pairCount);
    event LoanRepaid(uint256 indexed loanId);
    event LoanLiquidated(uint256 indexed loanId, address indexed liquidator);
    event LoanDefaulted(uint256 indexed loanId);

    // ─────────────────────────────────────────────────────────────────────────
    // Structs / Enums
    // ─────────────────────────────────────────────────────────────────────────

    struct LendOrder {
        address borrowAsset;
        address[] acceptableCollateral;
        uint256 minRate;      // basis points
        uint256 maxLTV;       // basis points
        uint256 maxDuration;  // seconds
        uint256 maxLLTV;      // basis points
        uint256 amount;       // total principal to lend (borrowAsset units)
        uint256 filledAmount;
        address owner;
        uint256 timestamp;
    }

    struct BorrowOrder {
        address borrowAsset;
        address[] collateralAssets;
        uint256[] collateralAmounts;
        uint256 maxRate;      // basis points
        uint256 minLTV;       // basis points
        uint256 minDuration;  // seconds
        uint256 minLLTV;      // basis points
        uint256 amount;       // principal desired (borrowAsset units)
        uint256 filledAmount;
        bool fillOrKill;
        address owner;
        uint256 timestamp;
    }

    enum LoanStatus { Active, Repaid, Liquidated, Defaulted }

    struct Loan {
        address lender;
        address borrower;
        address borrowAsset;
        address[] collateralAssets;
        uint256[] collateralAmounts;
        uint256 principal;
        uint256 rate;         // basis points
        uint256 ltv;          // basis points
        uint256 lltv;         // basis points
        uint256 duration;     // seconds
        uint256 originationDate;
        uint256 maturityDate;
        LoanStatus status;
    }

    /// @dev Submitted by a solver: one matched (lend, borrow) pair and the amount.
    struct Pair {
        uint256 lendOrderId;
        uint256 borrowOrderId;
        uint256 amount;
    }

    /// @dev Pre-aggregated consumption per order, sorted ascending by orderId.
    struct Consumption {
        uint256 orderId;
        uint256 totalConsumed;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    uint256 public constant BASIS_POINTS = 10_000;
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    // ─────────────────────────────────────────────────────────────────────────
    // Immutable deployment parameters
    // ─────────────────────────────────────────────────────────────────────────

    uint256 public immutable batchWindowSeconds;
    uint256 public immutable solverFeeRate;          // basis points
    uint256 public immutable liquidationBonusRate;   // basis points

    // ─────────────────────────────────────────────────────────────────────────
    // Whitelists (set at construction, immutable thereafter)
    // ─────────────────────────────────────────────────────────────────────────

    mapping(address => bool) public isCollateralAsset;
    mapping(address => bool) public isBorrowAsset;
    mapping(address => address) public collateralOracle;   // collateral → oracle
    mapping(address => uint8)  public collateralDecimals;  // collateral → ERC20 decimals

    // ─────────────────────────────────────────────────────────────────────────
    // Order and loan storage
    // ─────────────────────────────────────────────────────────────────────────

    uint256 public nextOrderId;
    uint256 public nextLoanId;
    uint256 public nextTokenId;

    mapping(uint256 => LendOrder)  public lendOrders;
    mapping(uint256 => BorrowOrder) public borrowOrders;
    mapping(uint256 => bool)        public isLendOrder;   // orderId → type flag

    mapping(uint256 => Loan)    public loans;
    mapping(uint256 => uint256) public nftToLoan;          // tokenId → loanId
    mapping(uint256 => uint256) public loanToNft;          // loanId  → tokenId
    mapping(uint256 => uint256) public redeemableByLoan;   // loanId  → claimable borrow-asset amount

    // ─────────────────────────────────────────────────────────────────────────
    // Batch auction state
    // ─────────────────────────────────────────────────────────────────────────

    uint256 public windowId;
    uint256 public windowStart;
    uint256 public currentBestSurplus;
    address public currentWinner;
    Pair[]  public currentWinningPairs;

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor(
        uint256 _batchWindowSeconds,
        uint256 _solverFeeRate,
        uint256 _liquidationBonusRate,
        address[] memory _collateralAssets,
        address[] memory _borrowAssets,
        address[] memory _oracles
    ) ERC721("Expressive Lending Position", "ELP") {
        if (_collateralAssets.length != _oracles.length) revert ArrayLengthMismatch();

        batchWindowSeconds    = _batchWindowSeconds;
        solverFeeRate         = _solverFeeRate;
        liquidationBonusRate  = _liquidationBonusRate;

        for (uint256 i; i < _collateralAssets.length; ++i) {
            address asset = _collateralAssets[i];
            isCollateralAsset[asset]  = true;
            collateralOracle[asset]   = _oracles[i];
            collateralDecimals[asset] = IERC20Metadata(asset).decimals();
        }
        for (uint256 i; i < _borrowAssets.length; ++i) {
            isBorrowAsset[_borrowAssets[i]] = true;
        }

        windowStart = block.timestamp;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Order placement
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Place a lend order and lock `amount` of `borrowAsset` into the contract.
    function placeLendOrder(
        address   borrowAsset,
        address[] calldata acceptableCollateral,
        uint256   minRate,
        uint256   maxLTV,
        uint256   maxDuration,
        uint256   maxLLTV,
        uint256   amount
    ) external returns (uint256 orderId) {
        if (!isBorrowAsset[borrowAsset]) revert InvalidBorrowAsset();
        if (amount == 0) revert ZeroAmount();
        for (uint256 i; i < acceptableCollateral.length; ++i) {
            if (!isCollateralAsset[acceptableCollateral[i]]) revert InvalidCollateralAsset();
        }

        orderId = nextOrderId++;
        isLendOrder[orderId] = true;

        lendOrders[orderId] = LendOrder({
            borrowAsset:         borrowAsset,
            acceptableCollateral: acceptableCollateral,
            minRate:             minRate,
            maxLTV:              maxLTV,
            maxDuration:         maxDuration,
            maxLLTV:             maxLLTV,
            amount:              amount,
            filledAmount:        0,
            owner:               msg.sender,
            timestamp:           block.timestamp
        });

        IERC20(borrowAsset).transferFrom(msg.sender, address(this), amount);

        emit LendOrderPlaced(
            orderId, msg.sender, borrowAsset, acceptableCollateral,
            minRate, maxLTV, maxDuration, maxLLTV, amount, block.timestamp
        );
    }

    /// @notice Place a borrow order and lock all `collateralAmounts` into the contract.
    function placeBorrowOrder(
        address    borrowAsset,
        address[]  calldata collateralAssets,
        uint256[]  calldata collateralAmounts,
        uint256    maxRate,
        uint256    minLTV,
        uint256    minDuration,
        uint256    minLLTV,
        uint256    amount,
        bool       fillOrKill
    ) external returns (uint256 orderId) {
        if (!isBorrowAsset[borrowAsset]) revert InvalidBorrowAsset();
        if (amount == 0) revert ZeroAmount();
        if (collateralAssets.length != collateralAmounts.length) revert ArrayLengthMismatch();
        for (uint256 i; i < collateralAssets.length; ++i) {
            if (!isCollateralAsset[collateralAssets[i]]) revert InvalidCollateralAsset();
        }

        orderId = nextOrderId++;
        // isLendOrder[orderId] stays false

        borrowOrders[orderId] = BorrowOrder({
            borrowAsset:      borrowAsset,
            collateralAssets: collateralAssets,
            collateralAmounts: collateralAmounts,
            maxRate:          maxRate,
            minLTV:           minLTV,
            minDuration:      minDuration,
            minLLTV:          minLLTV,
            amount:           amount,
            filledAmount:     0,
            fillOrKill:       fillOrKill,
            owner:            msg.sender,
            timestamp:        block.timestamp
        });

        for (uint256 i; i < collateralAssets.length; ++i) {
            IERC20(collateralAssets[i]).transferFrom(msg.sender, address(this), collateralAmounts[i]);
        }

        emit BorrowOrderPlaced(
            orderId, msg.sender, borrowAsset, collateralAssets, collateralAmounts,
            maxRate, minLTV, minDuration, minLLTV, amount, fillOrKill, block.timestamp
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Batch submission
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Submit a candidate batch. If the window has elapsed, automatically executes
    ///         the current winning batch first, opens a new window, then processes this
    ///         submission as the opening bid of the new window.
    ///         Replaces the current best only if `surplus > currentBestSurplus`.
    /// @param pairs       Matched (lend, borrow, amount) tuples.
    /// @param consumptions Per-order total consumed, sorted ascending by orderId.
    function submitBatch(Pair[] calldata pairs, Consumption[] calldata consumptions) external {
        // If window has elapsed, auto-execute and open a new window first.
        if (block.timestamp >= windowStart + batchWindowSeconds) {
            _executeWinningBatch();
            _openNewWindow();
        }

        if (pairs.length == 0) revert ZeroAmount();

        // Accumulator: indexed parallel to consumptions[], holds accumulated pair amounts.
        uint256[] memory accumulated = new uint256[](consumptions.length);

        uint256 totalSurplus;

        // ── Pass 1: pair validity ─────────────────────────────────────────────
        for (uint256 i; i < pairs.length; ++i) {
            Pair calldata p = pairs[i];
            if (p.amount == 0) revert ZeroAmount();

            LendOrder  storage L = lendOrders[p.lendOrderId];
            BorrowOrder storage B = borrowOrders[p.borrowOrderId];

            _checkCompatibility(L, B);

            if (B.fillOrKill) {
                uint256 remaining = B.amount - B.filledAmount;
                if (p.amount != remaining) revert FillOrKillViolation();
            }

            uint256 lIdx = _findConsumptionIdx(consumptions, p.lendOrderId);
            uint256 bIdx = _findConsumptionIdx(consumptions, p.borrowOrderId);
            accumulated[lIdx] += p.amount;
            accumulated[bIdx] += p.amount;

            // surplus contribution (rate spread * principal)
            totalSurplus += (B.maxRate - L.minRate) * p.amount;
        }

        // ── Pass 2: consumption verification ─────────────────────────────────
        for (uint256 i; i < consumptions.length; ++i) {
            Consumption calldata c = consumptions[i];
            if (accumulated[i] != c.totalConsumed) revert ConsumptionMismatch(c.orderId);

            if (isLendOrder[c.orderId]) {
                LendOrder storage lo = lendOrders[c.orderId];
                if (c.totalConsumed > lo.amount - lo.filledAmount) revert OrderOverconsumed(c.orderId);
            } else {
                BorrowOrder storage bo = borrowOrders[c.orderId];
                if (c.totalConsumed > bo.amount - bo.filledAmount) revert OrderOverconsumed(c.orderId);
            }
        }

        // ── Update running best ───────────────────────────────────────────────
        if (totalSurplus <= currentBestSurplus) revert SurplusNotHigher();

        currentBestSurplus = totalSurplus;
        currentWinner      = msg.sender;

        delete currentWinningPairs;
        for (uint256 i; i < pairs.length; ++i) {
            currentWinningPairs.push(pairs[i]);
        }
    }

    /// @notice Execute the winning batch for the current window.
    ///         Callable by anyone once the window has elapsed.
    function executeBatch() external {
        if (block.timestamp < windowStart + batchWindowSeconds) revert WindowStillOpen();
        _executeWinningBatch();
        _openNewWindow();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Loan lifecycle
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Repay a loan in full (principal + accrued interest).
    ///         Only the borrower may repay. Collateral is returned; NFT becomes redeemable.
    function repay(uint256 loanId) external {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Active) revert LoanNotActive();
        // No grace period: borrower cannot repay once the loan has matured.
        if (block.timestamp >= loan.maturityDate) revert LoanMatured();
        if (msg.sender != loan.borrower) revert NotBorrower();

        uint256 interest = _accrued(loan.principal, loan.rate, loan.originationDate);
        uint256 totalRepayment = loan.principal + interest;

        // CEI: update state before transfers
        loan.status = LoanStatus.Repaid;
        redeemableByLoan[loanId] += totalRepayment;

        // Pull repayment from borrower
        IERC20(loan.borrowAsset).transferFrom(msg.sender, address(this), totalRepayment);

        // Return collateral to borrower
        for (uint256 i; i < loan.collateralAssets.length; ++i) {
            if (loan.collateralAmounts[i] > 0) {
                IERC20(loan.collateralAssets[i]).transfer(loan.borrower, loan.collateralAmounts[i]);
            }
        }

        emit LoanRepaid(loanId);
    }

    /// @notice Liquidate a loan whose LLTV has been breached (Active) or that has defaulted.
    ///         Liquidator specifies which collateral assets and amounts to purchase.
    ///         Liquidator pays borrow asset; receives collateral plus liquidation bonus.
    ///         Partial liquidations must restore the loan to health.
    function liquidate(
        uint256   loanId,
        address[] calldata collateralAssets,
        uint256[] calldata collateralAmounts
    ) external {
        if (collateralAssets.length != collateralAmounts.length) revert ArrayLengthMismatch();
        Loan storage loan = loans[loanId];

        // Lazily transition Active→Defaulted at maturity
        if (loan.status == LoanStatus.Active && block.timestamp >= loan.maturityDate) {
            loan.status = LoanStatus.Defaulted;
            emit LoanDefaulted(loanId);
        }

        if (loan.status == LoanStatus.Defaulted) {
            // Post-maturity: any liquidation is allowed
        } else if (loan.status == LoanStatus.Active) {
            if (_isHealthy(loan)) revert CollateralStillHealthy();
        } else {
            revert LiquidationNotAllowed();
        }

        // Compute value of collateral being purchased (in borrow-asset units)
        uint256 collateralValue = _computeCollateralValue(collateralAssets, collateralAmounts);

        // Liquidator pays less than collateral value (the difference is the bonus)
        uint256 liquidatorPayment = Math.mulDiv(collateralValue, BASIS_POINTS, BASIS_POINTS + liquidationBonusRate);

        // Cap at outstanding debt
        uint256 interest = _accrued(loan.principal, loan.rate, loan.originationDate);
        uint256 outstandingDebt = loan.principal + interest;
        uint256 debtCovered = liquidatorPayment > outstandingDebt ? outstandingDebt : liquidatorPayment;

        // CEI: deduct purchased collateral from loan before transfers
        for (uint256 i; i < collateralAssets.length; ++i) {
            bool found;
            for (uint256 j; j < loan.collateralAssets.length; ++j) {
                if (loan.collateralAssets[j] == collateralAssets[i]) {
                    if (collateralAmounts[i] > loan.collateralAmounts[j]) revert ExcessCollateralAmount();
                    loan.collateralAmounts[j] -= collateralAmounts[i];
                    found = true;
                    break;
                }
            }
            if (!found) revert CollateralNotInLoan();
        }

        // Determine if loan closes: full debt covered OR all collateral exhausted
        bool allCollateralGone = _allCollateralZero(loan);
        bool closeLoan = allCollateralGone || debtCovered >= outstandingDebt;

        if (closeLoan) {
            loan.status = LoanStatus.Liquidated;
            redeemableByLoan[loanId] += debtCovered;

            // Return any excess collateral left in the loan to borrower
            for (uint256 j; j < loan.collateralAssets.length; ++j) {
                if (loan.collateralAmounts[j] > 0) {
                    uint256 rem = loan.collateralAmounts[j];
                    loan.collateralAmounts[j] = 0;
                    IERC20(loan.collateralAssets[j]).transfer(loan.borrower, rem);
                }
            }
        } else {
            // Partial liquidation: health must be restored after seizing collateral
            if (!_isHealthy(loan)) revert HealthNotRestored();
            loan.principal -= debtCovered;
            redeemableByLoan[loanId] += debtCovered;
        }

        // Pull payment from liquidator
        IERC20(loan.borrowAsset).transferFrom(msg.sender, address(this), debtCovered);

        // Send purchased collateral to liquidator
        for (uint256 i; i < collateralAssets.length; ++i) {
            IERC20(collateralAssets[i]).transfer(msg.sender, collateralAmounts[i]);
        }

        emit LoanLiquidated(loanId, msg.sender);
    }

    /// @notice Redeem a lender NFT for the claimable borrow-asset amount.
    ///         Loan must be Repaid or Liquidated (fully closed).
    function redeem(uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender, "not NFT owner");
        uint256 loanId = nftToLoan[tokenId];
        Loan storage loan = loans[loanId];

        if (loan.status != LoanStatus.Repaid && loan.status != LoanStatus.Liquidated) {
            revert LoanNotClosed();
        }
        uint256 amount = redeemableByLoan[loanId];
        if (amount == 0) revert NothingToRedeem();

        // CEI
        redeemableByLoan[loanId] = 0;
        _burn(tokenId);

        IERC20(loan.borrowAsset).transfer(msg.sender, amount);
    }

    /// @notice Permissionless helper to transition an overdue loan to Defaulted status.
    function markDefaulted(uint256 loanId) external {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Active) revert LoanNotActive();
        if (block.timestamp < loan.maturityDate) revert LoanNotMatured();
        loan.status = LoanStatus.Defaulted;
        emit LoanDefaulted(loanId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Compute accrued interest on a loan at the current moment.
    function getAccruedInterest(uint256 loanId) external view returns (uint256) {
        Loan storage loan = loans[loanId];
        return _accrued(loan.principal, loan.rate, loan.originationDate);
    }

    /// @notice Return full LendOrder struct (Solidity cannot auto-return array fields).
    function getLendOrder(uint256 orderId) external view returns (LendOrder memory) {
        return lendOrders[orderId];
    }

    /// @notice Return full BorrowOrder struct.
    function getBorrowOrder(uint256 orderId) external view returns (BorrowOrder memory) {
        return borrowOrders[orderId];
    }

    /// @notice Return full Loan struct.
    function getLoan(uint256 loanId) external view returns (Loan memory) {
        return loans[loanId];
    }

    /// @notice Check whether a loan's collateral is currently above the LLTV threshold.
    function isHealthy(uint256 loanId) external view returns (bool) {
        return _isHealthy(loans[loanId]);
    }

    /// @notice Number of pairs in the current winning batch.
    function winningPairCount() external view returns (uint256) {
        return currentWinningPairs.length;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ERC-721 token URI (fully on-chain)
    // ─────────────────────────────────────────────────────────────────────────

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        uint256 loanId = nftToLoan[tokenId];
        Loan storage loan = loans[loanId];

        string memory json = string(abi.encodePacked(
            '{"name":"Expressive Lending Position #', loanId.toString(), '",',
            '"description":"Lender position for loan ', loanId.toString(), '",',
            '"attributes":[',
                '{"trait_type":"Loan ID","value":"', loanId.toString(), '"},',
                '{"trait_type":"Principal","value":"', loan.principal.toString(), '"},',
                '{"trait_type":"Rate (bps)","value":"', loan.rate.toString(), '"},',
                '{"trait_type":"LTV (bps)","value":"', loan.ltv.toString(), '"},',
                '{"trait_type":"LLTV (bps)","value":"', loan.lltv.toString(), '"},',
                '{"trait_type":"Duration (s)","value":"', loan.duration.toString(), '"},',
                '{"trait_type":"Maturity","value":"', loan.maturityDate.toString(), '"},',
                '{"trait_type":"Borrow Asset","value":"', uint256(uint160(loan.borrowAsset)).toHexString(20), '"},',
                '{"trait_type":"Status","value":"', _statusString(loan.status), '"}',
            ']}'
        ));

        return string(abi.encodePacked(
            "data:application/json;base64,",
            Base64.encode(bytes(json))
        ));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal: batch execution
    // ─────────────────────────────────────────────────────────────────────────

    function _executeWinningBatch() internal {
        uint256 _windowId  = windowId;
        address solver     = currentWinner;
        uint256 surplus    = currentBestSurplus;
        uint256 pairCount  = currentWinningPairs.length;

        if (solver == address(0) || pairCount == 0) {
            emit BatchExecuted(_windowId, address(0), 0, 0);
            return;
        }

        // Accumulate solver fees per borrow asset across all pairs, then do a single
        // aggregate transfer per asset per spec: "A single aggregate transfer of Σ(fees)
        // is sent to the winning solver at batch execution."
        //
        // We track up to pairCount distinct borrow assets (upper bound).
        address[] memory feeAssets  = new address[](pairCount);
        uint256[] memory feeAmounts = new uint256[](pairCount);
        uint256 feeAssetCount;

        for (uint256 i; i < pairCount; ++i) {
            uint256 fee = _executePairReturnFee(currentWinningPairs[i]);

            // Accumulate fee into the matching borrow asset slot
            address borrowAsset = lendOrders[currentWinningPairs[i].lendOrderId].borrowAsset;
            bool found;
            for (uint256 k; k < feeAssetCount; ++k) {
                if (feeAssets[k] == borrowAsset) {
                    feeAmounts[k] += fee;
                    found = true;
                    break;
                }
            }
            if (!found) {
                feeAssets[feeAssetCount]  = borrowAsset;
                feeAmounts[feeAssetCount] = fee;
                ++feeAssetCount;
            }
        }

        // Single aggregate transfer per borrow asset to the solver
        for (uint256 k; k < feeAssetCount; ++k) {
            if (feeAmounts[k] > 0) {
                IERC20(feeAssets[k]).transfer(solver, feeAmounts[k]);
            }
        }

        emit BatchExecuted(_windowId, solver, surplus, pairCount);
    }

    function _openNewWindow() internal {
        windowId++;
        windowStart        = block.timestamp;
        currentBestSurplus = 0;
        currentWinner      = address(0);
        delete currentWinningPairs;
    }

    /// @dev Executes one matched pair: creates the loan, mints NFT, transfers principal.
    ///      Returns the solver fee (in borrowAsset units) to be aggregated by the caller.
    function _executePairReturnFee(Pair storage pair) internal returns (uint256 fee) {
        LendOrder   storage L = lendOrders[pair.lendOrderId];
        BorrowOrder storage B = borrowOrders[pair.borrowOrderId];
        uint256 matchAmount   = pair.amount;

        // Solver fee deducted from the matched amount; loan principal is net
        fee                   = Math.mulDiv(matchAmount, solverFeeRate, BASIS_POINTS);
        uint256 principal     = matchAmount - fee;

        // Execution terms per protocol spec
        uint256 rate     = (L.minRate + B.maxRate) / 2;
        uint256 ltv      = B.minLTV;
        uint256 lltv     = B.minLLTV;
        uint256 duration = B.minDuration;
        uint256 maturity = block.timestamp + duration;

        // Pro-rate collateral for this fill fraction (matchAmount / B.amount)
        uint256 colLen = B.collateralAssets.length;
        uint256[] memory loanCollateral = new uint256[](colLen);
        for (uint256 j; j < colLen; ++j) {
            loanCollateral[j] = Math.mulDiv(B.collateralAmounts[j], matchAmount, B.amount);
        }

        uint256 loanId = nextLoanId++;
        loans[loanId] = Loan({
            lender:            L.owner,
            borrower:          B.owner,
            borrowAsset:       L.borrowAsset,
            collateralAssets:  B.collateralAssets,
            collateralAmounts: loanCollateral,
            principal:         principal,
            rate:              rate,
            ltv:               ltv,
            lltv:              lltv,
            duration:          duration,
            originationDate:   block.timestamp,
            maturityDate:      maturity,
            status:            LoanStatus.Active
        });

        // Mint lender NFT
        uint256 tokenId = nextTokenId++;
        nftToLoan[tokenId] = loanId;
        loanToNft[loanId]  = tokenId;
        _mint(L.owner, tokenId);

        // Update filled amounts (use full matchAmount per spec; fee is routing only)
        L.filledAmount += matchAmount;
        B.filledAmount += matchAmount;

        // Transfer principal to borrower (fee aggregated and sent by caller)
        IERC20(L.borrowAsset).transfer(B.owner, principal);

        emit LoanCreated(
            loanId, pair.lendOrderId, pair.borrowOrderId,
            L.owner, B.owner, principal, rate, maturity
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal: compatibility checks
    // ─────────────────────────────────────────────────────────────────────────

    function _checkCompatibility(LendOrder storage L, BorrowOrder storage B) internal view {
        // 1. B.collateralAssets ⊆ L.acceptableCollateral
        for (uint256 i; i < B.collateralAssets.length; ++i) {
            bool found;
            for (uint256 j; j < L.acceptableCollateral.length; ++j) {
                if (B.collateralAssets[i] == L.acceptableCollateral[j]) {
                    found = true;
                    break;
                }
            }
            if (!found) revert IncompatibleCollateral();
        }
        // 2. Same borrow asset
        if (B.borrowAsset != L.borrowAsset) revert IncompatibleBorrowAsset();
        // 3. L.minRate ≤ B.maxRate
        if (L.minRate > B.maxRate) revert IncompatibleRate();
        // 4. B.minLTV ≤ L.maxLTV
        if (B.minLTV > L.maxLTV) revert IncompatibleLTV();
        // 5. B.minDuration ≤ L.maxDuration
        if (B.minDuration > L.maxDuration) revert IncompatibleDuration();
        // 6. B.minLLTV ≤ L.maxLLTV
        if (B.minLLTV > L.maxLLTV) revert IncompatibleLLTV();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal: consumption binary search
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Binary search for `orderId` in a sorted `consumptions` array.
    ///      Reverts if not found; solver must include every referenced order.
    function _findConsumptionIdx(Consumption[] calldata consumptions, uint256 orderId)
        internal pure returns (uint256 idx)
    {
        uint256 lo;
        uint256 hi = consumptions.length;
        while (lo < hi) {
            uint256 mid = (lo + hi) >> 1;
            if (consumptions[mid].orderId < orderId) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        // lo is the first index where orderId >= consumptions[lo].orderId
        if (lo >= consumptions.length || consumptions[lo].orderId != orderId) {
            revert OrderNotInConsumptions(orderId);
        }
        return lo;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal: oracle / health checks
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Compute total collateral value in borrow-asset units for an arbitrary list.
    function _computeCollateralValue(
        address[] calldata assets,
        uint256[] calldata amounts
    ) internal view returns (uint256 totalValue) {
        for (uint256 i; i < assets.length; ++i) {
            uint256 price = IOracle(collateralOracle[assets[i]]).getPrice();
            uint8   dec   = collateralDecimals[assets[i]];
            totalValue += Math.mulDiv(price, amounts[i], 10 ** uint256(dec));
        }
    }

    /// @dev Compute total collateral value from a loan's stored collateral.
    function _computeLoanCollateralValue(Loan storage loan) internal view returns (uint256 totalValue) {
        for (uint256 i; i < loan.collateralAssets.length; ++i) {
            address asset = loan.collateralAssets[i];
            uint256 price = IOracle(collateralOracle[asset]).getPrice();
            uint8   dec   = collateralDecimals[asset];
            totalValue += Math.mulDiv(price, loan.collateralAmounts[i], 10 ** uint256(dec));
        }
    }

    /// @dev True iff collateral value ≥ principal * lltv / BASIS_POINTS.
    function _isHealthy(Loan storage loan) internal view returns (bool) {
        uint256 totalValue = _computeLoanCollateralValue(loan);
        uint256 threshold  = Math.mulDiv(loan.principal, loan.lltv, BASIS_POINTS);
        return totalValue >= threshold;
    }

    function _allCollateralZero(Loan storage loan) internal view returns (bool) {
        for (uint256 i; i < loan.collateralAssets.length; ++i) {
            if (loan.collateralAmounts[i] > 0) return false;
        }
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal: interest
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Simple interest, APR, pro-rated to elapsed seconds.
    function _accrued(uint256 principal, uint256 rate, uint256 originationDate)
        internal view returns (uint256)
    {
        uint256 elapsed = block.timestamp - originationDate;
        return Math.mulDiv(Math.mulDiv(principal, rate, BASIS_POINTS), elapsed, SECONDS_PER_YEAR);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal: helpers
    // ─────────────────────────────────────────────────────────────────────────

    function _statusString(LoanStatus s) internal pure returns (string memory) {
        if (s == LoanStatus.Active)     return "Active";
        if (s == LoanStatus.Repaid)     return "Repaid";
        if (s == LoanStatus.Liquidated) return "Liquidated";
        return "Defaulted";
    }
}
