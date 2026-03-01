import { createPublicClient, http, parseAbi, parseEventLogs } from 'viem';
import { db } from '../db/client';
import { env } from '../config/env';
import { broadcastUpdate } from '../ws/server';
import {
  handleLendOrderPlaced,
  handleBorrowOrderPlaced,
  handleLoanCreated,
  handleBatchExecuted,
  handleLoanRepaid,
  handleLoanLiquidated,
  handleLoanDefaulted,
} from './handlers';

// ── Contract ABI (events only) ────────────────────────────────────────────────

const CONTRACT_ABI = parseAbi([
  'event LendOrderPlaced(uint256 indexed orderId, address indexed owner, address borrowAsset, address[] acceptableCollateral, uint256 minRate, uint256 maxLTV, uint256 maxDuration, uint256 maxLLTV, uint256 amount, uint256 timestamp)',
  'event BorrowOrderPlaced(uint256 indexed orderId, address indexed owner, address borrowAsset, address[] collateralAssets, uint256[] collateralAmounts, uint256 maxRate, uint256 minLTV, uint256 minDuration, uint256 minLLTV, uint256 amount, bool fillOrKill, uint256 timestamp)',
  'event LoanCreated(uint256 indexed loanId, uint256 indexed lendOrderId, uint256 indexed borrowOrderId, address lender, address borrower, uint256 matchAmount, uint256 principal, uint256 rate, uint256 ltv, uint256 lltv, uint256 maturityDate, uint256 originationDate)',
  'event BatchExecuted(uint256 indexed windowId, address indexed solver, uint256 totalSurplus, uint256 pairCount)',
  'event LoanRepaid(uint256 indexed loanId)',
  'event LoanLiquidated(uint256 indexed loanId, address indexed liquidator)',
  'event LoanDefaulted(uint256 indexed loanId)',
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

const client = createPublicClient({ transport: http(env.RPC_URL) });

function bigIntMin(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRangeError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('query returned more than') ||
    msg.includes('block range is too large') ||
    msg.includes('exceed maximum block range') ||
    msg.includes('413')
  );
}

function getLastIndexedBlock(): bigint {
  const row = db
    .prepare("SELECT value FROM indexer_state WHERE key = 'last_indexed_block'")
    .get() as { value: string } | undefined;
  return BigInt(row?.value ?? env.START_BLOCK - 1n);
}

function setLastIndexedBlock(block: bigint): void {
  db.prepare("UPDATE indexer_state SET value = ? WHERE key = 'last_indexed_block'").run(
    block.toString(),
  );
}

// ── Core tick: fetch one chunk and write to DB ────────────────────────────────

async function processTick(
  fromBlock: bigint,
  toBlock: bigint,
): Promise<{ hasEvents: boolean; newOrderIds: string[]; updatedOrderIds: string[] }> {
  // Fetch raw logs for this block range
  const rawLogs = await client.getLogs({
    address: env.CONTRACT_ADDRESS,
    fromBlock,
    toBlock,
  });

  // Fetch block timestamps for every unique block that has logs
  const uniqueBlocks = [...new Set(rawLogs.map((l) => l.blockNumber).filter(Boolean))] as bigint[];
  const blockTimestamps = new Map<bigint, number>();

  if (uniqueBlocks.length > 0) {
    const blockData = await Promise.all(
      uniqueBlocks.map((n) => client.getBlock({ blockNumber: n })),
    );
    for (const b of blockData) {
      blockTimestamps.set(b.number, Number(b.timestamp));
    }
  }

  // Decode only our contract events (ERC721 Transfer etc. are silently ignored)
  const parsed = parseEventLogs({ abi: CONTRACT_ABI, logs: rawLogs, strict: false });

  const newOrderIds: string[] = [];
  const updatedOrderIds: string[] = [];

  // All DB writes for this tick in a single transaction
  const applyTx = db.transaction(() => {
    for (const log of parsed) {
      const ctx = {
        blockNumber: Number(log.blockNumber),
        blockTime: blockTimestamps.get(log.blockNumber!) ?? 0,
        txHash: log.transactionHash ?? '',
      };

      switch (log.eventName) {
        case 'LendOrderPlaced':
          handleLendOrderPlaced(log.args as any, ctx, newOrderIds);
          break;
        case 'BorrowOrderPlaced':
          handleBorrowOrderPlaced(log.args as any, ctx, newOrderIds);
          break;
        case 'LoanCreated':
          handleLoanCreated(log.args as any, ctx, updatedOrderIds);
          break;
        case 'BatchExecuted':
          handleBatchExecuted(log.args as any, ctx);
          break;
        case 'LoanRepaid':
          handleLoanRepaid(log.args as any, ctx);
          break;
        case 'LoanLiquidated':
          handleLoanLiquidated(log.args as any, ctx);
          break;
        case 'LoanDefaulted':
          handleLoanDefaulted(log.args as any, ctx);
          break;
      }
    }

    setLastIndexedBlock(toBlock);
  });

  applyTx();

  return {
    hasEvents: parsed.length > 0,
    newOrderIds,
    updatedOrderIds,
  };
}

// ── Main poller ───────────────────────────────────────────────────────────────

export async function startPoller(): Promise<void> {
  let lastIndexedBlock = getLastIndexedBlock();
  let chunkSize = env.LOG_CHUNK_SIZE;

  // ── Phase 1: catch-up ──────────────────────────────────────────────────────
  const latestAtStart = await client.getBlockNumber();

  if (lastIndexedBlock < latestAtStart) {
    console.log(
      `[indexer] Resuming from block ${lastIndexedBlock} (chain tip: ${latestAtStart}, behind by ${latestAtStart - lastIndexedBlock} blocks)`,
    );
    console.log('[indexer] Starting catch-up sync...');

    while (true) {
      const latestBlock = await client.getBlockNumber();
      if (lastIndexedBlock >= latestBlock) break;

      const fromBlock = lastIndexedBlock + 1n;
      const toBlock = bigIntMin(latestBlock, fromBlock + BigInt(chunkSize) - 1n);

      try {
        await processTick(fromBlock, toBlock);
        lastIndexedBlock = toBlock;
        chunkSize = env.LOG_CHUNK_SIZE; // reset after success

        const pct = Number(((toBlock - env.START_BLOCK) * 100n) / (latestBlock - env.START_BLOCK + 1n));
        process.stdout.write(`\r[indexer] Syncing: block ${toBlock}/${latestBlock} (${pct}%)`);
      } catch (err) {
        if (isRangeError(err)) {
          chunkSize = Math.max(Math.floor(chunkSize / 2), 1);
          console.log(`\n[indexer] RPC range error — retrying with chunkSize=${chunkSize}`);
        } else {
          console.error('\n[indexer] Catch-up error:', err);
          await sleep(2000);
        }
      }
    }

    console.log('\n[indexer] Caught up. Entering live polling mode.');
  } else {
    console.log('[indexer] Already at chain tip. Starting live polling mode.');
  }

  // ── Phase 2: live polling ─────────────────────────────────────────────────
  const livePoll = async (): Promise<void> => {
    try {
      const latestBlock = await client.getBlockNumber();
      const fromBlock = lastIndexedBlock + 1n;

      if (fromBlock > latestBlock) return;

      const toBlock = bigIntMin(latestBlock, fromBlock + BigInt(chunkSize) - 1n);

      const { hasEvents, newOrderIds, updatedOrderIds } = await processTick(fromBlock, toBlock);
      lastIndexedBlock = toBlock;
      chunkSize = env.LOG_CHUNK_SIZE;

      if (hasEvents) {
        broadcastUpdate(newOrderIds, updatedOrderIds);
      }
    } catch (err) {
      if (isRangeError(err)) {
        chunkSize = Math.max(Math.floor(chunkSize / 2), 1);
        console.log(`[indexer] Live: RPC range error — reducing chunkSize to ${chunkSize}`);
      } else {
        console.error('[indexer] Live poll error:', err);
      }
    }
  };

  setInterval(livePoll, env.POLL_INTERVAL_MS);
}
