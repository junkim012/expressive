# DevOps

## Goal

A persistent demo deployment on Monad testnet with three independently deployable components:

1. **Smart contract** — deployed on Monad testnet via Foundry.
2. **Backend** — Node.js indexer + API on Railway (Docker-based, persistent SQLite volume).
3. **Frontend** — Next.js app on Railway (Docker-based, same project as the backend).

---

## Platform Decisions

| Component | Platform | Rationale |
|---|---|---|
| Smart Contract | Foundry + manual deploy | One-time broadcast; no continuous CD needed |
| Backend | Railway | Docker-native, persistent volumes, env vars UI, auto-deploy from monorepo subdir |
| Frontend | Railway | Same project as backend; Next.js runs fine as a containerized Node server |

**Why Railway for everything (backend + frontend):**
- One platform, one dashboard, one place to manage env vars
- Both services live in the same Railway project, linked to the same GitHub repo via subdir deploys
- Docker is sufficient for Next.js at demo scale — no edge CDN or ISR needed
- Eliminates the Vercel/Railway split and the coordination overhead that comes with it

---

## Monorepo Structure

```
expressive-lending/
├── contracts/          # Foundry project
│   ├── src/
│   ├── script/
│   └── foundry.toml
├── app/                # Next.js frontend
│   ├── src/
│   ├── Dockerfile
│   ├── package.json
│   └── next.config.ts
├── infra/              # Node.js backend (indexer + API)
│   ├── src/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── package.json
└── .github/
    └── workflows/
        ├── contracts.yml   # forge test on push
        ├── backend.yml     # tsc --noEmit on push
        └── frontend.yml    # tsc --noEmit + next build on push
```

---

## Railway Project Layout

One Railway **project**, two **services**:

| Service | Root directory | Dockerfile | Volume |
|---|---|---|---|
| `backend` | `infra/` | `infra/Dockerfile` | `/data` (SQLite) |
| `frontend` | `app/` | `app/Dockerfile` | None |

Each service gets its own Railway-assigned public URL and its own env var set. They auto-deploy independently when their subdirectory changes on `main`.

---

## Smart Contract Deployment

### Prerequisites

- Foundry installed (`forge`, `cast`)
- Monad testnet RPC URL
- Deployer wallet private key (funded with testnet MON)
- Token addresses for collateral assets, borrow assets, and oracles on Monad testnet

### Deployment Steps

```bash
cd contracts

# 1. Edit Deploy.s.sol with actual Monad testnet addresses
#    - batchWindowSeconds, solverFeeRate, liquidationBonusRate
#    - collateralAssets[], borrowAssets[], oracles[]

# 2. Dry-run (no broadcast)
forge script script/Deploy.s.sol \
  --rpc-url $MONAD_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY

# 3. Broadcast
forge script script/Deploy.s.sol \
  --rpc-url $MONAD_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast

# forge prints the deployed address; record it
```

### Post-Deployment Checklist

- [ ] Record `CONTRACT_ADDRESS` from forge output
- [ ] Record `START_BLOCK` (deployment block — `cast receipt <TX_HASH> --rpc-url $MONAD_RPC_URL | grep blockNumber`)
- [ ] Confirm `batchWindowSeconds`, `solverFeeRate`, `liquidationBonusRate` match intended values
- [ ] Update `infra/src/config/assets.ts` to match the exact whitelist passed to the constructor
- [ ] Update `backend` and `frontend` Railway service env vars (see below)

### Redeployment

Every redeployment produces a new contract address. Follow this sequence:

1. Redeploy via `forge script --broadcast`
2. Update `CONTRACT_ADDRESS` and `START_BLOCK` in the `backend` Railway service env vars
3. **Wipe the Railway SQLite volume** (see Volume Wipe Procedure) — the old DB is for the old contract
4. Update `NEXT_PUBLIC_CONTRACT_ADDRESS` in the `frontend` Railway service env vars
5. Push to `main` (or trigger manual redeploy) — both services redeploy; backend resyncs from scratch

---

## Backend Service (Railway)

### Setup (one-time)

