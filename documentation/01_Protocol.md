
## Design Philosophy: Constraint-Based Matching

An order in this protocol has many dimensions: collateral asset, borrow asset, duration, LTV, LLTV, rate, and amount. Rather than fixing all dimensions except rate into predefined **markets** (the approach taken by Morpho Blue and Term Finance), this protocol uses **constraint-based matching**: each order encodes preferences across all dimensions as individual constraints, and two orders match if their constraints are simultaneously satisfiable.

This is formally a **multi-dimensional double auction**. Real-world analogues: CoW Protocol, UniswapX — both use intent/constraint-based matching where orders express desired outcomes rather than market membership.

**Why not market segmentation?** Market segmentation (fixing `collateralAsset, borrowAsset, duration, LTV, LLTV` as a market key) simplifies matching to a 1D orderbook but at significant cost: lenders must split capital across multiple markets to express different LTV or maturity preferences, liquidity fragments across thin books, and the approach has no precedent in constraint-based lending. This protocol prioritizes capital efficiency and expressiveness over matching simplicity, accepting the need for off-chain solver infrastructure in exchange.

---

## Orders

Orders are stored on-chain (or as signed off-chain messages in a public mempool). Funds and collateral are locked at order placement.

### LendOrder

```
LendOrder {
  borrowAsset:          address    // exact asset to lend (e.g. USDC)
  acceptableCollateral: address[]  // set of collateral assets lender will accept
  minRate:              uint       // minimum annualized rate (basis points)
  maxLTV:               uint       // max LTV willing to accept (basis points)
  maxDuration:          uint       // maximum loan duration lender will accept (seconds)
  maxLLTV:              uint       // maximum liquidation LTV lender will accept (basis points)
  amount:               uint       // total principal to lend (in borrowAsset)
  filledAmount:         uint       // amount matched so far (starts at 0)
  owner:                address
  timestamp:            uint       // placement time (for time-priority tiebreaking)
}
```

Funds locked at placement: `amount` of `borrowAsset` is locked in the contract.

### BorrowOrder

```
BorrowOrder {
  borrowAsset:       address    // exact asset to borrow (e.g. USDC)
  collateralAssets:  address[]  // set of collateral assets the borrower is posting
  collateralAmounts: uint[]     // amount of each collateral asset locked (parallel to collateralAssets)
  maxRate:           uint       // maximum annualized rate willing to pay (basis points)
  minLTV:            uint       // minimum aggregate LTV the borrower will accept (basis points)
  minDuration:       uint       // minimum loan duration the borrower will accept (seconds)
  minLLTV:           uint       // minimum liquidation LTV the borrower will accept (basis points)
  amount:            uint       // principal desired (in borrowAsset)
  filledAmount:      uint       // amount matched so far (starts at 0)
  fillOrKill:        bool       // if true, must be filled in full within a single batch or skipped entirely
  owner:             address
  timestamp:         uint
}
```

Collateral locked at placement: all assets and amounts in `collateralAssets` / `collateralAmounts` are locked in the contract. The aggregate value `Σ(price_i × collateralAmount_i)` must satisfy the LTV constraint at match time. The borrower may post more collateral than the minimum implied by `minLTV`.

### Partial Fills

Both order types are partially fillable. `filledAmount` tracks matched principal. The unfilled remainder stays live and is available for future batch windows. On cancellation, remaining locked funds/collateral are returned.

---

## Matching: Batch Auction

### Overview

Matching is not continuous. Orders accumulate in a pool and are matched in **discrete batch windows** (every `batchWindowSeconds` seconds). Off-chain **solvers** compete to find the best set of matches for each batch. The solver submitting the highest-scoring valid batch wins and earns the solver fee. The on-chain contract executes the winning batch.

This architecture keeps expensive search off-chain (solvers) while keeping verification on-chain (the contract checks constraints per pair in O(1)).

### Compatibility

Two orders — a `LendOrder L` and a `BorrowOrder B` — are **compatible** if and only if all of the following hold simultaneously:

1. `B.collateralAssets ⊆ L.acceptableCollateral`
2. `B.borrowAsset = L.borrowAsset`
3. `L.minRate ≤ B.maxRate`
4. `B.minLTV ≤ L.maxLTV`
5. `B.minDuration ≤ L.maxDuration`
6. `B.minLLTV ≤ L.maxLLTV`

If any condition fails, the pair cannot match.

### Objective Function: Maximum Weight Bipartite Matching

For each batch window, the solver's goal is to find the assignment of lend orders to borrow orders that **maximizes total surplus**:

