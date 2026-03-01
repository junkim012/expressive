#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# solver-logs.sh — Tail solver bot logs with color-coded prefixes
#
# Usage:  bash bot/solver-logs.sh          # all solvers
#         bash bot/solver-logs.sh a b      # only Solver-A and Solver-B
#         make solver-logs                 # all solvers
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SOLVER_A_LOG=/tmp/el-solver-a.log
SOLVER_B_LOG=/tmp/el-solver-b.log
SOLVER_C_LOG=/tmp/el-solver-c.log

CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
YELLOW='\033[1;33m'
GRAY='\033[0;37m'
NC='\033[0m'

trap 'kill 0' INT TERM EXIT

# Determine which solvers to show
REQUESTED=("${@:-a b c}")
if [[ $# -eq 0 ]]; then
  REQUESTED=(a b c)
fi

wants() { [[ " ${REQUESTED[*]} " == *" $1 "* ]]; }

tail_solver() {
  local label="$1" color="$2" logfile="$3"
  local prefix
  printf -v prefix "${color}[%-8s]${NC} " "$label"

  for i in $(seq 1 30); do
    [[ -f "$logfile" ]] && break
    if [[ $i -eq 30 ]]; then
      echo -e "${GRAY}[solver-logs]${NC}  $logfile not found — is 'make solver' running?" >&2
      return
    fi
    sleep 1
  done

  tail -f "$logfile" | awk -v prefix="$prefix" '{ print prefix $0; fflush() }' &
}

echo ""
echo -e "${GRAY}Tailing solver logs — Ctrl+C to stop${NC}"
wants a && echo -e "  ${CYAN}[Solver-A]${NC}  $SOLVER_A_LOG"
wants b && echo -e "  ${MAGENTA}[Solver-B]${NC}  $SOLVER_B_LOG"
wants c && echo -e "  ${YELLOW}[Solver-C]${NC}  $SOLVER_C_LOG"
echo ""

wants a && tail_solver "Solver-A" "$CYAN"    "$SOLVER_A_LOG"
wants b && tail_solver "Solver-B" "$MAGENTA" "$SOLVER_B_LOG"
wants c && tail_solver "Solver-C" "$YELLOW"  "$SOLVER_C_LOG"

wait
