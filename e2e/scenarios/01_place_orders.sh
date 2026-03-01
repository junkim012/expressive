#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 01_place_orders.sh — Place one lend order and one borrow order
#
# Lender1:  1 000 USDC at min 4% (400 bps), accepts WBTC + WETH
# Borrower: wants 1 000 USDC, posts 1 BTC, max rate 7% (700 bps)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
source "$(dirname "$0")/_common.sh"

header "Checking backend"
wait_for_backend

# ── Pre-state ─────────────────────────────────────────────────────────────────
header "Pre-state"
LEND_ID=$(next_order_id)
BORROW_ID=$((LEND_ID + 1))
info "Next order IDs will be: lend=$LEND_ID  borrow=$BORROW_ID"

L1_USDC_BEFORE=$(token_balance "$USDC" "$LENDER1")
B_WBTC_BEFORE=$(token_balance "$WBTC" "$BORROWER")
info "Lender1 USDC before: $L1_USDC_BEFORE"
info "Borrower WBTC before: $B_WBTC_BEFORE"

# ── Place lend order ──────────────────────────────────────────────────────────
header "Placing lend order (Lender1)"
# placeLendOrder(borrowAsset, acceptableCollateral[], minRate, maxLtv, maxDuration, maxLltv, amount)
TX=$(csend "$LENDER1_KEY" \
  "placeLendOrder(address,address[],uint256,uint256,uint256,uint256,uint256)" \
  "$USDC" \
  "[$WBTC,$WETH]" \
  400 \
  7000 \
  31536000 \
  8000 \
  1000000000)
ok "tx: $TX"

L1_USDC_AFTER=$(token_balance "$USDC" "$LENDER1")
ok "Lender1 USDC locked: $((L1_USDC_BEFORE - L1_USDC_AFTER)) (expected 1000000000)"

# ── Place borrow order ────────────────────────────────────────────────────────
header "Placing borrow order (Borrower)"
# placeBorrowOrder(borrowAsset, collateralAssets[], collateralAmounts[],
#                  maxRate, minLtv, minDuration, minLltv, amount, fillOrKill)
TX=$(csend "$BORROWER_KEY" \
  "placeBorrowOrder(address,address[],uint256[],uint256,uint256,uint256,uint256,uint256,bool)" \
  "$USDC" \
  "[$WBTC]" \
  "[100000000]" \
  700 \
  5000 \
  15552000 \
  7000 \
  1000000000 \
  false)
ok "tx: $TX"

B_WBTC_AFTER=$(token_balance "$WBTC" "$BORROWER")
ok "Borrower WBTC locked: $((B_WBTC_BEFORE - B_WBTC_AFTER)) (expected 100000000 = 1 BTC)"

# ── Verify contract state ─────────────────────────────────────────────────────
header "Verifying contract state"
IS_LEND=$(cast call "$CONTRACT_ADDRESS" "isLendOrder(uint256)(bool)" "$LEND_ID" --rpc-url "$RPC_URL")
ok "isLendOrder($LEND_ID) = $IS_LEND  (expected true)"
IS_BORROW=$(cast call "$CONTRACT_ADDRESS" "isLendOrder(uint256)(bool)" "$BORROW_ID" --rpc-url "$RPC_URL")
ok "isLendOrder($BORROW_ID) = $IS_BORROW  (expected false)"

# ── Verify backend ────────────────────────────────────────────────────────────
header "Verifying backend (waiting 3s for indexer)"
sleep 3

OPEN_ORDERS=$(curl -sf "http://localhost:3001/api/v1/orders?status=open" | jq '.orders | length')
ok "Open orders in backend: $OPEN_ORDERS  (expected 2)"

LEND_ORDER=$(curl -sf "http://localhost:3001/api/v1/orders?type=lend&status=open" \
  | jq -r ".orders[] | select(.orderId == \"$LEND_ID\") | .minRate")
ok "Lend order minRate: $LEND_ORDER bps  (expected 400)"

BORROW_ORDER=$(curl -sf "http://localhost:3001/api/v1/orders?type=borrow&status=open" \
  | jq -r ".orders[] | select(.orderId == \"$BORROW_ID\") | .maxRate")
ok "Borrow order maxRate: $BORROW_ORDER bps  (expected 700)"

echo ""
echo -e "${GREEN}Scenario 1 complete.${NC}"
echo "  Lend order ID:   $LEND_ID"
echo "  Borrow order ID: $BORROW_ID"
echo ""
echo "Run 02_submit_execute_batch.sh next."
echo "  export LEND_ID=$LEND_ID BORROW_ID=$BORROW_ID"