```
Surplus = Σ (B.maxRate − L.minRate) × matchedPrincipal
```

where the sum is over all matched pairs in the batch, and `matchedPrincipal = min(L.remainingAmount, B.remainingAmount)`.

This reduces to a **maximum weight bipartite matching** problem:
- Left nodes = lend orders
- Right nodes = borrow orders
- Edge between L and B exists iff they are compatible; edge weight = `(B.maxRate − L.minRate) × min(L.remainingAmount, B.remainingAmount)`
- No edge (weight = 0) if incompatible

Solvers compute this using standard algorithms (e.g. Hungarian algorithm, O(V·E·log V)) and submit the resulting set of `(lendOrderId, borrowOrderId, amount)` tuples to the contract.

**Why surplus = rate spread × principal?** LTV, LLTV, and duration are binary constraints — a pair either satisfies them or doesn't. They create no surplus. The only continuous value dimension is the rate spread: if a borrower is willing to pay up to 7% and a lender requires at least 4%, the match creates 3% × principal of "room" that wasn't there before. Weighting by principal ensures large high-spread matches are prioritized over small ones.

### Solver Competition

Multiple solvers can submit batches for the same window. The **contract selects the batch with the highest total surplus** among all valid submissions. A batch is valid if every proposed pair satisfies all 6 compatibility conditions.

The contract does **not** verify that the batch is globally optimal — it only verifies validity and compares surplus scores across submissions. Permissionless solver participation (anyone can compute and submit a batch) drives competition toward the optimal solution.

#### Submission Mechanism: Running Best with Time-Priority Tiebreaker

The contract uses a **running best** model: as each solver submission arrives, the contract verifies it and replaces the current winning batch if and only if the new submission has strictly higher surplus. The current winner is tracked continuously; no end-of-window comparison scan is needed.

```
currentBestSurplus = 0
currentWinner = null

function submitBatch(pairs[], consumptions[]):
  surplus = verifyAndComputeSurplus(pairs, consumptions)  // reverts if any check fails
  if surplus > currentBestSurplus:
    currentBestSurplus = surplus
    currentWinner = (msg.sender, pairs)
```

**Tiebreaker**: If two submissions produce equal surplus, the earlier submission (lower block number, or lower transaction index within the same block) wins. First valid submission at a given surplus level holds the winning position unless strictly beaten.

#### Batch Submission Format and Verification

Solvers submit two parallel structures:

```
pairs[]:        (lendOrderId, borrowOrderId, amount)[]
consumptions[]: (orderId, totalConsumed)[]   // one entry per unique order referenced in pairs[], sorted by orderId
```

The solver pre-aggregates how much of each order's capacity is consumed across all pairs in the batch. The contract verifies in two passes with no state changes until both pass:

**Pass 1 — Pair validity** (O(k), k = number of pairs):
For each `(lendOrderId, borrowOrderId, amount)`:
- Check all 6 compatibility conditions
- Check `amount > 0`
- Check `fillOrKill` constraint: if `B.fillOrKill == true`, assert `amount == B.amount - B.filledAmount`
- Accumulate `amount` into the expected consumption total for `lendOrderId` and `borrowOrderId`

