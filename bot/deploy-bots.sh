#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy-bots.sh — Start all bots (2 lender + 2 borrower + 3 solver)
#
# Usage:
#   bash bot/deploy-bots.sh local     # requires `make dev` running
#   bash bot/deploy-bots.sh staging   # requires .env.staging
#   make bots                         # defaults to local
#   make bots MODE=staging
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-local}"

# ── Colors ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
ok()  { echo -e "  ${GREEN}✓${NC} $1"; }
err() { echo -e "  ${RED}✗${NC} $1" >&2; }

# ── Validate mode ────────────────────────────────────────────────────────────
if [[ "$MODE" != "local" && "$MODE" != "staging" ]]; then
  echo "Usage: $0 <local|staging>" >&2
  exit 1
fi

echo -e "\n${BOLD}Expressive Lending — All Bots (${MODE})${NC}\n"

# ── Pre-flight ───────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  err "Missing required tool: node"
  exit 1
fi

if [[ ! -d "$REPO_ROOT/bot/node_modules" ]]; then
  err "bot/node_modules not found. Run: cd bot && npm install"
  exit 1
fi

# ── Source environment ───────────────────────────────────────────────────────
if [[ "$MODE" == "local" ]]; then
  ENV_FILE="$REPO_ROOT/e2e/.env.local"
  if [[ ! -f "$ENV_FILE" ]]; then
    err "e2e/.env.local not found. Run 'make dev' first."
    exit 1
  fi
  set -a; source "$ENV_FILE"; set +a

  # Solver keys: Anvil accounts 4, 6, 7
  export SOLVER1_KEY="$SOLVER_KEY"
  export SOLVER2_KEY="0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e"
  export SOLVER3_KEY="0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356"

  # Lender keys: Anvil accounts 1, 2
  export LENDER1_KEY="$LENDER1_KEY"
  export LENDER2_KEY="$LENDER2_KEY"

  # Borrower keys: Anvil accounts 3, 8
  export BORROWER1_KEY="$BORROWER_KEY"
  export BORROWER2_KEY="0x689af8efa8c651a91ad287602527f3af2fe9f6501a7ac4b061667b5a93e037fd"

  export DEPLOYER_KEY="$DEPLOYER_KEY"
  export API_URL="http://localhost:3002"

  ok "Sourced e2e/.env.local"

elif [[ "$MODE" == "staging" ]]; then
  ENV_FILE="$REPO_ROOT/e2e/staging/.env.staging"
  if [[ ! -f "$ENV_FILE" ]]; then
    err "e2e/staging/.env.staging not found."
    exit 1
  fi
  set -a; source "$ENV_FILE"; set +a

  # Validate all required keys
  missing_keys=""
  for key in SOLVER1_KEY SOLVER2_KEY SOLVER3_KEY LENDER1_KEY LENDER2_KEY BORROWER1_KEY BORROWER2_KEY; do
    if [[ -z "${!key:-}" ]]; then
      missing_keys="$missing_keys $key"
    fi
  done
  if [[ -n "$missing_keys" ]]; then
    err "Missing keys in .env.staging:$missing_keys"
    exit 1
  fi

  export API_URL="${API_URL:-http://localhost:3001}"

  ok "Sourced e2e/staging/.env.staging"
fi

export MODE

# ── Run the bot ──────────────────────────────────────────────────────────────
cd "$REPO_ROOT/bot"
exec npx tsx src/bots-main.ts
