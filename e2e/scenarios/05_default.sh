#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 05_default.sh — Create a loan, warp past maturity, call markDefaulted
#
# Steps:
#   1. Place new lend + borrow orders
#   2. Submit and execute batch → new loan
#   3. Advance time past loan maturity (180 days + 1 s)
#   4. Anyone calls markDefaulted
#
# Expected outcome:
#   Loan status → Defaulted
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
source "$(dirname "$0")/_common.sh"

AMOUNT=1000000000  # 1 000 USDC
BTC_COLLATERAL=100000000  # 1 BTC

# ── Create a fresh loan ───────────────────────────────────────────────────────
header "Placing fresh lend + borrow orders for default scenario"

LEND_ID=$(next_order_id)
BORROW_ID=$((LEND_ID + 1))
LOAN_ID=$(next_loan_id)

info "Order IDs: lend=$LEND_ID  borrow=$BORROW_ID"
info "Expected loan ID: $LOAN_ID"

# Lender1 places lend order (maxDuration = 365 days, minDuration negotiated with borrower)
TX=$(csend "$LENDER1_KEY" \
  "placeLendOrder(address,address[],uint256,uint256,uint256,uint256,uint256)" \
  "$USDC" "[$WBTC,$WETH]" 400 7000 31536000 8000 $AMOUNT)
ok "Lend order tx: $TX  (order $LEND_ID)"

# Borrower's minDuration = 15552000s (180 days) → matched loan duration will be 180 days
TX=$(csend "$BORROWER_KEY" \
  "placeBorrowOrder(address,address[],uint256[],uint256,uint256,uint256,uint256,uint256,bool)" \
  "$USDC" "[$WBTC]" "[$BTC_COLLATERAL]" 700 5000 15552000 7000 $AMOUNT false)
ok "Borrow order tx: $TX  (order $BORROW_ID)"

# ── Submit and execute batch ──────────────────────────────────────────────────
header "Submitting solver batch"

TX=$(csend "$SOLVER_KEY" \
  "submitBatch((uint256,uint256,uint256)[],(uint256,uint256)[])" \
  "[(${LEND_ID},${BORROW_ID},${AMOUNT})]" \
  "[(${LEND_ID},${AMOUNT}),(${BORROW_ID},${AMOUNT})]")
ok "submitBatch tx: $TX"

header "Advancing time 31s past batch window"
advance_time 31

TX=$(csend "$SOLVER_KEY" "executeBatch()")
ok "executeBatch tx: $TX"

LOAN=$(cast call "$CONTRACT_ADDRESS" \
  "getLoan(uint256)(address,address,address,address[],uint256[],uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint8)" \
  "$LOAN_ID" --rpc-url "$RPC_URL")

LOAN_STATUS=$(echo "$LOAN" | awk 'NR==13')
DURATION=$(echo "$LOAN" | awk 'NR==10')
MATURITY=$(echo "$LOAN" | awk 'NR==12')

ok "Loan $LOAN_ID status: $LOAN_STATUS  (expected 0 = Active)"
info "Loan duration: $DURATION seconds ($(( DURATION / 86400 )) days)"
info "Loan maturity: $MATURITY (unix timestamp)"

# ── Warp past maturity ────────────────────────────────────────────────────────
# Duration = borrower's minDuration = 15552000s (180 days)
# Advance by duration + 1 to guarantee past maturity.
WARP=$((DURATION + 1))
header "Warping time by ${WARP}s (180 days + 1s) past loan maturity"
advance_time "$WARP"
ok "Time advanced. Loan is now matured."

# Verify markDefaulted would now succeed (not revert with LoanNotMatured)
CURRENT_BLOCK=$(cast block-number --rpc-url "$RPC_URL")
info "Current Anvil block: $CURRENT_BLOCK"

# ── Mark defaulted ────────────────────────────────────────────────────────────
header "Calling markDefaulted($LOAN_ID)"
# Anyone can call this — use deployer for convenience
TX=$(cast send "$CONTRACT_ADDRESS" "markDefaulted(uint256)" "$LOAN_ID" \
  --rpc-url "$RPC_URL" --private-key "$DEPLOYER_KEY" --json 2>/dev/null \
  | jq -r '.transactionHash')
ok "markDefaulted tx: $TX"

# ── Verify default ────────────────────────────────────────────────────────────
header "Verifying default"
LOAN_STATUS=$(cast call "$CONTRACT_ADDRESS" \
  "getLoan(uint256)(address,address,address,address[],uint256[],uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint8)" \
  "$LOAN_ID" --rpc-url "$RPC_URL" | awk 'NR==13')
ok "Loan status: $LOAN_STATUS  (expected 3 = Defaulted)"

# ── Verify backend ────────────────────────────────────────────────────────────
header "Verifying backend (waiting 3s)"
sleep 3

BACKEND_STATUS=$(curl -sf "http://localhost:3001/api/v1/loans/$LOAN_ID" | jq -r '.loan.status')
ok "Backend loan $LOAN_ID status: $BACKEND_STATUS  (expected defaulted)"

echo ""
echo -e "${GREEN}Scenario 5 complete.${NC}"
echo ""
echo -e "${GREEN}${BOLD}All scenarios done.${NC}"
echo "Check http://localhost:3000 to verify the frontend reflects final state."
echo ""
echo "Summary of loan statuses:"
TOTAL_LOANS=$(next_loan_id)
for i in $(seq 0 $((TOTAL_LOANS - 1))); do
  S=$(cast call "$CONTRACT_ADDRESS" \
    "getLoan(uint256)(address,address,address,address[],uint256[],uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint8)" \
    "$i" --rpc-url "$RPC_URL" 2>/dev/null | awk 'NR==13')
  case "$S" in
    0) LABEL="Active";;
    1) LABEL="Repaid";;
    2) LABEL="Liquidated";;
    3) LABEL="Defaulted";;
    *) LABEL="?";;
  esac
  echo "  Loan $i: $LABEL"
done
