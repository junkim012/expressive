#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# fund.sh — Fund a wallet with test tokens on the local chain
#
# Usage: ./e2e/fund.sh <wallet_address>
#
# Mints:
#   1 000 000 USDC   (6 decimals)
#     1 000 WBTC     (8 decimals)
#     5 000 WETH     (18 decimals)
#   Sets native balance to 1 000 000 ETH via anvil_setBalance
#
# Requires: e2e/.env.local (run 02_deploy.sh first), cast
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_ROOT/e2e/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: e2e/.env.local not found. Run 02_deploy.sh first." >&2
  exit 1
fi

set -a; source "$ENV_FILE"; set +a

# ── Args ──────────────────────────────────────────────────────────────────────
if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <wallet_address>" >&2
  exit 1
fi

TARGET="$1"

if [[ ! "$TARGET" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "ERROR: Invalid address: $TARGET" >&2
  exit 1
fi

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

header() { echo -e "\n${BOLD}${BLUE}▶ $1${NC}"; }
ok()     { echo -e "  ${GREEN}✓${NC} $1"; }

# ── Amounts ───────────────────────────────────────────────────────────────────
USDC_AMOUNT=1000000000000          # 1 000 000 USDC  (× 10^6)
WBTC_AMOUNT=100000000000           # 1 000 WBTC      (× 10^8)
WETH_AMOUNT=5000000000000000000000 # 5 000 WETH      (× 10^18)
NATIVE_HEX="0xd3c21bcecceda1000000" # 1 000 000 ETH in wei

header "Funding $TARGET"

cast send "$USDC" "mint(address,uint256)" "$TARGET" "$USDC_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$DEPLOYER_KEY" --quiet
ok "1 000 000 USDC minted"

cast send "$WBTC" "mint(address,uint256)" "$TARGET" "$WBTC_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$DEPLOYER_KEY" --quiet
ok "1 000 WBTC minted"

cast send "$WETH" "mint(address,uint256)" "$TARGET" "$WETH_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$DEPLOYER_KEY" --quiet
ok "5 000 WETH minted"

cast rpc anvil_setBalance "$TARGET" "$NATIVE_HEX" --rpc-url "$RPC_URL" > /dev/null
ok "1 000 000 native tokens set"

echo ""
echo -e "${GREEN}Done.${NC} $TARGET funded."
