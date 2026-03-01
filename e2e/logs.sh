#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# logs.sh — Tail service logs with color-coded prefixes
#
# Usage:  bash e2e/logs.sh [service ...]   OR   make logs [LOGS="..."]
#
#   make logs                        # all services
#   make logs LOGS="backend frontend"  # only backend and frontend
#   make logs LOGS="anvil"             # only anvil
#
# Stop:   Ctrl+C
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ANVIL_LOG=/tmp/el-anvil.log
BACKEND_LOG=/tmp/el-backend.log
FRONTEND_LOG=/tmp/el-frontend.log

# ANSI colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
GRAY='\033[0;37m'
NC='\033[0m'

trap 'kill 0' INT TERM EXIT

# Determine which services to show (default: all)
REQUESTED=("${@:-anvil backend frontend}")
# If no args, set to all three
if [[ $# -eq 0 ]]; then
  REQUESTED=(anvil backend frontend)
fi

wants() { [[ " ${REQUESTED[*]} " == *" $1 "* ]]; }

# Wait for a log file to exist (up to 30s), then tail it with a colored prefix
tail_service() {
  local label="$1" color="$2" logfile="$3"
  local prefix
  printf -v prefix "${color}[%-8s]${NC} " "$label"

  for i in $(seq 1 30); do
    [[ -f "$logfile" ]] && break
    if [[ $i -eq 30 ]]; then
      echo -e "${GRAY}[logs.sh]${NC}  $logfile not found — is 'make dev' running?" >&2
      return
    fi
    sleep 1
  done

  tail -f "$logfile" | awk -v prefix="$prefix" '{ print prefix $0; fflush() }' &
}

echo ""
echo -e "${GRAY}Tailing service logs — Ctrl+C to stop${NC}"
wants anvil    && echo -e "  ${GRAY}[ANVIL   ]${NC}  $ANVIL_LOG"
wants backend  && echo -e "  ${GREEN}[BACKEND ]${NC}  $BACKEND_LOG"
wants frontend && echo -e "  ${YELLOW}[FRONTEND]${NC}  $FRONTEND_LOG"
echo ""

wants anvil    && tail_service "ANVIL"    "$GRAY"   "$ANVIL_LOG"
wants backend  && tail_service "BACKEND"  "$GREEN"  "$BACKEND_LOG"
wants frontend && tail_service "FRONTEND" "$YELLOW" "$FRONTEND_LOG"

wait
