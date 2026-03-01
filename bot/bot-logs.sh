#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# bot-logs.sh — Tail all bot logs with color-coded prefixes
#
# Usage:  bash bot/bot-logs.sh                    # all bots
#         bash bot/bot-logs.sh lender              # lenders only
#         bash bot/bot-logs.sh borrower            # borrowers only
#         bash bot/bot-logs.sh solver              # solvers only
#         bash bot/bot-logs.sh lender borrower     # lenders + borrowers
#         make bot-logs                            # all bots
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
GRAY='\033[0;37m'
NC='\033[0m'

trap 'kill 0' INT TERM EXIT

# Determine which bot groups to show
REQUESTED=("${@}")
if [[ $# -eq 0 ]]; then
  REQUESTED=(solver lender borrower)
fi

wants() { [[ " ${REQUESTED[*]} " == *" $1 "* ]]; }

tail_log() {
  local label="$1" color="$2" logfile="$3"
  local prefix
  printf -v prefix "${color}[%-11s]${NC} " "$label"

  for i in $(seq 1 30); do
    [[ -f "$logfile" ]] && break
    if [[ $i -eq 30 ]]; then
      echo -e "${GRAY}[bot-logs]${NC}  $logfile not found — is the bot running?" >&2
      return
    fi
    sleep 1
  done

  tail -f "$logfile" | awk -v prefix="$prefix" '{ print prefix $0; fflush() }' &
}

echo ""
echo -e "${GRAY}Tailing bot logs — Ctrl+C to stop${NC}"

if wants solver; then
  echo -e "  ${CYAN}[Solver-A]${NC}     /tmp/el-solver-a.log"
  echo -e "  ${MAGENTA}[Solver-B]${NC}     /tmp/el-solver-b.log"
  echo -e "  ${YELLOW}[Solver-C]${NC}     /tmp/el-solver-c.log"
fi
if wants lender; then
  echo -e "  ${BLUE}[Lender-1]${NC}     /tmp/el-lender-1.log"
  echo -e "  ${BLUE}[Lender-2]${NC}     /tmp/el-lender-2.log"
fi
if wants borrower; then
  echo -e "  ${YELLOW}[Borrower-1]${NC}   /tmp/el-borrower-1.log"
  echo -e "  ${YELLOW}[Borrower-2]${NC}   /tmp/el-borrower-2.log"
fi
echo ""

if wants solver; then
  tail_log "Solver-A"   "$CYAN"    "/tmp/el-solver-a.log"
  tail_log "Solver-B"   "$MAGENTA" "/tmp/el-solver-b.log"
  tail_log "Solver-C"   "$YELLOW"  "/tmp/el-solver-c.log"
fi
if wants lender; then
  tail_log "Lender-1"   "$BLUE"    "/tmp/el-lender-1.log"
  tail_log "Lender-2"   "$BLUE"    "/tmp/el-lender-2.log"
fi
if wants borrower; then
  tail_log "Borrower-1" "$YELLOW"  "/tmp/el-borrower-1.log"
  tail_log "Borrower-2" "$YELLOW"  "/tmp/el-borrower-2.log"
fi

wait
