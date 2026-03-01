#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# dev.sh — Spin up the full local stack in one command
#
# Starts Anvil, deploys contracts, then runs backend + frontend in the
# background. All service logs are written to /tmp/el-{service}.log.
#
# Usage:  bash e2e/dev.sh   OR   make dev
# Stop:   Ctrl+C  (kills all background services cleanly)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
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
for cmd in anvil forge cast jq node npm; do
  if ! command -v "$cmd" &>/dev/null; then
    err "Missing required tool: $cmd"
    exit 1
  fi
done

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

banner "Clearing ports 8545 · 3001 · 3000..."
kill_port 8545
kill_port 3001
kill_port 3000

# ── Step 1: Anvil ─────────────────────────────────────────────────────────────
banner "1/4  Starting Anvil..."

ANVIL_LOG=/tmp/el-anvil.log
anvil \
  --block-time 1 \
  --chain-id 31337 \
  --port 8545 \
  --accounts 10 \
  --balance 10000 \
  >"$ANVIL_LOG" 2>&1 &
PIDS+=($!)

# Wait up to 10s for Anvil to accept connections
for i in $(seq 1 10); do
  if cast block --rpc-url http://localhost:8545 &>/dev/null 2>&1; then
    ok "Anvil ready  (log: $ANVIL_LOG)"
    break
  fi
  if [[ $i -eq 10 ]]; then
    err "Anvil did not start in time. Check $ANVIL_LOG"
    exit 1
  fi
  sleep 1
done

# ── Step 2: Deploy ────────────────────────────────────────────────────────────
banner "2/4  Deploying contracts..."
bash "$REPO_ROOT/e2e/02_deploy.sh"

# ── Step 3: Backend ───────────────────────────────────────────────────────────
banner "3/4  Starting backend..."

BACKEND_LOG=/tmp/el-backend.log
ENV_FILE="$REPO_ROOT/e2e/.env.local"
set -a; source "$ENV_FILE"; set +a

export DB_PATH="$REPO_ROOT/backend/data/local.db"
export PORT=3001
export POLL_INTERVAL_MS=1000

mkdir -p "$REPO_ROOT/backend/data"
rm -f "$DB_PATH" "$DB_PATH-shm" "$DB_PATH-wal"
(cd "$REPO_ROOT/backend" && npm run dev) >"$BACKEND_LOG" 2>&1 &
PIDS+=($!)

# Wait up to 15s for backend health endpoint
for i in $(seq 1 15); do
  if curl -sf http://localhost:3001/health &>/dev/null; then
    ok "Backend ready  (log: $BACKEND_LOG)"
    break
  fi
  if [[ $i -eq 15 ]]; then
    err "Backend did not start in time. Check $BACKEND_LOG"
    exit 1
  fi
  sleep 1
done

# ── Step 4: Frontend ──────────────────────────────────────────────────────────
banner "4/4  Starting frontend..."

FRONTEND_LOG=/tmp/el-frontend.log

cat > "$REPO_ROOT/app/.env.local" <<EOF
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001/ws/orderbook
NEXT_PUBLIC_CONTRACT_ADDRESS=$CONTRACT_ADDRESS
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_RPC_URL=http://localhost:8545
EOF

(cd "$REPO_ROOT/app" && unset PORT && npm run dev) >"$FRONTEND_LOG" 2>&1 &
PIDS+=($!)
ok "Frontend starting  (log: $FRONTEND_LOG)"

# ── Ready ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Full stack running:${NC}"
echo -e "  Anvil:    ${GREEN}http://localhost:8545${NC}  (chain 31337)"
echo -e "  Backend:  ${GREEN}http://localhost:3001${NC}"
echo -e "  Frontend: ${GREEN}http://localhost:3000${NC}"
echo ""
echo "MetaMask: add network http://localhost:8545 (chain 31337)"
echo "          import any Anvil private key from $ANVIL_LOG"
echo ""
echo "Live logs:"
echo "  tail -f $ANVIL_LOG"
echo "  tail -f $BACKEND_LOG"
echo "  tail -f $FRONTEND_LOG"
echo ""
echo "Press Ctrl+C to stop everything."
echo ""

# Keep script alive so the trap fires on Ctrl+C
wait
