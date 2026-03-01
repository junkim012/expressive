.DEFAULT_GOAL := help
.PHONY: help install anvil deploy backend frontend dev staging fund-staging action solver lender borrower bots solver-logs bot-logs logs test-contracts

REPO_ROOT := $(shell pwd)

# ── Help ──────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "Expressive Lending — local development"
	@echo ""
	@echo "  Setup"
	@echo "    make install       Install npm deps for backend, app, and bot"
	@echo ""
	@echo "  Individual services  (each runs in the foreground — open a new terminal per step)"
	@echo "    make anvil         Start Anvil local chain on :8545"
	@echo "    make deploy        Deploy contracts + write e2e/.env.local"
	@echo "    make backend       Start indexer + API on :3001"
	@echo "    make frontend      Start Next.js dev server on :3000"
	@echo ""
	@echo "  One-command spinup"
	@echo "    make dev           Run the full local stack (background, logs to /tmp/*.log)"
	@echo "    make staging       Start backend + frontend against Monad testnet (no Anvil)"
	@echo "    make fund-staging  Mint mock tokens to staging addresses (ADDRS=\"0x... 0x...\")"
	@echo "    make logs          Tail all service logs with color-coded prefixes"
	@echo "    make solver-logs   Tail solver bot logs with color-coded prefixes"
	@echo "    make bot-logs      Tail all bot logs (solver + lender + borrower)"
	@echo "    make action        Run lender + borrower bots (requires make dev running)"
	@echo "    make solver        Run 3 competing solver bots (MODE=local|staging)"
	@echo "    make lender        Run 2 lender bots (MODE=local|staging)"
	@echo "    make borrower      Run 2 borrower bots (MODE=local|staging)"
	@echo "    make bots          Run all bots: 3 solver + 2 lender + 2 borrower (MODE=local|staging)"
	@echo ""
	@echo "  Contracts"
	@echo "    make test          Run Foundry test suite"
	@echo ""

# ── Setup ─────────────────────────────────────────────────────────────────────
install:
	cd backend && npm install
	cd app && npm install
	cd bot && npm install

# ── Individual services ───────────────────────────────────────────────────────
anvil:
	@bash e2e/01_start_anvil.sh

deploy:
	@bash e2e/02_deploy.sh

backend:
	@bash e2e/03_start_backend.sh

frontend:
	@bash e2e/04_start_frontend.sh

# ── Full local stack ──────────────────────────────────────────────────────────
dev:
	@bash e2e/dev.sh

# ── Monad testnet staging ─────────────────────────────────────────────────────
staging: ## Start backend + frontend pointing to Monad testnet (no Anvil, no deploy)
	@bash e2e/staging/staging.sh

fund-staging: ## Mint mock tokens to staging addresses
	@bash e2e/staging/fund-staging.sh $(ADDRS)

# ── Observability ─────────────────────────────────────────────────────────────
logs:
	@bash e2e/logs.sh $(LOGS)

solver-logs:
	@bash bot/solver-logs.sh

bot-logs:
	@bash bot/bot-logs.sh $(LOGS)

# ── Activity bots ─────────────────────────────────────────────────────────────
action:
	@bash e2e/action.sh

# ── Solver bots ──────────────────────────────────────────────────────────────
solver:
	@bash bot/deploy-solver.sh $(or $(MODE),local)

# ── Lender / Borrower / All bots ────────────────────────────────────────────
lender:
	@bash bot/deploy-lender.sh $(or $(MODE),local)

borrower:
	@bash bot/deploy-borrower.sh $(or $(MODE),local)

bots:
	@bash bot/deploy-bots.sh $(or $(MODE),local)

# ── Contracts ─────────────────────────────────────────────────────────────────
test:
	cd contracts && forge test -vv
