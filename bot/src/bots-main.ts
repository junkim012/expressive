import 'dotenv/config';
import { loadConfig, loadLenderConfig, loadBorrowerConfig } from './config';
import { createClients, createLenderClients, createBorrowerClients } from './chain';
import { runSolver } from './solver';
import { runLender } from './lender';
import { runBorrower } from './borrower';
import { log, resetLogFiles } from './logger';
import { approveMax, fundLocal, checkBalances } from './setup';
import { GreedyStrategy } from './strategies/greedy';
import { MultiPairStrategy } from './strategies/multiPair';
import { ExhaustiveStrategy } from './strategies/exhaustive';

const SOLVER_LABELS = ['Solver-A', 'Solver-B', 'Solver-C'] as const;
const LENDER_LABELS = ['Lender-1', 'Lender-2'] as const;
const BORROWER_LABELS = ['Borrower-1', 'Borrower-2'] as const;

async function main() {
  const solverConfig = loadConfig();
  const lenderConfig = loadLenderConfig();
  const borrowerConfig = loadBorrowerConfig();

  const solver = createClients(solverConfig);
  const lender = createLenderClients(lenderConfig);
  const borrower = createBorrowerClients(borrowerConfig);

  // Reset all log files
  resetLogFiles();

  console.log(`\n  Expressive Lending — All Bots (${solverConfig.mode})\n`);
  console.log(`  Contract:  ${solverConfig.contractAddress}`);
  console.log(`  RPC:       ${solverConfig.rpcUrl}`);
  console.log(`  API:       ${solverConfig.apiUrl}\n`);

  for (let i = 0; i < 3; i++) {
    console.log(`  ${SOLVER_LABELS[i]}:    ${solver.walletClients[i].account!.address}`);
  }
  for (let i = 0; i < 2; i++) {
    console.log(`  ${LENDER_LABELS[i]}:    ${lender.walletClients[i].account!.address}`);
  }
  for (let i = 0; i < 2; i++) {
    console.log(`  ${BORROWER_LABELS[i]}:  ${borrower.walletClients[i].account!.address}`);
  }
  console.log('');

  // ── Setup solvers ─────────────────────────────────────────────────────────
  if (solverConfig.mode === 'local') {
    for (let i = 0; i < solver.walletClients.length; i++) {
      const addr = solver.walletClients[i].account!.address;
      await solver.publicClient.request({
        method: 'anvil_setBalance' as any,
        params: [addr, '0xd3c21bcecceda1000000'],
      });
      log(SOLVER_LABELS[i], `Funded ${addr} with 1M ETH (anvil)`);
    }
  } else {
    for (let i = 0; i < solver.walletClients.length; i++) {
      const addr = solver.walletClients[i].account!.address as `0x${string}`;
      const balance = await solver.publicClient.getBalance({ address: addr });
      if (balance < solverConfig.minGas) {
        throw new Error(
          `${SOLVER_LABELS[i]} (${addr}) has insufficient gas: ${balance} < ${solverConfig.minGas}`,
        );
      }
      log(SOLVER_LABELS[i], `Gas OK: ${Number(balance / 10n ** 15n) / 1000} MON`);
    }
  }

  // ── Setup lenders ─────────────────────────────────────────────────────────
  for (let i = 0; i < lender.walletClients.length; i++) {
    const addr = lender.walletClients[i].account!.address as `0x${string}`;
    if (lenderConfig.mode === 'local') {
      await fundLocal(LENDER_LABELS[i], lender.publicClient, addr, lenderConfig.tokens, lenderConfig.deployerKey!, lenderConfig.rpcUrl);
    } else {
      await checkBalances(LENDER_LABELS[i], lender.publicClient, addr, lenderConfig.tokens, lenderConfig.minGas);
    }
    await approveMax(LENDER_LABELS[i], lender.walletClients[i], lenderConfig.tokens.usdc, lenderConfig.contractAddress, 'USDC');
  }

  // ── Setup borrowers ───────────────────────────────────────────────────────
  for (let i = 0; i < borrower.walletClients.length; i++) {
    const addr = borrower.walletClients[i].account!.address as `0x${string}`;
    if (borrowerConfig.mode === 'local') {
      await fundLocal(BORROWER_LABELS[i], borrower.publicClient, addr, borrowerConfig.tokens, borrowerConfig.deployerKey!, borrowerConfig.rpcUrl);
    } else {
      await checkBalances(BORROWER_LABELS[i], borrower.publicClient, addr, borrowerConfig.tokens, borrowerConfig.minGas);
    }
    await approveMax(BORROWER_LABELS[i], borrower.walletClients[i], borrowerConfig.tokens.wbtc, borrowerConfig.contractAddress, 'WBTC');
    await approveMax(BORROWER_LABELS[i], borrower.walletClients[i], borrowerConfig.tokens.weth, borrowerConfig.contractAddress, 'WETH');
  }

  console.log('');

  // ── Start all 7 bot loops, staggered ──────────────────────────────────────
  const strategies = [new GreedyStrategy(), new MultiPairStrategy(), new ExhaustiveStrategy()];

  const tasks: Promise<void>[] = [];

  // 3 solvers (staggered 0s, 2s, 4s)
  for (let i = 0; i < 3; i++) {
    tasks.push(
      sleep(i * 2000).then(() =>
        runSolver(SOLVER_LABELS[i], solver.walletClients[i], solver.publicClient, strategies[i], solverConfig),
      ),
    );
  }

  // 2 lenders (staggered 6s, 8s)
  for (let i = 0; i < 2; i++) {
    tasks.push(
      sleep(6000 + i * 2000).then(() =>
        runLender(LENDER_LABELS[i], lender.walletClients[i], lender.publicClient, lenderConfig.contractAddress, lenderConfig.tokens),
      ),
    );
  }

  // 2 borrowers (staggered 10s, 12s)
  for (let i = 0; i < 2; i++) {
    tasks.push(
      sleep(10000 + i * 2000).then(() =>
        runBorrower(
          BORROWER_LABELS[i], borrower.walletClients[i], borrower.publicClient,
          borrowerConfig.contractAddress, borrowerConfig.tokens,
          borrowerConfig.btcPrice, borrowerConfig.ethPrice,
        ),
      ),
    );
  }

  console.log('  All 7 bots running. Press Ctrl+C to stop.\n');
  await Promise.all(tasks);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('\n  [FATAL]', err.message ?? err);
  process.exit(1);
});
