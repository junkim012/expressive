# Staging Test — Monad Testnet

This document covers running the Expressive Lending UI against a contract deployed on Monad testnet. No Anvil, no local deployment.

---

## One-Time Setup

### Wallet Setup
On testnet, we MUST NOT use anvil wallets. Because these wallets have known private keys and are monitored.

### 1. Deploy the contract to Monad testnet

```bash
cd contracts
forge script script/Deploy.s.sol \
  --rpc-url https://testnet-rpc.monad.xyz \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast
```

Note the deployed `CONTRACT_ADDRESS` and `START_BLOCK` from the output.

### 2. Configure staging env

```bash
cp e2e/staging/.env.staging.example e2e/staging/.env.staging
```

Edit `e2e/staging/.env.staging` and fill in:

| Variable | Description |
|---|---|
| `CONTRACT_ADDRESS` | Address of the deployed `ExpressiveLending` contract |
| `START_BLOCK` | Block number of the deployment transaction |
| `SOLVER_FEE_RATE` | Fee rate passed at deploy time (in bps, e.g. `10`) |
| `USDC`, `WBTC`, `WETH` | Token addresses on Monad testnet |
| `BTC_ORACLE`, `ETH_ORACLE` | Oracle addresses on Monad testnet |

`RPC_URL` is pre-filled as `https://testnet-rpc.monad.xyz` — change only if using a private RPC.

### 3. Update asset config in the backend

Edit `backend/src/config/assets.ts` to add/update entries for the Monad testnet token addresses. This tells the backend's indexer which assets to track.

---

## Running the Staging Stack

```bash
make staging
```

This starts:
- **Backend** on `:3001` — indexes Monad testnet from `START_BLOCK`, stores to `backend/data/staging.db`
- **Frontend** on `:3000` — points to `https://testnet-rpc.monad.xyz` (chain 10143)

The backend uses a 2-second poll interval to match Monad testnet block time.

Open http://localhost:3000 in your browser.

---

## Wallet Setup

Use **Rabby** or **MetaMask** set to **Monad Testnet** (chain ID `10143`). The app will prompt you to switch networks if you are on the wrong chain.

You'll need testnet MON for gas. Use the [Monad testnet faucet](https://faucet.monad.xyz).

No test wallets or pre-funded accounts are available in staging (unlike local dev with Anvil).

---

## How Unlink SDK Works in Staging

`app/src/providers/index.tsx` already passes `chain="monad-testnet"` to `UnlinkProvider`. No code changes are needed — pointing the frontend at the Monad testnet RPC is sufficient.

---

## Key Differences from Local Dev

| | `make dev` | `make staging` |
|---|---|---|
| Chain | Anvil (31337) | Monad testnet (10143) |
| RPC | `http://localhost:8545` | `https://testnet-rpc.monad.xyz` |
| Anvil | Yes | No |
| Contract deploy | Automatic | Manual (one-time) |
| Database | `backend/data/local.db` | `backend/data/staging.db` |
| Bots (`make action`) | Yes | No |
| Test wallets | Yes (Anvil accounts) | No — use real testnet wallet |

---

## Log Locations

```
/tmp/el-backend.log
/tmp/el-frontend.log
```

Tail both with:

```bash
make logs
```

---

## Stopping

Press `Ctrl+C` in the terminal running `make staging`. All background processes are killed cleanly.