1. Create a Railway project, link to the GitHub repo
2. Add a service, set **Root Directory** to `infra/`
3. Railway detects `infra/Dockerfile` automatically
4. Create a **persistent volume**, mount at `/data`
5. Set env vars

### Environment Variables

| Variable | Value | Notes |
|---|---|---|
| `RPC_URL` | `https://testnet-rpc.monad.xyz` | Monad testnet HTTP RPC |
| `CONTRACT_ADDRESS` | `0x...` | From forge deploy output |
| `START_BLOCK` | `<deployment block>` | From deploy tx receipt |
| `SOLVER_FEE_RATE` | `10` | Must match contract constructor arg (bps) |
| `POLL_INTERVAL_MS` | `2000` | 2s live polling interval |
| `LOG_CHUNK_SIZE` | `500` | Start conservative; increase if Monad RPC allows |
| `DB_PATH` | `/data/index.db` | Points to the persistent volume mount |

Railway injects `PORT` automatically — the backend should read `process.env.PORT` and default to `3001` for local dev.

### Volume Wipe Procedure (contract redeployment only)

1. Railway dashboard → `backend` service → **Volumes**
2. Unmount the volume, delete or clear the SQLite file, remount at `/data`
3. Redeploy — indexer seeds `last_indexed_block = START_BLOCK - 1` and resyncs from scratch

---

## Frontend Service (Railway)

### Dockerfile

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

