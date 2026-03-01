
## Design Philosophy

Minimal, self-contained backend whose only job is to index on-chain events and serve them to the frontend. No business logic lives here — the contract is the source of truth. The backend is stateless except for its SQLite file and can be wiped and re-indexed from any block at any time.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 20+ |
| Language | TypeScript |
| HTTP server | Hono (lightweight, edge-compatible) |
| WebSocket | `ws` library |
| Database | SQLite via `better-sqlite3` |
| Ethereum client | viem (consistent with frontend) |
| Containerization | Docker + Docker Compose |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        Backend Process                  │
│                                                         │
│   ┌──────────────┐     ┌─────────────┐                 │
│   │ Event Poller │────▶│   SQLite    │                 │
│   │ (eth_getLogs)│     │    DB       │                 │
│   └──────────────┘     └──────┬──────┘                 │
│                               │                         │
│                        ┌──────▼──────┐                 │
│                        │  REST API   │──▶ Frontend     │
│                        │  WebSocket  │──▶ Frontend     │
│                        └─────────────┘                 │
└─────────────────────────────────────────────────────────┘
          │
          ▼
   Monad RPC node (eth_getLogs, eth_blockNumber)
```

The event poller and HTTP server run in the same process. The poller updates SQLite; the API reads from SQLite. WebSocket clients are notified by the poller after each successful indexing tick.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `RPC_URL` | Yes | Monad RPC endpoint (HTTP, not WebSocket) |
| `CONTRACT_ADDRESS` | Yes | Deployed lending contract address |
| `START_BLOCK` | Yes | Contract deployment block number (index from here) |
| `PORT` | No | HTTP/WS listen port (default `3001`) |
| `POLL_INTERVAL_MS` | No | Event polling interval in ms (default `2000`) |
| `LOG_CHUNK_SIZE` | No | Blocks per `eth_getLogs` call (default `500`) |
| `DB_PATH` | No | SQLite file path (default `./data/index.db`) |

---

## Database Schema

### `orders`

Stores both lend and borrow orders. Fields that are null for one type are left null.

```sql
CREATE TABLE orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        TEXT NOT NULL UNIQUE,   -- uint256 as string
  order_type      TEXT NOT NULL,          -- 'lend' | 'borrow'
  owner           TEXT NOT NULL,          -- checksummed address
  borrow_asset    TEXT NOT NULL,

  -- lend-only fields
  acceptable_collateral  TEXT,            -- JSON: address[]
  min_rate               INTEGER,
  max_ltv                INTEGER,
  max_duration           INTEGER,
  max_lltv               INTEGER,

  -- borrow-only fields
  collateral_assets      TEXT,            -- JSON: address[]
  collateral_amounts     TEXT,            -- JSON: uint256[] as strings
  max_rate               INTEGER,
  min_ltv                INTEGER,
  min_duration           INTEGER,
  min_lltv               INTEGER,
  fill_or_kill           INTEGER,         -- 0 | 1

  -- common
  amount          TEXT NOT NULL,          -- uint256 as string
  filled_amount   TEXT NOT NULL DEFAULT '0',
  status          TEXT NOT NULL DEFAULT 'open', -- 'open' | 'filled'
  placed_at       INTEGER NOT NULL,       -- Unix timestamp from event
  block_number    INTEGER NOT NULL,
  tx_hash         TEXT NOT NULL
);

CREATE INDEX orders_owner ON orders(owner);
CREATE INDEX orders_type_status ON orders(order_type, status);
```

### `loans`

```sql
CREATE TABLE loans (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id         TEXT NOT NULL UNIQUE,   -- uint256 as string
  lend_order_id   TEXT NOT NULL,
  borrow_order_id TEXT NOT NULL,
  lender          TEXT NOT NULL,
  borrower        TEXT NOT NULL,
  borrow_asset    TEXT NOT NULL,
  principal       TEXT NOT NULL,          -- uint256 as string
  rate            INTEGER NOT NULL,       -- basis points
  ltv             INTEGER NOT NULL,       -- basis points (from LoanCreated event)
  lltv            INTEGER NOT NULL,       -- basis points (from LoanCreated event)
  maturity_date   INTEGER NOT NULL,       -- Unix timestamp
  origination_date INTEGER NOT NULL,      -- Unix timestamp (from LoanCreated event)
  status          TEXT NOT NULL DEFAULT 'active', -- 'active'|'repaid'|'liquidated'|'defaulted'
  block_number    INTEGER NOT NULL,
  tx_hash         TEXT NOT NULL
);

