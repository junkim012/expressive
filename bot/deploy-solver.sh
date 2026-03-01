#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy-solver.sh — Start the solver bot in local or staging mode
#
# Usage:
#   bash bot/deploy-solver.sh local     # requires `make dev` running
#   bash bot/deploy-solver.sh staging   # requires `make staging` running
#   make solver                         # defaults to local
#   make solver MODE=staging
#
# The same TypeScript code runs in both environments. This script sources
# the correct env file and maps the solver keys.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-local}"

# ── Colors ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
ok()  { echo -e "  ${GREEN}✓${NC} $1"; }
err() { echo -e "  ${RED}✗${NC} $1" >&2; }

# ── Validate mode ───────────────────────────────────────────────────────────
if [[ "$MODE" != "local" && "$MODE" != "staging" ]]; then
  echo "Usage: $0 <local|staging>" >&2
  exit 1
fi

echo -e "\n${BOLD}Expressive Lending — Solver Bot (${MODE})${NC}\n"

# ── Pre-flight ──────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  err "Missing required tool: node"
  exit 1
fi

if [[ ! -d "$REPO_ROOT/bot/node_modules" ]]; then
  err "bot/node_modules not found. Run: cd bot && npm install"
  exit 1
fi

# ── Source environment ──────────────────────────────────────────────────────
if [[ "$MODE" == "local" ]]; then
  ENV_FILE="$REPO_ROOT/e2e/.env.local"
  if [[ ! -f "$ENV_FILE" ]]; then
    err "e2e/.env.local not found. Run 'make dev' first."
    exit 1
  fi
  set -a; source "$ENV_FILE"; set +a

  # Map existing SOLVER (Anvil account 4) to SOLVER1_KEY,
  # and use Anvil accounts 6 & 7 for SOLVER2 & SOLVER3.
  export SOLVER1_KEY="$SOLVER_KEY"
  export SOLVER2_KEY="0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e"
  export SOLVER3_KEY="0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356"
  export API_URL="http://localhost:3002"

  ok "Sourced e2e/.env.local (Anvil accounts 4, 6, 7)"

elif [[ "$MODE" == "staging" ]]; then
  ENV_FILE="$REPO_ROOT/e2e/staging/.env.staging"
  if [[ ! -f "$ENV_FILE" ]]; then
    err "e2e/staging/.env.staging not found."
    exit 1
  fi
  set -a; source "$ENV_FILE"; set +a

  # Staging requires SOLVER1_KEY, SOLVER2_KEY, SOLVER3_KEY in .env.staging
  if [[ -z "${SOLVER1_KEY:-}" || -z "${SOLVER2_KEY:-}" || -z "${SOLVER3_KEY:-}" ]]; then
    err "SOLVER1_KEY, SOLVER2_KEY, and SOLVER3_KEY must be set in .env.staging"
    exit 1
  fi

  export API_URL="${API_URL:-http://localhost:3001}"

  ok "Sourced e2e/staging/.env.staging"
fi

export MODE

# ── Run the bot ─────────────────────────────────────────────────────────────
cd "$REPO_ROOT/bot"
exec npx tsx src/index.ts
