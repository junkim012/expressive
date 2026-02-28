
## Design Philosophy

The UI targets sophisticated lenders and asset managers who monitor real-time quotes and place frequent trades. Visual style: Bloomberg terminal — dark mode only, dense information layout, minimal chrome. Three panels are visible simultaneously on the main dashboard with no wasted whitespace.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router) |
| Wallet integration | wagmi + viem |
| Styling | Dark mode only (black/dark gray background, green/amber terminal accents) |
| State | React Query for server state, wagmi for on-chain state |

---

## Pages

### 1. `/` — Main Trading Dashboard

The primary interface. Three panels always visible simultaneously. A **Lend / Borrow tab switcher** at the top of the page controls only the Order Placement Form (center panel) — the order book and positions panels are the same regardless of active tab.

**Batch status indicator**: A subtle persistent badge in the top header bar showing:
- Current batch window countdown (e.g. "Next batch in 14s")
- Current window state (Open / Executing)
- Links to `/batch` for full detail

#### Panel 1 — Order Book (left)

Split view: lend orders on the left half, borrow orders on the right half, side by side.

**Default columns (all constraints shown):**

| Column | Lend Orders | Borrow Orders |
|---|---|---|
| Rate | Min Rate | Max Rate |
| Amount | Amount (fill %) | Amount (fill %) |
| LTV | Max LTV | Min LTV |
| LLTV | Max LLTV | Min LLTV |
| Duration | Max Duration | Min Duration |
| Collateral | Acceptable Collateral | Collateral Assets |

Rates displayed as `%` (e.g. `4.50%`) with basis-point value shown in a tooltip or secondary text. Duration displayed as human-readable (e.g. `90d`, `1y`) with seconds shown alongside.

**Filters** (collapsible filter bar above the order book):
- Collateral assets (multi-select from whitelisted asset list)
- LTV range (slider or min/max inputs)
- LLTV range (slider or min/max inputs)
- Duration range (slider or min/max inputs)
- Rate range

Orders sorted by rate by default (best rate first: highest minRate for lend, lowest maxRate for borrow). Partially filled orders remain visible; fill percentage shown inline.

#### Panel 2 — Order Placement Form (center)

Form fields differ by active tab.

**Lender tab — Place Lend Order:**

| Field | Input | Notes |
|---|---|---|
| Borrow Asset | Dropdown | Whitelisted borrow assets from backend |
| Acceptable Collateral | Multi-select | Whitelisted collateral assets from backend |
| Amount | Number | In borrow asset; validates against wallet balance |
| Min Rate | Number (%) | Displayed as %; raw basis points shown alongside |
| Max LTV | Number (%) | Raw basis points shown alongside |
| Max LLTV | Number (%) | Raw basis points shown alongside |
| Max Duration | Number (days) | Human-readable; raw seconds shown alongside |

**Borrower tab — Place Borrow Order:**

| Field | Input | Notes |
|---|---|---|
| Borrow Asset | Dropdown | Whitelisted borrow assets |
| Amount Desired | Number | Principal in borrow asset |
| Collateral | Repeatable rows: Asset + Amount | One row per collateral asset; multi-asset supported |
| Max Rate | Number (%) | Raw basis points shown alongside |
| Min LTV | Number (%) | Raw basis points shown alongside |
| Min LLTV | Number (%) | Raw basis points shown alongside |
| Min Duration | Number (days) | Raw seconds shown alongside |
| Fill-or-Kill | Toggle | Must be filled in full or skipped entirely |

**Validation (both forms):**
- Required fields all filled
- Numeric ranges valid (rates 0–100%, LTV 0–100%, duration > 0)
- Amount ≤ wallet balance (lender) / collateral amounts ≤ wallet balances (borrower)
- At least one collateral asset selected (lender) / at least one collateral row (borrower)

No match-likelihood hints. No auto-suggest. Submit triggers wallet signing and on-chain transaction.

**No wallet connected**: Form is visible but all inputs are disabled; a "Connect Wallet" prompt replaces the submit button.

#### Panel 3 — My Positions (right)

Always shows both lender and borrower positions regardless of active tab. Scrollable mini-table.

Two sections:

**Lend-side:**
- Open lend orders: order ID, amount, fill %, rate, status
- Active lend-side loans: loan ID, principal, rate, maturity, health indicator

**Borrow-side:**
- Open borrow orders: order ID, amount, fill %, rate, status
- Active borrow-side loans: loan ID, principal, rate, maturity, collateral health bar

Clicking any loan row opens the **Loan Detail Modal** (see below). Links to `/positions` for full history.

---

### 2. `/positions` — Full Positions

Full-page view of all user positions. Two permanent sections (always both visible, no tab switching required):

**Lender Section:**
- **Pending Orders** sub-table: all open lend orders with fill progress bar, order parameters, cancel placeholder (v2 — cancellation not supported in v1 contract)
- **Active Loans** sub-table: all active lend-side loans with loan ID, counterparty (borrower address truncated), principal, rate, maturity date, current health

**Borrower Section:**
- **Pending Orders** sub-table: all open borrow orders with fill progress, order parameters
- **Active Loans** sub-table: all active borrow-side loans with loan ID, principal, rate, maturity, collateral health bar, repay button

Each row in Active Loans is clickable → opens Loan Detail Modal.

Past loans (Repaid / Liquidated / Defaulted) shown in a collapsible **History** sub-table within each section.

