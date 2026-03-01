#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# fund-staging.sh — Mint mock tokens to one or more addresses on Monad testnet
#
# Usage:
#   bash e2e/staging/fund-staging.sh <address> [address2] [address3] ...
#   bash e2e/staging/fund-staging.sh 0xABC...123 0xDEF...456
#
# Mints per address:
#   1 000 000  USDC   (6 decimals)
#       1 000  WBTC   (8 decimals)
#     100 000  WETH   (18 decimals)
#
# The mock tokens have a permissionless mint() — no deployer key needed.
# Any funded EOA can call mint(address,uint256) directly.
#
# Requires:
#   - e2e/staging/.env.staging (with RPC_URL, token addresses, FUNDER_KEY)
#   - cast (Foundry)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/e2e/staging/.env.staging"

# ── Colors ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; RED='\033[0;31m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
header() { echo -e "\n${BOLD}${BLUE}▶ $1${NC}"; }
ok()     { echo -e "  ${GREEN}✓${NC} $1"; }
err()    { echo -e "  ${RED}✗${NC} $1" >&2; }

# ── Pre-flight ───────────────────────────────────────────────────────────────
if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <address> [address2] [address3] ..." >&2
  echo "" >&2
  echo "  Mints 1M USDC + 1K WBTC + 100K WETH to each address on Monad testnet." >&2
  echo "  Requires FUNDER_KEY in e2e/staging/.env.staging (any funded EOA for gas)." >&2
  exit 1
fi

if ! command -v cast &>/dev/null; then
  err "Missing required tool: cast (install Foundry)"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  err "e2e/staging/.env.staging not found."
  exit 1
fi

set -a; source "$ENV_FILE"; set +a

SIGNER_KEY="${FUNDER_KEY:-}"
if [[ -z "$SIGNER_KEY" ]]; then
  err "FUNDER_KEY not set in .env.staging"
  exit 1
fi

# Validate required env vars from .env.staging
for var in RPC_URL USDC WBTC WETH; do
  if [[ -z "${!var:-}" ]]; then
    err "Missing $var in .env.staging"
    exit 1
  fi
done

# ── Amounts ──────────────────────────────────────────────────────────────────
USDC_AMOUNT=1000000000000                     # 1 000 000 USDC  (× 10^6)
WBTC_AMOUNT=100000000000                      # 1 000 WBTC      (× 10^8)
WETH_AMOUNT=100000000000000000000000          # 100 000 WETH    (× 10^18)

# ── Validate addresses ──────────────────────────────────────────────────────
TARGETS=("$@")
for TARGET in "${TARGETS[@]}"; do
  if [[ ! "$TARGET" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    err "Invalid address: $TARGET"
    exit 1
  fi
done

# ── Mint tokens ──────────────────────────────────────────────────────────────
SIGNER_ADDR=$(cast wallet address "$SIGNER_KEY" 2>/dev/null)
echo -e "\n${BOLD}Expressive Lending — Staging Token Funder${NC}\n"
echo -e "  RPC:     $RPC_URL"
echo -e "  Signer:  $SIGNER_ADDR"
echo -e "  Targets: ${#TARGETS[@]} address(es)"
echo ""
echo -e "  USDC:  $USDC  (1,000,000 per address)"
echo -e "  WBTC:  $WBTC  (1,000 per address)"
echo -e "  WETH:  $WETH  (100,000 per address)"

for TARGET in "${TARGETS[@]}"; do
  header "Funding $TARGET"

  cast send "$USDC" "mint(address,uint256)" "$TARGET" "$USDC_AMOUNT" \
    --rpc-url "$RPC_URL" --private-key "$SIGNER_KEY" --quiet
  ok "1,000,000 USDC minted"

  cast send "$WBTC" "mint(address,uint256)" "$TARGET" "$WBTC_AMOUNT" \
    --rpc-url "$RPC_URL" --private-key "$SIGNER_KEY" --quiet
  ok "1,000 WBTC minted"

  cast send "$WETH" "mint(address,uint256)" "$TARGET" "$WETH_AMOUNT" \
    --rpc-url "$RPC_URL" --private-key "$SIGNER_KEY" --quiet
  ok "100,000 WETH minted"
done

echo ""
echo -e "${GREEN}Done.${NC} ${#TARGETS[@]} address(es) funded."
