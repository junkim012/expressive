#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 04_start_frontend.sh — Start the Next.js frontend against local backend
#
# Requires: 02_deploy.sh to have been run (e2e/.env.local must exist)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_ROOT/e2e/.env.local"
APP_DIR="$REPO_ROOT/app"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: e2e/.env.local not found. Run 02_deploy.sh first." >&2
  exit 1
fi

if [[ ! -d "$APP_DIR" ]] || [[ ! -f "$APP_DIR/package.json" ]]; then
  echo "ERROR: app/ not found or has no package.json." >&2
  exit 1
fi

# Source env vars so we can read CONTRACT_ADDRESS etc.
set -a; source "$ENV_FILE"; set +a

# Write Next.js env file (NEXT_PUBLIC_ vars must be present at build time)
cat > "$APP_DIR/.env.local" << EOF
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001/ws/orderbook
NEXT_PUBLIC_CONTRACT_ADDRESS=$CONTRACT_ADDRESS
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_RPC_URL=http://localhost:8545
EOF

echo "Starting frontend..."
echo "  API:              http://localhost:3001"
echo "  CONTRACT_ADDRESS: $CONTRACT_ADDRESS"
echo "  Chain ID:         31337"
echo ""
echo "Open http://localhost:3000 in your browser."
echo "Import an Anvil private key into MetaMask (network: http://localhost:8545, chain 31337)."
echo ""

cd "$APP_DIR"
npm run dev
