#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 02_submit_execute_batch.sh — Submit a solver batch, advance time, execute
#
# Uses the most-recently-placed lend and borrow order IDs.
# Queries nextOrderId to figure out which IDs are active — assumes
# 01_place_orders.sh was the last script run.
#
# Expected outcome:
#   Loan created, rate = midpoint(400, 700) = 550 bps
#   Principal = 1 000 USDC − 0.10% fee = 999 USDC
#   Solver earns 1 USDC fee
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
source "$(dirname "$0")/_common.sh"

# ── Resolve order IDs ─────────────────────────────────────────────────────────
# If caller exported LEND_ID / BORROW_ID, use those. Otherwise assume the two
# most recently placed orders.
NEXT=$(next_order_id)
LEND_ID="${LEND_ID:-$((NEXT - 2))}"
BORROW_ID="${BORROW_ID:-$((NEXT - 1))}"

LOAN_ID=$(next_loan_id)

header "Submitting batch"
info "Lend order:   $LEND_ID"
info "Borrow order: $BORROW_ID"
info "Expected loan ID: $LOAN_ID"

SOLVER_USDC_BEFORE=$(token_balance "$USDC" "$SOLVER")
BORROWER_USDC_BEFORE=$(token_balance "$USDC" "$BORROWER")

# submitBatch(pairs[], consumptions[])
# Pair:        (lendOrderId, borrowOrderId, amount)
# Consumption: (orderId, totalConsumed) — sorted ascending by orderId
#
# With LEND_ID < BORROW_ID (lend is placed first), consumptions are already sorted.
AMOUNT=1000000000  # 1 000 USDC

TX=$(csend "$SOLVER_KEY" \
  "submitBatch((uint256,uint256,uint256)[],(uint256,uint256)[])" \
  "[(${LEND_ID},${BORROW_ID},${AMOUNT})]" \
  "[(${LEND_ID},${AMOUNT}),(${BORROW_ID},${AMOUNT})]")
ok "submitBatch tx: $TX"

WINNER=$(cast call "$CONTRACT_ADDRESS" "currentWinner()(address)" --rpc-url "$RPC_URL")
SURPLUS=$(cast call "$CONTRACT_ADDRESS" "currentBestSurplus()(uint256)" --rpc-url "$RPC_URL")
ok "Current winner:  $WINNER  (expected $SOLVER)"
ok "Current surplus: $SURPLUS  (expected 30000000 = 30 USDC at 3% spread × 1000 USDC)"

# ── Advance time past the 30-second batch window ──────────────────────────────
header "Advancing time past batch window (31 seconds)"
advance_time 31
ok "Time advanced"

# ── Execute batch ─────────────────────────────────────────────────────────────
header "Executing batch"
TX=$(csend "$SOLVER_KEY" "executeBatch()")
ok "executeBatch tx: $TX"

# ── Verify loan ───────────────────────────────────────────────────────────────
header "Verifying loan"
# getLoan returns the full Loan struct — cast decodes it positionally
LOAN=$(cast call "$CONTRACT_ADDRESS" \
  "getLoan(uint256)(address,address,address,address[],uint256[],uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint8)" \
  "$LOAN_ID" --rpc-url "$RPC_URL")

RATE=$(echo "$LOAN" | awk 'NR==7')   # rate is the 7th field
STATUS=$(echo "$LOAN" | awk 'NR==13') # status is the 13th field (0=Active)

ok "Loan $LOAN_ID rate:   $RATE bps  (expected 550)"
ok "Loan $LOAN_ID status: $STATUS     (expected 0 = Active)"

# Fee = 1000e6 * 10 / 10000 = 1 000 000 (1 USDC)
# Principal = 1000e6 - 1e6 = 999 000 000
FEE=1000000
PRINCIPAL=999000000

BORROWER_USDC_AFTER=$(token_balance "$USDC" "$BORROWER")
SOLVER_USDC_AFTER=$(token_balance "$USDC" "$SOLVER")
BORROWER_RECEIVED=$((BORROWER_USDC_AFTER - BORROWER_USDC_BEFORE))
SOLVER_RECEIVED=$((SOLVER_USDC_AFTER - SOLVER_USDC_BEFORE))

ok "Borrower received: $BORROWER_RECEIVED USDC  (expected $PRINCIPAL)"
ok "Solver received:   $SOLVER_RECEIVED USDC  (expected $FEE)"

NFT_OWNER=$(cast call "$CONTRACT_ADDRESS" "ownerOf(uint256)(address)" "$LOAN_ID" --rpc-url "$RPC_URL")
ok "NFT owner (token $LOAN_ID): $NFT_OWNER  (expected $LENDER1)"

# ── Verify backend ────────────────────────────────────────────────────────────
header "Verifying backend (waiting 3s)"
sleep 3

LOAN_STATUS=$(curl -sf "http://localhost:3001/api/v1/loans/$LOAN_ID" | jq -r '.loan.status')
ok "Backend loan $LOAN_ID status: $LOAN_STATUS  (expected active)"

BATCH_COUNT=$(curl -sf "http://localhost:3001/api/v1/batches" | jq '.batches | length')
ok "Backend batch history entries: $BATCH_COUNT  (expected ≥1)"

FILLED=$(curl -sf "http://localhost:3001/api/v1/orders?status=open" | jq '.orders | length')
ok "Remaining open orders: $FILLED  (expected 0 — both fully consumed)"

echo ""
echo -e "${GREEN}Scenario 2 complete.${NC}"
echo "  Loan ID: $LOAN_ID"
echo ""
echo "Run 03_repay.sh next."
echo "  export LOAN_ID=$LOAN_ID"
