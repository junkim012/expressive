#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 03_start_backend.sh — Start the indexer + API against local Anvil
#
# Requires: 02_deploy.sh to have been run (e2e/.env.local must exist)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_ROOT/e2e/.env.local"
BACKEND_DIR="$REPO_ROOT/backend"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: e2e/.env.local not found. Run 02_deploy.sh first." >&2
  exit 1
fi

# Source env so we can pass individual vars
set -a; source "$ENV_FILE"; set +a

# Override DB path to keep local data separate from any testnet data
export DB_PATH="$BACKEND_DIR/data/local.db"
export PORT=3002
export POLL_INTERVAL_MS=1000  # 1s — matches anvil block time

echo "Starting backend..."
echo "  RPC:              $RPC_URL"
echo "  CONTRACT_ADDRESS: $CONTRACT_ADDRESS"
echo "  START_BLOCK:      $START_BLOCK"
echo "  DB:               $DB_PATH"
echo "  PORT:             $PORT"
echo ""

mkdir -p "$BACKEND_DIR/data"
cd "$BACKEND_DIR"
npm run dev