This uses Next.js [standalone output mode](https://nextjs.org/docs/app/api-reference/next-config-js/output), which bundles only what's needed and produces a `server.js` entry point. Add to `next.config.ts`:

```ts
const nextConfig = {
  output: 'standalone',
}
export default nextConfig
```

### Setup (one-time)

1. In the same Railway project, add a second service, set **Root Directory** to `app/`
2. Railway detects `app/Dockerfile` automatically
3. Set env vars (see below)
4. No volume needed

### Environment Variables

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<backend-service>.up.railway.app` | Railway backend service URL |
| `NEXT_PUBLIC_WS_URL` | `wss://<backend-service>.up.railway.app/ws/orderbook` | WebSocket URL |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | `0x...` | Lending contract address |
| `NEXT_PUBLIC_CHAIN_ID` | `10143` | Monad testnet chain ID (confirm on Monad docs) |
| `NEXT_PUBLIC_RPC_URL` | `https://testnet-rpc.monad.xyz` | Public RPC for wagmi/viem |

All frontend vars are prefixed `NEXT_PUBLIC_` — they are baked into the client-side bundle at build time.

**Important:** Railway injects env vars at runtime, but `NEXT_PUBLIC_*` vars must be present at **build time** (when `npm run build` runs inside the Dockerfile). Railway handles this correctly as long as the vars are set in the service settings before the first deploy.

---

## CI / GitHub Actions

CI validates; Railway handles deploys automatically on push to `main`.

### `contracts.yml`

```yaml
name: Contracts
on:
  push:
    paths: ['contracts/**']

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - uses: foundry-rs/foundry-toolchain@v1
      - run: forge test --root contracts -vvv
```

### `backend.yml`

```yaml
name: Backend
on:
  push:
    paths: ['infra/**']

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
        working-directory: infra
      - run: npx tsc --noEmit
        working-directory: infra
```

### `frontend.yml`

```yaml
name: Frontend
on:
  push:
    paths: ['app/**']

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
        working-directory: app
      - run: npx tsc --noEmit
        working-directory: app
      - run: npm run build
        working-directory: app
        env:
          # Dummy values so next build doesn't fail on missing NEXT_PUBLIC_ vars
          NEXT_PUBLIC_API_URL: http://localhost:3001
          NEXT_PUBLIC_WS_URL: ws://localhost:3001/ws/orderbook
          NEXT_PUBLIC_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000000"
          NEXT_PUBLIC_CHAIN_ID: "10143"
          NEXT_PUBLIC_RPC_URL: https://testnet-rpc.monad.xyz
```

---

## Local Development

### Backend

```bash
cd infra
cp .env.example .env
# Fill in RPC_URL, CONTRACT_ADDRESS, START_BLOCK, SOLVER_FEE_RATE

# Option A: Node directly
npm install && npm run dev

# Option B: Docker
docker compose up
```

`docker-compose.yml` mounts `./data` as the SQLite volume.

### Frontend

```bash
cd app
cp .env.local.example .env.local
# Set NEXT_PUBLIC_API_URL=http://localhost:3001, etc.

npm install && npm run dev   # http://localhost:3000
```

### Running Together

Start the backend first so the indexer is live before the frontend makes API calls. Both can point at Monad testnet or a local Anvil fork.

---

## Monitoring and Observability

### Railway logs

Railway dashboard → service → **Logs** tab. Both services stream live logs.

Backend indexer log format:
```
[indexer] Syncing: block 123456/200000 (61%)
[indexer] Live: indexed block 200002 (3 new events — 2 orders, 1 loan)
```

Frontend logs surface Next.js server errors and SSR output.

Railway retains 7 days of logs on the free tier.

### Health check

The backend exposes `GET /health` returning `{ "status": "ok", "lastIndexedBlock": N }`. Configure this as the Railway health check URL on the `backend` service to get automatic restart on crash.

### On-chain verification

```bash
cast call $CONTRACT_ADDRESS "windowStart()(uint256)" --rpc-url $MONAD_RPC_URL
cast receipt <TX_HASH> --rpc-url $MONAD_RPC_URL
```

Use the Monad testnet block explorer for tx hashes surfaced in the batch history table.

---

## Secrets Management

| Secret | Where stored | Who needs it |
|---|---|---|
| `DEPLOYER_PRIVATE_KEY` | Developer's local `.env` only | Only used during `forge script --broadcast` |
| `RPC_URL` (with API key) | Railway `backend` service env vars | Backend only — never in `NEXT_PUBLIC_` vars |
| Railway API token | Not needed | Railway auto-deploys from GitHub |

**The deployer private key is never committed, never in CI, and never in any cloud env var.** Contract deployment is a local one-time manual operation.

The frontend's `NEXT_PUBLIC_RPC_URL` is a public Monad testnet endpoint — no secret. If a rate-limited RPC key is required for reliability, use it only in the backend's `RPC_URL` env var.

---

## Recovery Procedures

### Service crash / unresponsive

Railway restarts the container automatically. If restart fails:
1. Check service logs for the error
2. Fix the code, push to `main` — Railway redeploys

### Backend fell behind (RPC outage)

The two-phase poller re-enters catch-up automatically. Watch for `Syncing:` lines in logs to confirm recovery. No manual action needed.

### Full resync needed

1. Wipe the SQLite volume (see Volume Wipe Procedure)
2. Confirm `START_BLOCK` is the contract's deployment block
3. Redeploy — full resync completes in under 2 minutes for demo-scale history

### Contract redeployment

Follow the full sequence in the Smart Contract → Redeployment section above. Key steps: update both services' env vars, wipe the backend volume, redeploy both.

### Wrong `SOLVER_FEE_RATE` in backend

1. Correct `SOLVER_FEE_RATE` in Railway `backend` env vars
2. Wipe the SQLite volume (incorrect `filled_amount` values must be discarded)
3. Redeploy — full resync from `START_BLOCK`

---

## Open Questions (resolved)

### Q: Railway vs. Vercel for the frontend?

**Decision:** Railway for both. One platform, one dashboard. Next.js with standalone output runs cleanly in Docker. Preview deploys and edge CDN are not needed for a demo.

### Q: Separate repos or monorepo?

**Decision:** Monorepo with subdir deploys. Railway supports per-service root directories, so `infra/` and `app/` deploy independently from the same repo.

### Q: SQLite persistence — what if Railway loses the volume?

**Acceptable.** A full resync from Monad testnet takes under 2 minutes at demo scale. The chain is the source of truth; the SQLite file is a cache.

### Q: Custom domain?

**Not required for demo.** Railway default URLs (`*.up.railway.app`) are sufficient. Custom domains can be added via Railway's domain settings at any time.