CREATE INDEX loans_lender ON loans(lender);
CREATE INDEX loans_borrower ON loans(borrower);
```

### `loan_events`

Event log for per-loan status transitions.

```sql
CREATE TABLE loan_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id      TEXT NOT NULL,
  event_type   TEXT NOT NULL,     -- 'repaid' | 'liquidated' | 'defaulted'
  liquidator   TEXT,              -- address, only for liquidated
  block_number INTEGER NOT NULL,
  block_time   INTEGER NOT NULL,  -- Unix timestamp
  tx_hash      TEXT NOT NULL
);

CREATE INDEX loan_events_loan ON loan_events(loan_id);
```

### `batches`

```sql
CREATE TABLE batches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  window_id     TEXT NOT NULL UNIQUE,   -- uint256 as string
  solver        TEXT,                   -- NULL for empty windows (no submissions)
  total_surplus TEXT NOT NULL,          -- uint256 as string
  pair_count    INTEGER NOT NULL,
  executed_at   INTEGER NOT NULL,       -- Unix timestamp (block timestamp)
  block_number  INTEGER NOT NULL,
  tx_hash       TEXT NOT NULL
);
```

`solver` is nullable because the contract emits `BatchExecuted(windowId, address(0), 0, 0)` for windows that closed with no valid submissions. These are inserted with `solver = null` and `pair_count = 0` so the batch history shows a complete window timeline.

### `indexer_state`

Tracks the last successfully indexed block so restarts resume from where they left off.

```sql
CREATE TABLE indexer_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Seed: INSERT INTO indexer_state VALUES ('last_indexed_block', '<START_BLOCK - 1>');
```

---

## Event Poller

### Two-Phase Polling Loop

The poller operates in two distinct phases based on how far behind the chain tip it is.

**Phase 1 — Catch-up** (when `latestBlock - lastIndexedBlock > currentChunkSize`):

```
currentChunkSize = LOG_CHUNK_SIZE   // reset to configured max on each successful fetch

loop:
  latestBlock = eth_blockNumber()
  if lastIndexedBlock >= latestBlock: break to Phase 2

  fromBlock = lastIndexedBlock + 1
  toBlock   = min(latestBlock, fromBlock + currentChunkSize - 1)

  try:
    logs = eth_getLogs({ address, fromBlock, toBlock, topics })
    process(logs)
    lastIndexedBlock = toBlock
    currentChunkSize = LOG_CHUNK_SIZE   // reset after success
    log(`Syncing: block ${toBlock}/${latestBlock} (${pct}%)`)
    // no sleep — loop immediately to next chunk

  catch RPC_RANGE_TOO_LARGE:
    currentChunkSize = max(floor(currentChunkSize / 2), 1)
    log(`RPC range error — retrying with chunkSize=${currentChunkSize}`)
    // retry same fromBlock with smaller chunk

  catch other error:
    log(error); sleep(2000); continue
```

No sleep between chunks during catch-up — the loop runs as fast as the RPC allows.

**Phase 2 — Live** (at or near tip):

```
every POLL_INTERVAL_MS:
  latestBlock = eth_blockNumber()
  fromBlock   = lastIndexedBlock + 1
  if fromBlock > latestBlock: continue

  toBlock = min(latestBlock, fromBlock + currentChunkSize - 1)

  try:
    logs = eth_getLogs({ address, fromBlock, toBlock, topics })
    process(logs)
    lastIndexedBlock = toBlock
    if any new orders or fills: broadcast to WebSocket subscribers

  catch RPC_RANGE_TOO_LARGE:
    currentChunkSize = max(floor(currentChunkSize / 2), 1)
    // will retry with smaller range on next tick

  catch other error:
    log(error)   // retry on next tick
