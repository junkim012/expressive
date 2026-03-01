#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# _common.sh — Sourced by all scenario scripts. Do not run directly.
# ─────────────────────────────────────────────────────────────────────────────

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/e2e/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: e2e/.env.local not found. Run 02_deploy.sh first." >&2
  exit 1
fi

set -a; source "$ENV_FILE"; set +a

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

# ── Helpers ───────────────────────────────────────────────────────────────────

# Print a section header
header() { echo -e "\n${BOLD}${BLUE}▶ $1${NC}"; }

# Print a success line
ok() { echo -e "  ${GREEN}✓${NC} $1"; }

# Print an info line
info() { echo -e "  ${YELLOW}→${NC} $1"; }

# cast call returning a single value, stripping trailing newline
ccall() {
  cast call "$CONTRACT_ADDRESS" "$@" --rpc-url "$RPC_URL" 2>/dev/null | tr -d '\n'
}

# cast send — broadcasts a tx and returns the tx hash
csend() {
  local key="$1"; shift
  cast send "$CONTRACT_ADDRESS" "$@" \
    --rpc-url "$RPC_URL" \
    --private-key "$key" \
    --json 2>/dev/null \
    | jq -r '.transactionHash'
}

# cast send to an arbitrary address
csend_to() {
  local key="$1"; local addr="$2"; shift 2
  cast send "$addr" "$@" \
    --rpc-url "$RPC_URL" \
    --private-key "$key" \
    --json 2>/dev/null \
    | jq -r '.transactionHash'
}

# Get the current nextOrderId (= the ID the next placed order will receive)
next_order_id() { cast call "$CONTRACT_ADDRESS" "nextOrderId()(uint256)" --rpc-url "$RPC_URL" 2>/dev/null | tr -d '\n'; }

# Get the current nextLoanId
next_loan_id() { cast call "$CONTRACT_ADDRESS" "nextLoanId()(uint256)" --rpc-url "$RPC_URL" 2>/dev/null | tr -d '\n'; }

# Get ERC20 balance (token_address, holder_address)
# cast appends a human-readable annotation like "[1e10]" to large numbers — strip it with awk
token_balance() { cast call "$1" "balanceOf(address)(uint256)" "$2" --rpc-url "$RPC_URL" 2>/dev/null | awk '{print $1}'; }

# Advance Anvil time and mine one block
advance_time() {
  local seconds="$1"
  cast rpc anvil_increaseTime "$seconds" --rpc-url "$RPC_URL" > /dev/null
  cast rpc anvil_mine 1 --rpc-url "$RPC_URL" > /dev/null
}

# Wait for the backend HTTP server to be up and responding
wait_for_backend() {
  local max_tries=30
  for i in $(seq 1 $max_tries); do
    local health
    health=$(curl -sf http://localhost:3001/health 2>/dev/null || echo '{}')
    local up
    up=$(echo "$health" | jq -r '.ok // false')
    if [[ "$up" == "true" ]]; then
      ok "Backend is up"
      return
    fi
    sleep 1
  done
  echo -e "  ${RED}✗ Backend not responding after ${max_tries}s. Is 03_start_backend.sh running?${NC}"
  exit 1
}
