#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 04_liquidate.sh — Create a fresh loan then crash the oracle to trigger liquidation
#
# Steps:
#   1. Place new lend + borrow orders
#   2. Submit and execute batch → new loan
#   3. Crash BTC oracle from 80 000 USDC to 500 USDC (below LLTV threshold)
#   4. Liquidator takes all collateral
#
# Expected outcome:
#   Loan status → Liquidated
#   Liquidator receives 1 BTC collateral (at crashed price + 5% bonus accounted for)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
source "$(dirname "$0")/_common.sh"

AMOUNT=1000000000  # 1 000 USDC
BTC_COLLATERAL=100000000  # 1 BTC (1e8 satoshi)

# ── Create a fresh loan ───────────────────────────────────────────────────────
header "Placing fresh lend + borrow orders for liquidation scenario"

LEND_ID=$(next_order_id)
BORROW_ID=$((LEND_ID + 1))
LOAN_ID=$(next_loan_id)

info "Order IDs: lend=$LEND_ID  borrow=$BORROW_ID"
info "Expected loan ID: $LOAN_ID"

# Lender2 places lend order
TX=$(csend "$LENDER2_KEY" \
  "placeLendOrder(address,address[],uint256,uint256,uint256,uint256,uint256)" \
  "$USDC" "[$WBTC,$WETH]" 400 7000 31536000 8000 $AMOUNT)
ok "Lend order tx: $TX  (order $LEND_ID)"

# Borrower places borrow order
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
STATUS=$(echo "$LOAN" | awk 'NR==13')
ok "Loan $LOAN_ID status: $STATUS  (expected 0 = Active)"

HEALTHY=$(cast call "$CONTRACT_ADDRESS" "isHealthy(uint256)(bool)" "$LOAN_ID" --rpc-url "$RPC_URL")
ok "isHealthy before crash: $HEALTHY  (expected true)"

# ── Crash oracle ──────────────────────────────────────────────────────────────
header "Crashing BTC oracle: 80 000 → 500 USDC"
# LLTV threshold = principal * lltv / 10000 ≈ 999e6 * 7000 / 10000 = 699.3e6
# Collateral value at new price = 500e6 * 1e8 / 1e8 = 500e6 < 699.3e6 → unhealthy
cast send "$BTC_ORACLE" "setPrice(uint256)" 500000000 \
  --rpc-url "$RPC_URL" --private-key "$DEPLOYER_KEY" --quiet
ok "BTC oracle set to 500 USDC/BTC"

HEALTHY=$(cast call "$CONTRACT_ADDRESS" "isHealthy(uint256)(bool)" "$LOAN_ID" --rpc-url "$RPC_URL")
ok "isHealthy after crash: $HEALTHY  (expected false)"

# ── Liquidate ─────────────────────────────────────────────────────────────────
header "Liquidating loan $LOAN_ID"

LIQ_WBTC_BEFORE=$(token_balance "$WBTC" "$LIQUIDATOR")
LIQ_USDC_BEFORE=$(token_balance "$USDC" "$LIQUIDATOR")
info "Liquidator WBTC before: $LIQ_WBTC_BEFORE"
info "Liquidator USDC before: $LIQ_USDC_BEFORE"

# liquidate(loanId, collateralAssets[], collateralAmounts[])
TX=$(csend "$LIQUIDATOR_KEY" \
  "liquidate(uint256,address[],uint256[])" \
  "$LOAN_ID" "[$WBTC]" "[$BTC_COLLATERAL]")
ok "liquidate tx: $TX"

# ── Verify liquidation ────────────────────────────────────────────────────────
header "Verifying liquidation"
LOAN_STATUS=$(cast call "$CONTRACT_ADDRESS" \
  "getLoan(uint256)(address,address,address,address[],uint256[],uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint8)" \
  "$LOAN_ID" --rpc-url "$RPC_URL" | awk 'NR==13')
ok "Loan status: $LOAN_STATUS  (expected 2 = Liquidated)"

LIQ_WBTC_AFTER=$(token_balance "$WBTC" "$LIQUIDATOR")
LIQ_USDC_AFTER=$(token_balance "$USDC" "$LIQUIDATOR")
WBTC_GAINED=$((LIQ_WBTC_AFTER - LIQ_WBTC_BEFORE))
USDC_SPENT=$((LIQ_USDC_BEFORE - LIQ_USDC_AFTER))
ok "Liquidator WBTC gained: $WBTC_GAINED  (expected $BTC_COLLATERAL = 1 BTC)"
ok "Liquidator USDC spent:  $USDC_SPENT"

# ── Restore oracle for future scenarios ───────────────────────────────────────
header "Restoring BTC oracle to 80 000 USDC"
cast send "$BTC_ORACLE" "setPrice(uint256)" 80000000000 \
  --rpc-url "$RPC_URL" --private-key "$DEPLOYER_KEY" --quiet
ok "BTC oracle restored to 80 000 USDC/BTC"

# ── Verify backend ────────────────────────────────────────────────────────────
header "Verifying backend (waiting 3s)"
sleep 3

BACKEND_STATUS=$(curl -sf "http://localhost:3001/api/v1/loans/$LOAN_ID" | jq -r '.loan.status')
ok "Backend loan $LOAN_ID status: $BACKEND_STATUS  (expected liquidated)"

EVENT_TYPE=$(curl -sf "http://localhost:3001/api/v1/loans/$LOAN_ID" \
  | jq -r '.events[0].eventType')
ok "Backend event type: $EVENT_TYPE  (expected liquidated)"

echo ""
echo -e "${GREEN}Scenario 4 complete.${NC}"
echo ""
echo "Next: run 05_default.sh."