```

The poller transitions automatically: on startup it enters Phase 1 until caught up, then falls into the Phase 2 tick loop. If Phase 2 ever finds it has fallen more than `currentChunkSize` blocks behind (e.g. after a crash or RPC outage), it re-enters Phase 1.

Single `eth_getLogs` call per tick covers all 7 event types. No separate calls per event.

### RPC Range Error Detection

Different RPC providers return different error messages for oversized ranges. The poller matches on:

- `"query returned more than"` (Alchemy, Infura)
- `"block range is too large"` or `"exceed maximum block range"` (QuickNode, others)
- HTTP 413 response body

On any match: halve `currentChunkSize` and retry from the same `fromBlock`. `currentChunkSize` resets to `LOG_CHUNK_SIZE` after the first successful fetch at the smaller size.

Monad's RPC limits are not yet publicly documented. Start with `LOG_CHUNK_SIZE=500` (conservative) and increase experimentally up to the observed limit.

### Catch-up Speed (Monad context)

At Monad's ~1-second block time:

| History | Blocks | Chunks (500/chunk) | Est. time (500ms/RPC) |
|---|---|---|---|
| 1 hour | 3,600 | 8 | ~4s |
| 1 day | 86,400 | 173 | ~87s |
| 1 week | 604,800 | 1,210 | ~10 min |
| 1 month | 2,592,000 | 5,184 | ~43 min |

For a hackathon/demo context (contract deployed hours or days before), initial sync will complete in under 2 minutes. If faster sync is needed, increase `LOG_CHUNK_SIZE` to 2000–5000 if the RPC node permits.

### Event Handlers

| Event | Action |
|---|---|
| `LendOrderPlaced` | INSERT into `orders` with `order_type='lend'`, `filled_amount='0'`, `status='open'` |
| `BorrowOrderPlaced` | INSERT into `orders` with `order_type='borrow'`, `filled_amount='0'`, `status='open'` |
| `LoanCreated` | INSERT into `loans` using fields from the event directly (see notes below); UPDATE `orders.filled_amount` for both `lendOrderId` and `borrowOrderId` by adding `event.matchAmount`; if `filled_amount >= amount`, set `status='filled'` |
| `BatchExecuted` | INSERT into `batches`; if `solver == address(0)`, insert with `solver = null` (empty window — no submissions) |
| `LoanRepaid` | UPDATE `loans.status='repaid'`; INSERT into `loan_events` |
| `LoanLiquidated` | UPDATE `loans.status='liquidated'`; INSERT into `loan_events` with `liquidator` field |
| `LoanDefaulted` | UPDATE `loans.status='defaulted'`; INSERT into `loan_events` |

All writes for a single polling tick are wrapped in a single SQLite transaction for atomicity. Logs within a block are processed in log-index order (eth_getLogs returns them sorted), which is critical for the `LoanDefaulted` + `LoanLiquidated` same-tx case (see edge cases below).

**Idempotency and replay safety.** All INSERT statements use `INSERT OR IGNORE` keyed on the contract-assigned ID (e.g. `order_id`, `loan_id`, `window_id`). This makes replaying the same block range safe for inserts. However, the `LoanCreated` handler also fires UPDATE statements to increment `orders.filled_amount` — these must only run if the INSERT actually wrote a new row. Use SQLite's `changes()` function to gate the update:

```
-- Handler for LoanCreated:
INSERT OR IGNORE INTO loans (loan_id, ...) VALUES (...);

IF changes() > 0 THEN   -- row was newly inserted (not a replay)
  UPDATE orders SET filled_amount = filled_amount + matchAmount
    WHERE order_id = lendOrderId;
  UPDATE orders SET filled_amount = filled_amount + matchAmount
    WHERE order_id = borrowOrderId;
  -- update status='filled' if filled_amount >= amount
