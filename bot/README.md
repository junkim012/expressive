# Solver Bot

Three competing solver bots that submit batch matchings to the ExpressiveLending contract. Each uses a different strategy to demonstrate the auction mechanism picking the highest-surplus winner.

## Strategies

- **Solver-A (greedy)** — Picks the single highest-surplus pair. Lowest total surplus.
- **Solver-B (multi-pair)** — Greedy accumulation of non-conflicting pairs. Medium surplus.
- **Solver-C (exhaustive)** — Optimal subset search across all candidate pairs. Highest surplus.

## Setup

```bash
cd bot && npm install
```

## Usage

### Local (requires `make dev` running)

```bash
make solver
# or
bash bot/deploy-solver.sh local
```

Sources `e2e/.env.local` and uses Anvil accounts 4, 6, 7 as the three solver EOAs. Auto-funds them with native ETH via `anvil_setBalance`.

### Staging (requires `make staging` running)

```bash
make solver MODE=staging
# or
bash bot/deploy-solver.sh staging
```

Sources `e2e/staging/.env.staging`. Requires three funded EOA private keys:

```bash
# Add to e2e/staging/.env.staging
SOLVER1_KEY=0x...
SOLVER2_KEY=0x...
SOLVER3_KEY=0x...
```

Each EOA must have at least `MIN_GAS` (default 5 MON) in native balance. The bot checks this on startup and exits with an error if any is underfunded.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MODE` | `local` | `local` (anvil) or `staging` (Monad testnet) |
| `RPC_URL` | — | RPC endpoint (sourced from env file) |
| `CONTRACT_ADDRESS` | — | ExpressiveLending contract address |
| `API_URL` | `localhost:3002` (local) / `localhost:3001` (staging) | Backend REST API |
| `SOLVER1_KEY` | — | Solver A private key |
| `SOLVER2_KEY` | — | Solver B private key |
| `SOLVER3_KEY` | — | Solver C private key |
| `MIN_GAS` | `5000000000000000000` (5 MON) | Minimum native gas balance (staging only) |
| `POLL_INTERVAL_MS` | `5000` | Polling interval between solver cycles |
