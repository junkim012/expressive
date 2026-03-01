#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 01_start_anvil.sh — Start a local Anvil chain
#
# Runs in the foreground. Leave this terminal open while running other scripts.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

if ! command -v anvil &>/dev/null; then
  echo "ERROR: anvil not found. Install Foundry: https://getfoundry.sh" >&2
  exit 1
fi

echo "Starting Anvil on http://localhost:8545 (chain-id 31337, 1s block time)..."
echo "Press Ctrl+C to stop."
echo ""

anvil \
  --block-time 1 \
  --chain-id 31337 \
  --port 8545 \
  --accounts 10 \
  --balance 10000