```

If `changes() == 0`, the loan was already indexed and the filled_amount update is skipped. Without this guard, replaying a block range would double-count fills.

### Filled Amount Tracking

The contract updates `filledAmount` with `matchAmount` (the gross amount before the solver fee), not `principal` (the net amount after the fee). The `LoanCreated` event emits `matchAmount` directly, so the backend uses it as-is:

```
order.filled_amount += event.matchAmount
```

No reverse-computation is needed.

### `LoanCreated` — derived fields

`LoanCreated` does not emit `borrow_asset`. The backend derives it:

- **`borrow_asset`**: looked up from the `orders` table using `lendOrderId` (already indexed from `LendOrderPlaced`).

All other fields required for the `loans` row are emitted directly by the event: `matchAmount`, `principal`, `rate`, `ltv`, `lltv`, `maturityDate`, `originationDate`.

`LoanCreated` does not emit `collateralAssets` or `collateralAmounts` for the loan. The backend does **not** store per-loan collateral. The frontend's Loan Detail Modal fetches collateral directly from the contract via `getLoan(loanId)` (which returns the full `Loan` struct including `collateralAssets` and `collateralAmounts`). This is already classified as a "Direct RPC Polling" data source in the frontend spec.

### Edge cases

**`LoanDefaulted` has two emission paths.** The contract emits this event from:
1. `liquidate()` — lazily when a previously Active loan is past maturity. The sequence in one tx is: `LoanDefaulted` then `LoanLiquidated`.
2. `markDefaulted()` — a standalone permissionless function anyone can call on an overdue Active loan. Emits only `LoanDefaulted`.

The `LoanDefaulted` handler is identical in both cases (set `status='defaulted'`, insert `loan_events` row). In path (1), the subsequent `LoanLiquidated` log overwrites status to `'liquidated'`. Log ordering ensures this is applied correctly.

**`LoanDefaulted` + `LoanLiquidated` in the same transaction.** When `liquidate()` is called on an Active loan that has passed maturity, both events appear in a single tx. The poller processes them in ascending log-index order: `defaulted` handler runs first, then `liquidated` handler. Final stored status: `'liquidated'`.

**`redeem()` emits no event.** The contract's `redeem()` function burns the lender NFT and transfers principal+interest to the NFT holder, but no event is emitted. NFT redemptions are not visible to the indexer. This is acceptable: the frontend doesn't need to display redemption state, and loan status (`repaid` or `liquidated`) is already tracked from other events.

---

## REST API

Base path: `/api/v1`

### `GET /orders`

Returns orders filtered by query params. All params are optional.

| Param | Type | Description |
|---|---|---|
| `status` | `open \| filled` | Filter by fill status. Default: all. |
| `owner` | address | Filter by order owner |
| `type` | `lend \| borrow` | Filter by order type |

**Response:**
```json
{
  "orders": [
    {
      "orderId": "42",
      "orderType": "lend",
      "owner": "0x...",
      "borrowAsset": "0x...",
      "acceptableCollateral": ["0x...", "0x..."],
      "minRate": 400,
      "maxLtv": 7000,
      "maxDuration": 7776000,
      "maxLltv": 8000,
      "amount": "1000000000",
      "filledAmount": "500000000",
      "status": "open",
      "placedAt": 1700000000
    }
  ]
}
```

Borrow orders include `collateralAssets`, `collateralAmounts`, `maxRate`, `minLtv`, `minDuration`, `minLltv`, `fillOrKill` instead of lend-only fields.

### `GET /loans`

| Param | Type | Description |
|---|---|---|
| `lender` | address | Filter by lender |
| `borrower` | address | Filter by borrower |
| `status` | `active \| repaid \| liquidated \| defaulted` | Filter by status |

**Response:**
```json
{
  "loans": [
    {
      "loanId": "7",
      "lendOrderId": "3",
      "borrowOrderId": "12",
      "lender": "0x...",
      "borrower": "0x...",
      "borrowAsset": "0x...",
      "principal": "1000000000",
      "rate": 525,
      "ltv": 6000,
      "lltv": 7500,
      "maturityDate": 1731776000,
      "originationDate": 1700000000,
      "status": "active",
      "txHash": "0x..."
    }
  ]
}
```

### `GET /loans/:loanId`

Returns a single loan plus its full event history.

**Response:**
```json
{
  "loan": { /* same fields as above */ },
  "events": [
    {
      "eventType": "liquidated",
      "liquidator": "0x...",
      "blockNumber": 1234567,
      "blockTime": 1715000000,
      "txHash": "0x..."
    }
  ]
}
```

### `GET /batches`

Paginated batch history, most recent first.

| Param | Type | Description |
|---|---|---|
| `page` | integer | Page number (default `1`) |
| `limit` | integer | Per page (default `20`, max `100`) |

**Response:**
```json
{
  "batches": [
    {
      "windowId": "55",
      "solver": "0x...",      // null for empty windows
      "totalSurplus": "3200000",
      "pairCount": 4,
      "executedAt": 1700001234,
      "txHash": "0x..."
    }
  ],
  "total": 55,
  "page": 1,
  "limit": 20
}
```

Empty windows (`pairCount = 0`, `solver = null`) are included in the response. The frontend batch history page should render these as "No matches" rows.

### `GET /assets`

Returns the hard-coded whitelisted asset list.

**Response:**
```json
{
  "borrowAssets": [
    {
      "address": "0x...",
      "symbol": "USDC",
      "decimals": 6,
      "logoUrl": "/assets/usdc.svg"
    }
  ],
  "collateralAssets": [
    {
      "address": "0x...",
      "symbol": "WBTC",
      "decimals": 8,
      "logoUrl": "/assets/wbtc.svg"
    },
    {
      "address": "0x...",
      "symbol": "WETH",
      "decimals": 18,
      "logoUrl": "/assets/weth.svg"
    }
  ]
}
```

This is served from a static config file (`src/config/assets.ts`). It never queries the chain.

---

## WebSocket

Endpoint: `ws://<host>/ws/orderbook`