---

### 3. `/batch` — Batch Auction

Full detail view of the batch auction system. All data polled from the contract via direct RPC.

**Current Window section:**
- Large countdown timer: time remaining until `windowStart + batchWindowSeconds`
- Current best surplus score (in borrow-asset units)
- Current winning pair count
- Table of current winning pairs: Lend Order ID | Borrow Order ID | Amount | Rate | Solver address

**Batch History table:**
- Columns: Window ID | Executed At | Solver | Total Surplus | Pairs Matched | Tx Hash (link to explorer)
- Paginated, most recent first
- Data sourced from backend (indexed `BatchExecuted` events)

---

## Loan Detail Modal

Triggered by clicking any loan row in the dashboard mini-table or /positions page.

**Content:**
- Loan ID, status badge (Active / Repaid / Liquidated / Defaulted)
- Lender / Borrower addresses (with ENS resolution if available)
- Principal, rate (displayed as % and basis points), maturity date
- Origination date, elapsed time

**Collateral Health section:**
- Per-asset collateral breakdown: asset symbol, amount locked, current oracle price, current USD value
- Aggregate health factor: `Σ(price_i × amount_i) / principal` vs LLTV threshold
- Health bar (green → yellow → red) relative to LLTV

**Actions:**
- **Repay** (borrower only, loan is Active): shows calculated total due (`principal + accrued interest`), prompts wallet to sign repayment tx. Interest displayed as `principal × rate × elapsed / 365d` with live elapsed seconds.
- **View on Explorer**: external link to block explorer transaction

---

## Data Sources

### Direct RPC Polling (wagmi / viem)

These are fetched directly from the contract — no backend required.

| Data | Call | Update frequency |
|---|---|---|
| Batch window timing | `windowStart`, read `batchWindowSeconds` (constant) | On page load; compute countdown client-side |
| Current best surplus | `currentBestSurplus` storage slot | Poll every block (~1s on Monad) |
| Current winning pairs | `currentWinningBatch` storage | Poll every block |
| Individual loan state | `loans[loanId]` | On modal open |
| Accrued interest | View function `calculateInterest(loanId)` | On modal open, refreshes every 10s |
| Collateral health | View function `getHealthFactor(loanId)` | On modal open, refreshes every 10s |
| Oracle prices | `oracle.getPrice()` per collateral asset | On modal open |
| Token balances | ERC20 `balanceOf(address)` | On order form focus, after tx confirmation |

### Backend API + WebSocket

These require event indexing and are served by the backend.

| Data | Endpoint | Notes |
|---|---|---|
| Full order book (all open orders) | `GET /orders?status=open` | Reconstructed from `LendOrderPlaced` / `BorrowOrderPlaced` events; `filledAmount` updated via `LoanCreated` event sums |
| User's lend orders | `GET /orders?owner={address}&type=lend` | Filtered by `owner` field in events |
| User's borrow orders | `GET /orders?owner={address}&type=borrow` | Filtered by `owner` field in events |
| User's loans as lender | `GET /loans?lender={address}` | Filtered by `LoanCreated.lender` |
| User's loans as borrower | `GET /loans?borrower={address}` | Filtered by `LoanCreated.borrower` |
| Loan status history | `GET /loans/{loanId}` | Includes `LoanRepaid`, `LoanLiquidated`, `LoanDefaulted` events |
| Batch history | `GET /batches` | Indexed `BatchExecuted` events |
| Whitelisted asset list | `GET /assets` | Asset addresses, symbols, decimals, logos |
| Real-time order book updates | WebSocket `ws://…/orderbook` | Pushed on new orders and fill updates |

---

## Wallet Connection

- **Connect button** in the top-right of the global header, always visible
- Clicking opens a wallet selection modal: MetaMask, WalletConnect, Coinbase Wallet
- Once connected: header shows truncated address, balance in borrow asset, and a disconnect option
- No wallet connected: read-only mode — order book and batch page are fully visible; order placement form is disabled

---

## Input & Display Conventions

| Value | Entry format | Display format | Raw shown alongside |
|---|---|---|---|
| Rate | `4.5` (interpreted as %) | `4.50%` | `450 bps` |
| LTV / LLTV | `70` (interpreted as %) | `70%` | `7000 bps` |
| Duration | `90` + unit selector (days/months/years) | `90d` / `3mo` | `7776000s` |
| Amount | Standard decimal (e.g. `1000.00`) | Token symbol + amount | — |
| Address | Full hex on entry | Truncated `0x1234…abcd` with copy button | — |

---

## Outstanding Questions

### A. Order Book Real-Time Updates
**Decided.** WebSocket from backend for order book updates. Direct RPC polling for batch window state. Polling interval on Monad: ~1 second (matches block time).

### B. Liquidations UI
**Deferred to v2.** No liquidation interface in v1. Liquidation bots operate externally.

### C. NFT Transfer UI
**Deferred to v2.** Lender NFTs are freely transferable on any NFT marketplace. No in-app transfer UI in v1.

### D. Order Cancellation UI
**Not applicable.** Order cancellation is not supported by the v1 contract. UI has no cancel action.

### E. Mobile Support
**Not specified.** The dense three-panel Bloomberg-style layout is desktop-first. Mobile breakpoints are a v2 concern.

### F. Solver Frontend
**Out of scope.** Solvers interact directly with the contract. No solver-facing UI.
