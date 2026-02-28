
## Smart Contract Design

Single contract deployment. Modularized only if contract size limit (~24KB) is reached.

---

## Deployment Parameters (Constructor)

| Parameter | Type | Description |
|---|---|---|
| `batchWindowSeconds` | `uint256` | Duration of each batch window |
| `solverFeeRate` | `uint256` | Solver fee in basis points |
| `liquidationBonusRate` | `uint256` | Liquidation bonus in basis points |
| `collateralAssets` | `address[]` | Whitelisted collateral assets |
| `borrowAssets` | `address[]` | Whitelisted borrow assets |
| `oracles` | `address[]` | Oracle address per collateral asset (parallel to `collateralAssets`) |

All parameters and whitelists are immutable after construction.

---

## Design Decisions

### Batch Window Finalization
`submitBatch()` automatically executes the current window's winning batch and opens the next window if `block.timestamp` has passed the current `windowEnd`. No separate `finalizeBatch()` function. Keeps the auction running continuously with a single entry point.

### Order and Loan IDs
Auto-incrementing `uint256` counters (`nextOrderId`, `nextLoanId`). No collision risk — the contract assigns IDs, users never specify them. Sequential transactions in a block get sequential IDs.

### Lender Position NFT Metadata
Fully on-chain. `tokenURI` returns a base64-encoded JSON constructed from the loan's stored fields. No external server or IPFS dependency.

### Error Handling
Custom errors throughout (`error IncompatibleCollateral()`, `error OrderOverconsumed(uint256 orderId)`, etc.). Cheaper gas than revert strings and better for programmatic handling by solvers and frontends.

### Reentrancy Protection
Checks-effects-interactions (CEI) pattern only. No `ReentrancyGuard`. All state updates precede external token transfers in every function.

### Oracle Price Precision
`getPrice()` returns price with the same number of decimals as the collateral asset. The health check `Σ(price_i × collateralAmount_i) / principal` must normalize for decimal differences between collateral and borrow assets at the implementation level.

### Token Standard
Standard ERC20s only. No SafeERC20, no balance-before/after checks. Whitelisted assets at deployment are assumed to be well-behaved.

### Order Cancellation
Not supported. Orders remain live until fully filled. Eliminates cancellation state tracking and partial refund logic.

### Solidity Version
`^0.8.20` — floating pragma for maximum library compatibility during prototyping.

### Dependencies
OpenZeppelin for `ERC721` (lender NFT base), `Math.mulDiv` for overflow-safe fixed-point arithmetic in rate and LTV calculations.

### Winning Batch Storage
Full pairs array stored on-chain during the window. Replaced atomically whenever a higher-surplus submission arrives. Storage cost is acceptable on Monad.

### Batch Window Functions
Two separate entry points:
- `submitBatch(pairs[], consumptions[])` — valid only during an open window, updates running best if surplus is strictly higher
- `executeBatch()` — callable by anyone once `block.timestamp >= windowStart + batchWindowSeconds`, executes the stored winning batch and opens the next window

The winning solver is incentivized to call `executeBatch()` to collect their fee but any address can trigger it, keeping execution permissionless.

### Arithmetic
`Math.mulDiv(a, b, c)` used for all rate, LTV, and interest calculations to prevent intermediate overflow without a full fixed-point library.

### Events
Full order details emitted at placement so off-chain indexers can reconstruct the complete order book from event logs alone — no storage reads required. `LoanCreated` includes both `lendOrderId` and `borrowOrderId` so indexers can join orders to their resulting loans and reconstruct `filledAmount` per order by summing matched principal across `LoanCreated` events.

```solidity
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
```

