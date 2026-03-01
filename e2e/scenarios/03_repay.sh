#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 03_repay.sh — Borrower repays the loan; lender redeems the NFT
#
# Uses the most recent loan ID. Set LOAN_ID env var to override.
#
# Expected outcome:
#   Borrower repays principal + accrued interest; gets collateral back
#   Lender redeems NFT and receives principal + interest
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
source "$(dirname "$0")/_common.sh"

NEXT=$(next_loan_id)
LOAN_ID="${LOAN_ID:-$((NEXT - 1))}"

header "Repaying loan $LOAN_ID"

# ── Pre-state ─────────────────────────────────────────────────────────────────
BORROWER_USDC_BEFORE=$(token_balance "$USDC" "$BORROWER")
BORROWER_WBTC_BEFORE=$(token_balance "$WBTC" "$BORROWER")
LENDER1_USDC_BEFORE=$(token_balance "$USDC" "$LENDER1")

info "Borrower USDC before repay: $BORROWER_USDC_BEFORE"
info "Borrower WBTC before repay: $BORROWER_WBTC_BEFORE"

# Check loan status
LOAN=$(cast call "$CONTRACT_ADDRESS" \
  "getLoan(uint256)(address,address,address,address[],uint256[],uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint8)" \
  "$LOAN_ID" --rpc-url "$RPC_URL")
STATUS=$(echo "$LOAN" | awk 'NR==13')
PRINCIPAL=$(echo "$LOAN" | awk 'NR==6')
info "Loan status: $STATUS (expected 0 = Active)"
info "Principal:   $PRINCIPAL"

if [[ "$STATUS" != "0" ]]; then
  echo -e "${RED}ERROR: Loan $LOAN_ID is not Active (status=$STATUS). Cannot repay.${NC}" >&2
  exit 1
fi

# ── Mint interest buffer for borrower ────────────────────────────────────────
# Borrower has the principal but needs extra USDC to cover accrued interest.
# Mint 10 USDC buffer via MockERC20.mint (deployer can call this).
INTEREST=$(cast call "$CONTRACT_ADDRESS" "getAccruedInterest(uint256)(uint256)" "$LOAN_ID" --rpc-url "$RPC_URL")
info "Accrued interest so far: $INTEREST"

BUFFER=10000000  # 10 USDC — more than enough for a few seconds of 5.5% APR on 999 USDC
cast send "$USDC" "mint(address,uint256)" "$BORROWER" "$BUFFER" \
  --rpc-url "$RPC_URL" --private-key "$DEPLOYER_KEY" --quiet
ok "Minted $BUFFER USDC interest buffer to borrower"

# ── Repay ─────────────────────────────────────────────────────────────────────
header "Sending repay()"
TX=$(csend "$BORROWER_KEY" "repay(uint256)" "$LOAN_ID")
ok "repay tx: $TX"

# ── Verify repayment ──────────────────────────────────────────────────────────
header "Verifying repayment"
LOAN_STATUS=$(cast call "$CONTRACT_ADDRESS" \
  "getLoan(uint256)(address,address,address,address[],uint256[],uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint8)" \
  "$LOAN_ID" --rpc-url "$RPC_URL" | awk 'NR==13')
ok "Loan status: $LOAN_STATUS  (expected 1 = Repaid)"

BORROWER_WBTC_AFTER=$(token_balance "$WBTC" "$BORROWER")
WBTC_RETURNED=$((BORROWER_WBTC_AFTER - BORROWER_WBTC_BEFORE))
ok "Borrower WBTC returned: $WBTC_RETURNED  (expected 100000000 = 1 BTC)"

# ── Lender redeems NFT ────────────────────────────────────────────────────────
header "Lender1 redeeming NFT (token ID = $LOAN_ID)"
# loanToNft(loanId) → tokenId (same as loanId in this sequential deployment)
TOKEN_ID=$(cast call "$CONTRACT_ADDRESS" "loanToNft(uint256)(uint256)" "$LOAN_ID" --rpc-url "$RPC_URL")
NFT_OWNER=$(cast call "$CONTRACT_ADDRESS" "ownerOf(uint256)(address)" "$TOKEN_ID" --rpc-url "$RPC_URL")
info "NFT token $TOKEN_ID owner: $NFT_OWNER"

TX=$(csend "$LENDER1_KEY" "redeem(uint256)" "$TOKEN_ID")
ok "redeem tx: $TX"

LENDER1_USDC_AFTER=$(token_balance "$USDC" "$LENDER1")
LENDER_RECEIVED=$((LENDER1_USDC_AFTER - LENDER1_USDC_BEFORE))
ok "Lender1 USDC received: $LENDER_RECEIVED  (expected ≥ $PRINCIPAL = principal + interest)"

# ── Verify backend ────────────────────────────────────────────────────────────
header "Verifying backend (waiting 3s)"
sleep 3

BACKEND_STATUS=$(curl -sf "http://localhost:3001/api/v1/loans/$LOAN_ID" | jq -r '.loan.status')
ok "Backend loan $LOAN_ID status: $BACKEND_STATUS  (expected repaid)"

echo ""
echo -e "${GREEN}Scenario 3 complete.${NC}"
echo ""
echo "Next: run 04_liquidate.sh (creates a fresh loan and liquidates it)."