The connection is unauthenticated. Clients subscribe by connecting.

### Server → Client messages

**`snapshot`** — sent immediately on connection with the full current open order book:
```json
{
  "type": "snapshot",
  "data": {
    "lendOrders": [ /* same shape as GET /orders response */ ],
    "borrowOrders": [ /* same shape */ ]
  }
}
```

**`update`** — pushed after each polling tick that produced new events:
```json
{
  "type": "update",
  "data": {
    "newOrders": [ /* newly placed orders */ ],
    "updatedOrders": [ /* orders with changed filledAmount or status */ ]
  }
}
```

Clients apply updates on top of the snapshot they received. There is no delta-compression — the full order object is sent on every update. Given the order book size for a prototype, this is sufficient.

The server broadcasts to all connected clients — no per-client filtering or subscription topics.

---

## Asset Config File

`src/config/assets.ts` is the single source of truth for the asset list. Example:

```typescript
export const ASSETS = {
  borrowAssets: [
    {
      address: "0x...",
      symbol: "USDC",
      decimals: 6,
      logoUrl: "/assets/usdc.svg",
    },
  ],
  collateralAssets: [
    {
      address: "0x...",
      symbol: "WBTC",
      decimals: 8,
      logoUrl: "/assets/wbtc.svg",
    },
    {
      address: "0x...",
      symbol: "WETH",
      decimals: 18,
      logoUrl: "/assets/weth.svg",
    },
  ],
} as const;
```

This list must match the contract's constructor-set whitelist exactly. It is updated manually when re-deploying with a different whitelist.

---

## Project Structure

```
backend/
├── src/
│   ├── index.ts            # Entry point: starts poller + HTTP server
│   ├── config/
│   │   ├── env.ts          # Parses and validates env vars
│   │   └── assets.ts       # Hard-coded asset whitelist
│   ├── db/
│   │   ├── client.ts       # better-sqlite3 singleton
│   │   └── migrations.ts   # CREATE TABLE statements, run on startup
│   ├── indexer/
│   │   ├── poller.ts       # eth_getLogs polling loop
│   │   └── handlers.ts     # Per-event-type DB write logic
│   ├── api/
│   │   ├── server.ts       # Hono app, mounts all routes
│   │   ├── routes/
│   │   │   ├── orders.ts
│   │   │   ├── loans.ts
│   │   │   ├── batches.ts
│   │   │   └── assets.ts
│   └── ws/
│       └── server.ts       # ws server, broadcast helper
├── data/                   # SQLite file (git-ignored)
├── Dockerfile
├── docker-compose.yml      # For local dev with env file
├── package.json
└── tsconfig.json
```

---

## Dockerfile

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

RUN mkdir -p /data
VOLUME ["/data"]

ENV DB_PATH=/data/index.db
ENV PORT=3001

