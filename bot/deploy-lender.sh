#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy-lender.sh — Start the lender bots in local or staging mode
#
# Usage:
#   bash bot/deploy-lender.sh local     # requires `make dev` running
#   bash bot/deploy-lender.sh staging   # requires .env.staging
#   make lender                         # defaults to local
#   make lender MODE=staging
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

echo -e "\n${BOLD}Expressive Lending — Lender Bots (${MODE})${NC}\n"

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

  # Map Anvil accounts: Lender1 = account 1, Lender2 = account 2
  export LENDER1_KEY="$LENDER1_KEY"
  export LENDER2_KEY="$LENDER2_KEY"
  export DEPLOYER_KEY="$DEPLOYER_KEY"

  ok "Sourced e2e/.env.local (Anvil accounts 1, 2)"

elif [[ "$MODE" == "staging" ]]; then
  ENV_FILE="$REPO_ROOT/e2e/staging/.env.staging"
  if [[ ! -f "$ENV_FILE" ]]; then
    err "e2e/staging/.env.staging not found."
    exit 1
  fi
  set -a; source "$ENV_FILE"; set +a

  if [[ -z "${LENDER1_KEY:-}" || -z "${LENDER2_KEY:-}" ]]; then
    err "LENDER1_KEY and LENDER2_KEY must be set in .env.staging"
    exit 1
  fi

  ok "Sourced e2e/staging/.env.staging"
fi

export MODE

# ── Run the bot ──────────────────────────────────────────────────────────────
cd "$REPO_ROOT/bot"
exec npx tsx src/lender-main.ts