**Pass 2 — Consumption verification** (O(u), u = number of unique orders):
For each `(orderId, totalConsumed)` in `consumptions[]`:
- Assert `totalConsumed` matches the accumulated total from Pass 1 (solver's pre-aggregation is correct)
- Assert `totalConsumed ≤ order.amount - order.filledAmount` (no order is over-consumed)

If either pass finds any violation the entire submission reverts. No partial execution occurs.

**Execution** (only runs if both passes succeed):
Apply all state changes atomically — update `filledAmount` for every order, create loans, mint NFTs, transfer assets.

This design offloads aggregation work to the solver (which already has full knowledge of its own batch) and keeps the contract's role as a verifier, consistent with the broader architecture of off-chain computation and on-chain verification.

**Why running best over commit-reveal**: A commit-reveal scheme (solvers first submit a hash, then reveal plaintext in a second phase) was considered and rejected for this protocol:

- The primary threat commit-reveal defends against — a solver copying another's revealed batch — does not apply here. To displace a submission, a solver must find a **strictly higher surplus matching**. Surplus is determined by which order pairs are proposed; you cannot increment it by copying. A copied batch produces equal surplus and loses on time-priority.
- Non-reveal (a solver commits a hash but never reveals) is a forfeiture, not a grief — the auction proceeds normally with all solvers who did reveal.
- Running best has lower latency (one phase, not two), requires no solver bonding or slashing mechanism, and is simpler to implement and verify on-chain.
- Block-proposer MEV exposure is symmetric across both schemes; commit-reveal does not eliminate it.

Per-submission gas cost is O(k + u) where k = number of pairs and u = unique orders referenced. Only the current winning batch is stored; losing submissions are discarded after comparison.

### Worked Example

**Order pool:**

| Order | Type | borrowAsset | collateralAssets | minRate / maxRate | maxLTV / minLTV | duration |
|---|---|---|---|---|---|---|
| L1 | Lend | USDC | {BTC, ETH} | min 4% | maxLTV 70% | maxDuration 2y |
| L2 | Lend | USDC | {BTC} | min 3.5% | maxLTV 70% | maxDuration 2y |
| B1 | Borrow | USDC | BTC | max 7% | minLTV 65% | minDuration 1y |
| B2 | Borrow | USDC | ETH | max 5% | minLTV 70% | minDuration 1y |

Each principal = 100 USDC.

**Compatibility check:**

- L1 × B1: BTC ∈ {BTC,ETH} ✓, minRate 4% ≤ maxRate 7% ✓, minLTV 65% ≤ maxLTV 70% ✓, minDuration 1y ≤ maxDuration 2y ✓ → **compatible**, spread = 3%
- L1 × B2: ETH ∈ {BTC,ETH} ✓, minRate 4% ≤ maxRate 5% ✓, minLTV 70% ≤ maxLTV 70% ✓, minDuration 1y ≤ maxDuration 2y ✓ → **compatible**, spread = 1%
- L2 × B1: BTC ∈ {BTC} ✓, minRate 3.5% ≤ maxRate 7% ✓, minLTV 65% ≤ maxLTV 70% ✓, minDuration 1y ≤ maxDuration 2y ✓ → **compatible**, spread = 3.5%
- L2 × B2: BTC ∉ {ETH only... wait, B2 is ETH collateral} → ETH ∉ {BTC} → **incompatible**

**Bipartite graph edge weights** (weight = spread × principal):

| | B1 (100 USDC) | B2 (100 USDC) |
|---|---|---|
| L1 | 3.0 | 1.0 |
| L2 | 3.5 | — (incompatible) |

**Optimal matching:** assign L2→B1 (weight 3.5) and L1→B2 (weight 1.0). Total surplus = 4.5.

Alternative: L1→B1 (3.0) and L2 unmatched, B2 unmatched. Total surplus = 3.0. Worse.

**Winning batch**: `[(L2, B1, 100 USDC), (L1, B2, 100 USDC)]`, surplus = 4.5.

### Execution Terms

Each matched pair produces a loan with fully determined terms. Execution values are set as follows:

| Dimension | Execution value | Favors |
|---|---|---|
| Rate | `(L.minRate + B.maxRate) / 2` | Neither — surplus split equally |
| LTV | `B.minLTV` | Lender — borrower posts maximum collateral within the compatible range |
| LLTV | `B.minLLTV` | Lender — liquidation triggers as early as borrower's floor allows |
| Duration | `B.minDuration` | Lender — shortest loan the borrower will accept, minimising duration risk |

**Rate** is the only dimension settled at the midpoint because it has a continuous monetary surplus `(B.maxRate − L.minRate) × principal` to split equally between the two parties.

**LTV, LLTV, and duration** all settle at the borrower's floor. In each case the borrower's preference runs in one direction and the lender's in the other, and the compatible range spans from the borrower's floor to the lender's ceiling. Settling at the borrower's floor is consistently lender-favored:
- Lower LTV → borrower posts more collateral than the lender's ceiling requires
- Lower LLTV → liquidation triggers earlier than the lender's ceiling requires
- Shorter duration → lender bears less duration risk than their ceiling allows

The lender's ceiling defines what they will tolerate; the borrower's floor defines what they need. Settling at the floor gives the lender better-than-minimum terms on every non-rate dimension.

**Example (continued):**
- L2→B1: rate = (3.5% + 7%) / 2 = **5.25%**, LTV = **65%**, duration = **B1.minDuration**
- L1→B2: rate = (4% + 5%) / 2 = **4.5%**, LTV = **70%**, duration = **B2.minDuration**

### Permissionless Solver Participation

Solver participation is fully permissionless — anyone can compute and submit a batch. This is the censorship protection mechanism: if a user's order is being ignored, they can run a solver themselves and submit a batch that includes their order alongside others. This is strictly better than a single-pair self-fill because it participates in the full surplus-maximising matching rather than bypassing it.

---

## Loan Lifecycle

When a pair is matched in a winning batch, a loan is created encoding the exact agreed terms:

```
Loan {
  lender:            address
  borrower:          address
  borrowAsset:       address
  collateralAssets:  address[]  // collateral assets posted (= B.collateralAssets)
  collateralAmounts: uint[]     // amounts locked per asset (parallel to collateralAssets)
  principal:         uint       // borrowAsset lent
  rate:              uint       // agreed annualized rate (basis points) — midpoint
  ltv:               uint       // execution LTV (= B.minLTV)
  lltv:              uint       // liquidation threshold (= B.minLLTV)
  duration:          uint       // loan duration in seconds (= B.minDuration)
  originationDate:   timestamp
  maturityDate:      timestamp  // originationDate + duration
  status:          Active | Repaid | Liquidated | Defaulted
}
```

**Active**: Collateral locked in the protocol. Borrower holds the principal. Interest accrues from `originationDate` to `maturityDate`.

**Repaid**: Borrower returns `principal + accrued interest` at or before maturity. Collateral is released back to the borrower. Lender NFT becomes redeemable.

**Liquidated**: LLTV threshold was breached during the loan's life. A liquidator purchased some or all of the collateral. If fully closed, the lender NFT is immediately redeemable. If partially liquidated, the loan remains Active with reduced collateral.

**Defaulted**: Loan reached maturity without repayment and without a prior LLTV breach. Collateral is available for liquidation by external liquidators.

### Repayment

The borrower must repay `principal + accrued interest` before `maturityDate` (`originationDate + duration`). There is no grace period — at `maturityDate` the loan immediately transitions to `Defaulted` and the collateral becomes liquidatable by any external address.

### Interest Calculation

Simple interest, APR convention, calculated at repayment or liquidation time:

```
interest = principal × rate × elapsedSeconds / (365 days in seconds)
totalRepayment = principal + interest
```

No on-chain state is updated during the loan's life. Interest is pure arithmetic over the loan's stored fields (`principal`, `rate`, `originationDate`). A lender can query accrued interest at any moment via a view function using `block.timestamp`.

**Early repayment**: Interest is pro-rated to elapsed time only — the borrower pays `principal × rate × elapsed / (365 days)`, not the full term's interest.

**Continuous cash flow**: Not supported. The contract holds only the borrower's collateral, not their wallet balance. No intermediate payments can be enforced. Lenders accrue interest as a readable value but receive no tokens until maturity, early repayment, or liquidation settlement — equivalent to a zero-coupon bond from a cash flow perspective.

---

## Lender Positions (NFT)

When a lender's order is matched (fully or partially), they receive an **NFT** representing their position in that specific loan. Each NFT encodes the exact terms of its loan.

### Non-Fungibility

Unlike market-segmentation protocols where all loans within a market share identical terms, loans in this protocol have heterogeneous terms — different rates (each pair's midpoint), different LTVs, different durations, and potentially different collateral asset baskets. No two loans are guaranteed to be identical, so ERC-20 position tokens are not appropriate. Each lender position is an NFT encoding:

```
LenderNFT {
  loanId:           uint
  lender:           address
  principal:        uint
  rate:             uint
  maturityDate:     timestamp
  borrowAsset:      address
  collateralAssets: address[]
  ltv:              uint
  lltv:             uint
}
```

### Secondary Market

NFTs are freely transferable and tradeable on any NFT marketplace or secondary market. Lenders who wish to exit before maturity can sell their NFT. The buyer holds the same redemption right at maturity.

At maturity (or after liquidation/default is settled), the NFT holder redeems it for `principal + accrued interest`.

---

## Liquidations

### During-Life Liquidation (LLTV Breach)

While a loan is Active, the protocol monitors the aggregate collateral-to-loan ratio using on-chain price oracles. If:

```
Σ(price_i × collateralAmount_i) / principal < lltv
```

the loan is immediately eligible for liquidation.

Liquidation is permissionless — any external address can trigger it.

**Partial liquidation**: Liquidators may purchase any subset of the collateral, not necessarily all of it. This protects the borrower from losing more collateral than needed to restore the loan to health. The constraint is that after the liquidation the loan is either fully closed or the remaining collateral satisfies the LLTV threshold again.

**Process:**
1. Any external liquidator triggers the liquidation, specifying which collateral assets and amounts they wish to purchase.
2. The liquidator pays the repayment amount covering the portion they are liquidating.
3. The liquidator receives their chosen collateral assets plus a **liquidation bonus** (`liquidationBonusRate`, fixed protocol-wide in basis points, set at deployment).
4. Remaining collateral stays locked in the loan (if partially liquidated and loan is still active) or is returned to the borrower (if loan is fully closed).
5. Loan status → `Liquidated` only if fully closed; otherwise remains `Active` with updated collateral amounts.

**Bad debt**: If collateral value is insufficient to cover the full repayment (e.g. sharp price drop or oracle lag), the shortfall is absorbed solely by the lender who originated that loan. Bad debt does not affect any other lender or loan in the protocol — each loan is fully isolated.

### Post-Maturity Default

If a loan reaches `maturityDate` without full repayment:

1. Loan transitions to `Defaulted` immediately.
2. Any external liquidator can claim the collateral by repaying the outstanding `principal + accrued interest`.
3. Lender NFT becomes redeemable once liquidation is settled.

---

## Outstanding Questions

### A. Interest Mechanics
**Decided.** Simple interest, APR, calculated at repayment/liquidation time. Early repayment is pro-rated to elapsed time. No continuous cash flow — lenders receive a bullet payment at maturity or liquidation. See Interest Calculation section.

### B. Batch Window
**Decided.** Fixed duration in seconds, configurable as `batchWindowSeconds` at deployment time. Does not vary by order volume. The specific value is an operational parameter chosen per deployment (e.g. per chain/L2) based on latency vs. solver competition tradeoffs.

### C. Solver Fee Mechanism
**Decided.** Percentage of matched principal (`solverFeeRate` in basis points, set at deployment). For each pair, `fee = amount × solverFeeRate / 10000` is computed and accumulated; `loan.principal = amount - fee`. A single aggregate transfer of `Σ(fees)` is sent to the winning solver at batch execution. Lend order `filledAmount` updates are unchanged — the fee is purely a routing decision at execution time.

### D. Self-Fill Mechanics
**Removed.** Single-pair self-fills are incompatible with the solver-based design — they bypass the surplus-maximising batch mechanism and produce sub-optimal outcomes for the order pool. Censorship protection is provided by permissionless solver participation instead.

### E. Liquidation Mechanics
**Decided.** Permissionless execution. Partial liquidation allowed (borrower protection — only enough collateral is seized to restore health or close the loan). Liquidation bonus is fixed protocol-wide (`liquidationBonusRate`, set at deployment). Bad debt is isolated to the originating lender only — no socialization across other loans or lenders.

### F. Grace Period
**Removed.** No grace period. Loan must be repaid before `maturityDate = originationDate + duration`. At maturity the loan immediately becomes liquidatable.

### G. Oracle
**Decided.** The protocol maintains a registry mapping each whitelisted collateral asset to a designated oracle address. Oracles are configured at the protocol level (not by individual users) alongside the asset whitelist. All oracles expose a standard interface:

```
interface IOracle {
  function getPrice() external view returns (uint price);
}
```

The LLTV health check during liquidation calls `oracle.getPrice()` for each collateral asset in the loan. The specific oracle implementation (Chainlink, Pyth, Redstone, TWAP, etc.) is an operational decision per asset and per deployment — the protocol is agnostic to the underlying feed as long as it satisfies the interface.

### H. Chain / Gas Costs
**Decided.** Monad — a fully EVM-compatible L1 with ~1 second block times and high throughput. Implications:
- `batchWindowSeconds` can be set aggressively short (e.g. 10–30 seconds) without sacrificing solver competition time, given fast block production.
- Low gas costs make per-pair verification and multi-asset collateral splits practical even for large batches.
- Full EVM compatibility means no protocol changes are required relative to a standard EVM deployment.

### I. Fee Structure
**Removed.** The protocol takes no fees. It is neutral infrastructure — the only fee in the system is the solver fee, which compensates the matching solver and is not retained by the protocol.

### J. Collateral & Borrow Asset Governance
**Decided.** Immutable — the whitelisted collateral assets, borrow assets, and their oracle assignments are set at construction time and cannot be changed after deployment. No governance, no admin keys, no upgradability.

### K. Multi-Asset Collateral Liquidation Ordering
**Decided: liquidator choice.** The liquidator specifies which collateral assets and amounts to purchase. The only protocol constraint is that their payment covers `principal + accrued interest`. Unpurchased collateral is returned to the borrower. No protocol-imposed ordering or proportionality.
