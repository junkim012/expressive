#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# staging.sh — Start backend + frontend against Monad testnet
#
# No Anvil, no contract deployment. Requires a contract already deployed on
# Monad testnet and e2e/staging/.env.staging filled in.
#
# Usage:  bash e2e/staging/staging.sh   OR   make staging
# Stop:   Ctrl+C  (kills all background services cleanly)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
ENV_FILE="$REPO_ROOT/e2e/staging/.env.staging"
PIDS=()

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
ok()     { echo -e "  ${GREEN}✓${NC} $1"; }
info()   { echo -e "  ${YELLOW}→${NC} $1"; }
banner() { echo -e "\n${BOLD}$1${NC}"; }
err()    { echo -e "  ${RED}✗${NC} $1" >&2; }

# ── Cleanup ───────────────────────────────────────────────────────────────────
cleanup() {
  echo ""
  banner "Stopping all services..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  ok "All services stopped."
}
trap cleanup EXIT INT TERM

# ── Pre-flight ────────────────────────────────────────────────────────────────
for cmd in node npm curl; do
  if ! command -v "$cmd" &>/dev/null; then
    err "Missing required tool: $cmd"
    exit 1
  fi
done

if [[ ! -f "$ENV_FILE" ]]; then
  err ".env.staging not found."
  echo ""
  echo "  Setup steps:"
  echo "    1. Deploy the contract to Monad testnet:"
  echo "         cd contracts && forge script script/Deploy.s.sol --rpc-url https://testnet-rpc.monad.xyz --broadcast"
  echo "    2. Copy the example env file:"
  echo "         cp e2e/staging/.env.staging.example e2e/staging/.env.staging"
  echo "    3. Fill in the deployed addresses in e2e/staging/.env.staging"
  echo "    4. Update backend/src/config/assets.ts with Monad testnet token addresses"
  echo "    5. Run: make staging"
  echo ""
  exit 1
fi

# Source staging env
set -a; source "$ENV_FILE"; set +a

# Kill any stale process occupying a given port
kill_port() {
  local port=$1
  local pids
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    info "Killing stale process(es) on port $port (pids: $pids)"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 0.5
  fi
}

banner "Clearing ports 3001 · 3000..."
kill_port 3001
kill_port 3000

# ── Step 1: Backend ───────────────────────────────────────────────────────────
banner "1/2  Starting backend (Monad testnet)..."

BACKEND_LOG=/tmp/el-backend.log

export DB_PATH="$BACKEND_DIR/data/staging.db"
export PORT=3001
export POLL_INTERVAL_MS=2000  # Monad testnet block time

mkdir -p "$BACKEND_DIR/data"
(cd "$BACKEND_DIR" && npm run dev) >"$BACKEND_LOG" 2>&1 &
PIDS+=($!)

# Wait up to 20s for backend health endpoint
for i in $(seq 1 20); do
  if curl -sf http://localhost:3001/health &>/dev/null; then
    ok "Backend ready  (log: $BACKEND_LOG)"
    break
  fi
  if [[ $i -eq 20 ]]; then
    err "Backend did not start in time. Check $BACKEND_LOG"
    exit 1
  fi
  sleep 1
done

# ── Step 2: Frontend ──────────────────────────────────────────────────────────
banner "2/2  Starting frontend..."

FRONTEND_LOG=/tmp/el-frontend.log

cat > "$REPO_ROOT/app/.env.local" <<EOF
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001/ws/orderbook
NEXT_PUBLIC_CONTRACT_ADDRESS=$CONTRACT_ADDRESS
NEXT_PUBLIC_CHAIN_ID=10143
NEXT_PUBLIC_RPC_URL=https://testnet-rpc.monad.xyz
EOF

(cd "$REPO_ROOT/app" && unset PORT && npm run dev) >"$FRONTEND_LOG" 2>&1 &
PIDS+=($!)
ok "Frontend starting  (log: $FRONTEND_LOG)"

# ── Ready ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Staging stack running (Monad Testnet):${NC}"
echo -e "  RPC:      ${GREEN}https://testnet-rpc.monad.xyz${NC}  (chain 10143)"
echo -e "  Backend:  ${GREEN}http://localhost:3001${NC}"
echo -e "  Frontend: ${GREEN}http://localhost:3000${NC}"
echo -e "  Contract: ${GREEN}$CONTRACT_ADDRESS${NC}"
echo ""
echo "Rabby/MetaMask: switch to Monad Testnet (chain 10143)"
echo ""
echo "Live logs:"
echo "  tail -f $BACKEND_LOG"
echo "  tail -f $FRONTEND_LOG"
echo ""
echo "Press Ctrl+C to stop everything."
echo ""

# Keep script alive so the trap fires on Ctrl+C
wait
