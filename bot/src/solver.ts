import type { PublicClient, Transport, Chain } from 'viem';
import type { SolverWalletClient } from './chain';
import { SOLVER_ABI } from './abi';
import { fetchOpenOrders } from './api';
import { generateCandidatePairs, buildConsumptions } from './matcher';
import { log, warn } from './logger';
import type { Config } from './config';
import type { Strategy } from './strategies';
import type { WindowState } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Read window state from chain
// ─────────────────────────────────────────────────────────────────────────────

async function readWindowState(
  publicClient: PublicClient<Transport, Chain>,
  contractAddress: `0x${string}`,
): Promise<WindowState> {
  const [windowId, windowStart, batchWindowSeconds, currentWinner, currentBestSurplus] =
    await Promise.all([
      publicClient.readContract({ address: contractAddress, abi: SOLVER_ABI, functionName: 'windowId' }),
      publicClient.readContract({ address: contractAddress, abi: SOLVER_ABI, functionName: 'windowStart' }),
      publicClient.readContract({ address: contractAddress, abi: SOLVER_ABI, functionName: 'batchWindowSeconds' }),
      publicClient.readContract({ address: contractAddress, abi: SOLVER_ABI, functionName: 'currentWinner' }),
      publicClient.readContract({ address: contractAddress, abi: SOLVER_ABI, functionName: 'currentBestSurplus' }),
    ]);

  return {
    windowId: windowId as bigint,
    windowStart: windowStart as bigint,
    batchWindowSeconds: batchWindowSeconds as bigint,
    currentWinner: currentWinner as string,
    currentBestSurplus: currentBestSurplus as bigint,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Execute expired window if no winner
// ─────────────────────────────────────────────────────────────────────────────

async function maybeExecuteExpiredWindow(
  label: string,
  walletClient: SolverWalletClient,
  publicClient: PublicClient<Transport, Chain>,
  windowState: WindowState,
  config: Config,
): Promise<void> {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const windowEnd = windowState.windowStart + windowState.batchWindowSeconds;

  if (now < windowEnd) return;

  log(label, `Window #${windowState.windowId} expired — calling executeBatch()`);
  try {
    const hash = await walletClient.writeContract({
      address: config.contractAddress,
      abi: SOLVER_ABI,
      functionName: 'executeBatch',
      chain: walletClient.chain,
    });
    log(label, `executeBatch tx: ${hash}`);
  } catch (err: any) {
    // Another solver may have already advanced the window
    warn(label, `executeBatch failed: ${err.shortMessage ?? err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Error classification
// ─────────────────────────────────────────────────────────────────────────────

function isSurplusNotHigherError(err: any): boolean {
  const msg = err?.shortMessage ?? err?.message ?? '';
  return msg.includes('SurplusNotHigher');
}

function isWindowStillOpenError(err: any): boolean {
  const msg = err?.shortMessage ?? err?.message ?? '';
  return msg.includes('WindowStillOpen');
}

// ─────────────────────────────────────────────────────────────────────────────
// Main solver loop
// ─────────────────────────────────────────────────────────────────────────────

export async function runSolver(
  label: string,
  walletClient: SolverWalletClient,
  publicClient: PublicClient<Transport, Chain>,
  strategy: Strategy,
  config: Config,
): Promise<void> {
  let lastWindowId = -1n;

  log(label, `Started (strategy: ${strategy.name}, poll: ${config.pollIntervalMs}ms)`);

  while (true) {
    try {
      // 1. Read window state
      const windowState = await readWindowState(publicClient, config.contractAddress);

      if (windowState.windowId !== lastWindowId) {
        const end = windowState.windowStart + windowState.batchWindowSeconds;
        log(label, `Window #${windowState.windowId} | closes at ${end}`);
        lastWindowId = windowState.windowId;
      }

      // 2. Fetch open orders from backend
      const { lends, borrows } = await fetchOpenOrders(config.apiUrl);

      // 3. Generate all candidate pairs
      const candidates = generateCandidatePairs(lends, borrows);

      if (candidates.length === 0) {
        log(label, `No compatible pairs (${lends.length} lend / ${borrows.length} borrow)`);
        await maybeExecuteExpiredWindow(label, walletClient, publicClient, windowState, config);
        await sleep(config.pollIntervalMs);
        continue;
      }

      // 4. Apply strategy
      const selected = strategy.select(candidates, lends, borrows);
      if (selected.length === 0) {
        log(label, 'Strategy returned no pairs');
        await sleep(config.pollIntervalMs);
        continue;
      }

      // 5. Build batch and submit
      const batch = buildConsumptions(selected);

      log(
        label,
        `Submitting ${selected.length} pair(s) | surplus=${batch.totalSurplus} | ` +
          selected
            .map((p) => `L#${p.lendOrderId}xB#${p.borrowOrderId}(${p.amount})`)
            .join(', '),
      );

      try {
        const hash = await walletClient.writeContract({
          address: config.contractAddress,
          abi: SOLVER_ABI,
          functionName: 'submitBatch',
          args: [batch.pairs, batch.consumptions],
          chain: walletClient.chain,
        });
        log(label, `submitBatch tx: ${hash}`);
      } catch (err: any) {
        if (isSurplusNotHigherError(err)) {
          log(label, 'Surplus not higher than current winner (expected contention)');
        } else if (isWindowStillOpenError(err)) {
          warn(label, `submitBatch rejected: ${err.shortMessage ?? err.message}`);
        } else {
          warn(label, `submitBatch reverted: ${err.shortMessage ?? err.message}`);
        }

        // Fallback: if submitBatch reverted and the window has expired,
        // call executeBatch() directly to advance the auction.
        // submitBatch auto-executes expired windows, but if the submission
        // itself is invalid the entire tx reverts — including the execution.
        await maybeExecuteExpiredWindow(label, walletClient, publicClient, windowState, config);
      }
    } catch (err: any) {
      warn(label, `Loop error: ${err.message}`);
    }

    await sleep(config.pollIntervalMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
