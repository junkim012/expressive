#!/usr/bin/env bash
# local-up.sh — Start Anvil and deploy Expressive Lending with deterministic addresses.
#
# Usage:
#   ./local-up.sh          # start Anvil + deploy, then block (Ctrl-C to stop)
#   ./local-up.sh --no-wait # start Anvil + deploy, print PID, return immediately
#
# Deployer:  0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (Anvil account #0)
# Addresses are deterministic because the deployer starts at nonce 0 on a fresh chain.
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────

RPC_URL="http://localhost:8545"
CHAIN_ID=31337
PORT=8545
BLOCK_TIME=1   # seconds — matches Monad cadence
NO_WAIT="${1:-}"

# ── Known deterministic addresses ─────────────────────────────────────────────
# These are pre-computed from deployer 0xf39Fd6...92266 starting at nonce 0.
# They never change as long as the script deploys in the same order.

DEPLOYER="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
USDC="0x5FbDB2315678afecb367f032d93F642f64180aa3"
WBTC="0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
WETH="0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"
BTC_ORACLE="0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"
ETH_ORACLE="0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9"
PROTOCOL="0x5FC8d32690cc91D4c39d9d3abcBd16989F875707"

# ── Helpers ───────────────────────────────────────────────────────────────────

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }
err()   { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; }

# ── Pre-flight ────────────────────────────────────────────────────────────────

if ! command -v anvil &>/dev/null; then
  err "anvil not found. Install Foundry: https://getfoundry.sh"
  exit 1
fi
if ! command -v forge &>/dev/null; then
  err "forge not found. Install Foundry: https://getfoundry.sh"
  exit 1
fi
if ! command -v curl &>/dev/null; then
  err "curl not found"
  exit 1
fi

# Fail fast if port is already in use
if lsof -ti ":${PORT}" &>/dev/null; then
  err "Port ${PORT} already in use. Kill the existing process or change PORT."
  exit 1
fi

# ── Start Anvil ───────────────────────────────────────────────────────────────

printf '  Starting Anvil (chain %d, block-time %ds)...\n' "$CHAIN_ID" "$BLOCK_TIME"
anvil \
  --chain-id "$CHAIN_ID" \
  --port     "$PORT" \
  --block-time "$BLOCK_TIME" \
  --silent \
  &
ANVIL_PID=$!

# Cleanup on exit
cleanup() {
  printf '\n  Stopping Anvil (PID %d)...\n' "$ANVIL_PID"
  kill "$ANVIL_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Wait for Anvil to accept connections (up to 10s)
printf '  Waiting for RPC at %s...' "$RPC_URL"
READY=0
for _ in $(seq 1 20); do
  if curl -sf -X POST "$RPC_URL" \
       -H "Content-Type: application/json" \
       -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
       -o /dev/null; then
    READY=1
    break
  fi
  sleep 0.5
done

if [ "$READY" -eq 0 ]; then
  err "Anvil did not become ready after 10s"
  exit 1
fi
printf ' ready.\n'

# ── Deploy ────────────────────────────────────────────────────────────────────

printf '  Running LocalSetup.s.sol...\n'
DEPLOY_OUT=$(forge script script/LocalSetup.s.sol \
  --rpc-url "$RPC_URL" \
  --broadcast \
  2>&1)

# Sanity check: verify the protocol actually landed at the expected address
ACTUAL=$(cast call "$PROTOCOL" "batchWindowSeconds()(uint256)" \
         --rpc-url "$RPC_URL" 2>/dev/null || echo "FAIL")
if [ "$ACTUAL" = "FAIL" ]; then
  err "Protocol not found at expected address $PROTOCOL"
  printf '%s\n' "$DEPLOY_OUT"
  exit 1
fi

# ── Print summary ─────────────────────────────────────────────────────────────

printf '\n'
bold "═══════════════════════════════════════════════════"
bold " Expressive Lending — Local Stack"
bold "═══════════════════════════════════════════════════"
printf '\n'
printf '  %-14s %s\n' "Chain ID:"   "$CHAIN_ID"
printf '  %-14s %s\n' "RPC URL:"    "$RPC_URL"
printf '  %-14s %s\n' "Deployer:"   "$DEPLOYER"
printf '\n'
bold " Addresses (deterministic):"
printf '  %-14s ' "USDC:";      green "$USDC"
printf '  %-14s ' "WBTC:";      green "$WBTC"
printf '  %-14s ' "WETH:";      green "$WETH"
printf '  %-14s ' "BTC Oracle:"; green "$BTC_ORACLE"
printf '  %-14s ' "ETH Oracle:"; green "$ETH_ORACLE"
printf '  %-14s ' "Protocol:";  green "$PROTOCOL"
printf '\n'
bold " Batch window: 30s | Solver fee: 10 bps | Liq bonus: 500 bps"
printf '\n'
bold " Test wallets (pre-funded and approved):"
printf '  Lender 1:   0x70997970C51812dc3A010C7d01b50e0d17dc79C8  (10 000 USDC)\n'
printf '  Lender 2:   0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC  (10 000 USDC)\n'
printf '  Borrower:   0x90F79bf6EB2c4f870365E785982E1f101E93b906  (5 WBTC + 50 WETH)\n'
printf '  Liquidator: 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc  (50 000 USDC)\n'
printf '\n'
bold " Backend .env:"
printf '  RPC_URL=%s\n'           "$RPC_URL"
printf '  CONTRACT_ADDRESS=%s\n'  "$PROTOCOL"
printf '  START_BLOCK=1\n'
printf '  SOLVER_FEE_RATE=10\n'
printf '\n'
bold " Frontend .env.local:"
printf '  NEXT_PUBLIC_RPC_URL=%s\n'          "$RPC_URL"
printf '  NEXT_PUBLIC_CHAIN_ID=%s\n'         "$CHAIN_ID"
printf '  NEXT_PUBLIC_CONTRACT_ADDRESS=%s\n' "$PROTOCOL"
printf '  NEXT_PUBLIC_API_URL=http://localhost:3001\n'
printf '  NEXT_PUBLIC_WS_URL=ws://localhost:3001/ws/orderbook\n'
printf '\n'
dim "  Deployment artifact: deployments/local.json"
printf '\n'

if [ "$NO_WAIT" = "--no-wait" ]; then
  # Detach: remove the EXIT trap and leave Anvil running
  trap - EXIT INT TERM
  bold " Anvil running in background (PID $ANVIL_PID). Kill with:"
  printf '  kill %d\n' "$ANVIL_PID"
else
  bold " Anvil running. Press Ctrl-C to stop."
  # Block until Ctrl-C
  wait "$ANVIL_PID" 2>/dev/null || true
fi