EXPOSE 3001
CMD ["node", "dist/index.js"]
```

Mount `/data` as a persistent volume in cloud deployments to survive container restarts without re-indexing from scratch.

---

## Startup Sequence

1. Parse and validate env vars — fail fast if required vars are missing
2. Open (or create) SQLite DB; run migrations if tables don't exist
3. Read `last_indexed_block` from `indexer_state`:
   - If present: resume from `last_indexed_block + 1` (normal restart / crash recovery)
   - If absent: seed with `START_BLOCK - 1` (fresh DB — full historical sync required)
4. Start HTTP server (Hono) and WebSocket server on `PORT`
5. Start event poller — enters Phase 1 (catch-up) if behind tip, Phase 2 (live) if already at tip

The API is available immediately on startup. It returns partial/empty results during catch-up, which is acceptable — the frontend's polling tolerates this.

Log the sync state on startup:
```
[indexer] Resuming from block 123456 (chain tip: 200000, behind by 76544 blocks)
[indexer] Starting catch-up sync...
```

---

## Restart and Redeployment Behavior

### Normal restart (container redeploy, crash recovery)

`last_indexed_block` is persisted in SQLite. On restart the poller resumes from `lastIndexedBlock + 1`. No events are re-indexed; no data loss. The `/data` volume must be mounted as persistent storage in the cloud deployment — if the volume is lost, the indexer performs a full resync (see below).

### Full resync (DB wiped or contract redeployed)

Trigger a full resync by either:
- Deleting (or not mounting) the SQLite volume — `last_indexed_block` will be absent, so the poller starts from `START_BLOCK`
- Setting `START_BLOCK` to an earlier block number — the poller will re-index from there on the next restart (only useful if `last_indexed_block` is also reset or the DB is wiped)

Because all INSERTs use `ON CONFLICT IGNORE` and all UPDATEs are gated on `changes() > 0`, a full resync is idempotent — running it twice produces the same DB state.

### Contract redeployment (new contract address)

When the lending contract is redeployed:
1. Update `CONTRACT_ADDRESS` to the new address in the deployment env
2. Update `START_BLOCK` to the new contract's deployment block
3. **Wipe the SQLite volume** — the old DB contains events from the previous contract address; mixing them is incorrect
4. Restart the indexer — it will perform a full resync of the new contract

There is no migration path between contract deployments; a fresh DB is always the correct approach.

---

## Error Handling

- **RPC range too large**: detected by error message pattern (see RPC Range Error Detection). Handled by halving `currentChunkSize` and retrying from the same `fromBlock`. Never crashes; converges to a working chunk size.
- **Other RPC errors**: logged, poller sleeps 2s and retries. No crash.
- **Re-org handling**: Not implemented in v1. Mitigation: the poller never indexes the absolute tip — `toBlock = min(latestBlock, ...)` where the latest block is always at least 0 confirmations. Deep re-orgs on Monad L1 are unlikely. Full re-org handling (rollback by block hash) is a v2 concern.
- **Replay idempotency**: `INSERT OR IGNORE` prevents duplicate rows. `UPDATE` statements are gated on `changes() > 0` to prevent double-counting fills. Replaying any block range is safe.
- **API errors**: Hono's built-in error handler returns JSON `{ error: "message" }` with appropriate HTTP status codes.

---

## CORS

The API server sets `Access-Control-Allow-Origin: *` for all routes. The frontend and backend may be on different origins in staging. Tighten to the specific frontend origin in production.

---

## Outstanding Questions

### A. Authentication
**Not required.** All API endpoints are read-only and return public on-chain data. No auth layer.

### B. Rate Limiting
**Deferred to v2.** Not implemented in v1. Add if the public staging endpoint becomes a target for abuse.

### C. Re-org Handling
**Deferred to v2.** The v1 poller is append-only. A Monad L1 with fast finality makes deep re-orgs unlikely in practice.

### D. Backfill Speed
**Decided.** Two-phase poller: catch-up runs chunks back-to-back with no sleep; live phase uses `POLL_INTERVAL_MS`. Adaptive chunk sizing (halve on RPC range error, reset on success) handles unknown RPC limits. `LOG_CHUNK_SIZE=500` is the conservative default; increase if the Monad RPC node permits larger ranges.

---

## Contract View Functions for Health

The contract exposes two health-related view functions:

```solidity
function isHealthy(uint256 loanId) external view returns (bool)
function getHealthFactor(uint256 loanId) external view returns (uint256)
```

`getHealthFactor` returns the collateral-to-threshold ratio scaled by `BASIS_POINTS` (10 000). A value of 10 000 means the loan is exactly at the liquidation boundary; values above 10 000 are healthy; values below are undercollateralised. The frontend can call this directly to drive health bars and numeric displays without computing the ratio client-side.
