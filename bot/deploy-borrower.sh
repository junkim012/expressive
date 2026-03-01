#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy-borrower.sh — Start the borrower bots in local or staging mode
#
# Usage:
#   bash bot/deploy-borrower.sh local     # requires `make dev` running
#   bash bot/deploy-borrower.sh staging   # requires .env.staging
#   make borrower                         # defaults to local
#   make borrower MODE=staging
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

echo -e "\n${BOLD}Expressive Lending — Borrower Bots (${MODE})${NC}\n"

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

  # Map Anvil accounts: Borrower = account 3, Borrower2 = account 8
  export BORROWER1_KEY="$BORROWER_KEY"
  export BORROWER2_KEY="0x689af8efa8c651a91ad287602527f3af2fe9f6501a7ac4b061667b5a93e037fd"
  export DEPLOYER_KEY="$DEPLOYER_KEY"

  ok "Sourced e2e/.env.local (Anvil accounts 3, 8)"

elif [[ "$MODE" == "staging" ]]; then
  ENV_FILE="$REPO_ROOT/e2e/staging/.env.staging"
  if [[ ! -f "$ENV_FILE" ]]; then
    err "e2e/staging/.env.staging not found."
    exit 1
  fi
  set -a; source "$ENV_FILE"; set +a

  if [[ -z "${BORROWER1_KEY:-}" || -z "${BORROWER2_KEY:-}" ]]; then
    err "BORROWER1_KEY and BORROWER2_KEY must be set in .env.staging"
    exit 1
  fi

  ok "Sourced e2e/staging/.env.staging"
fi

export MODE

# ── Run the bot ──────────────────────────────────────────────────────────────
cd "$REPO_ROOT/bot"
exec npx tsx src/borrower-main.ts
