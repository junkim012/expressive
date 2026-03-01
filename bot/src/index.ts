import 'dotenv/config';
import { loadConfig } from './config';
import { createClients } from './chain';
import { runSolver } from './solver';
import { log, resetLogFiles } from './logger';
import { GreedyStrategy } from './strategies/greedy';
import { MultiPairStrategy } from './strategies/multiPair';
import { ExhaustiveStrategy } from './strategies/exhaustive';

async function main() {
  const config = loadConfig();
  const { publicClient, walletClients } = createClients(config);

  resetLogFiles();

  const labels = ['Solver-A', 'Solver-B', 'Solver-C'] as const;
  const addresses = walletClients.map((wc) => wc.account!.address);

  console.log(`\n  Expressive Lending — Solver Bot (${config.mode})\n`);
  console.log(`  Contract:  ${config.contractAddress}`);
  console.log(`  RPC:       ${config.rpcUrl}`);
  console.log(`  API:       ${config.apiUrl}`);
  console.log(`  Poll:      ${config.pollIntervalMs}ms\n`);

  for (let i = 0; i < 3; i++) {
    console.log(`  ${labels[i]}:  ${addresses[i]}`);
  }
  console.log('');

  // ── Local mode: fund solver EOAs via anvil ──────────────────────────────
  if (config.mode === 'local') {
    for (let i = 0; i < walletClients.length; i++) {
      const addr = addresses[i];
      await publicClient.request({
        method: 'anvil_setBalance' as any,
        params: [addr, '0xd3c21bcecceda1000000'], // 1M ETH
      });
      log(labels[i], `Funded ${addr} with 1M ETH (anvil)`);
    }
    console.log('');
  }

  // ── Staging mode: check gas balances ────────────────────────────────────
  if (config.mode === 'staging') {
    for (let i = 0; i < walletClients.length; i++) {
      const addr = addresses[i];
      const balance = await publicClient.getBalance({ address: addr as `0x${string}` });
      if (balance < config.minGas) {
        throw new Error(
          `${labels[i]} (${addr}) has insufficient gas: ` +
            `${balance} < ${config.minGas} (MIN_GAS). ` +
            `Fund this address with at least ${Number(config.minGas) / 1e18} MON.`,
        );
      }
      log(labels[i], `Gas OK: ${Number(balance / 10n ** 15n) / 1000} MON`);
    }
    console.log('');
  }

  // ── Start 3 solver loops, staggered by 2s ──────────────────────────────
  const strategies = [
    new GreedyStrategy(),
    new MultiPairStrategy(),
    new ExhaustiveStrategy(),
  ];

  const tasks = walletClients.map((wc, i) =>
    sleep(i * 2000).then(() =>
      runSolver(labels[i], wc, publicClient, strategies[i], config),
    ),
  );

  console.log('  All solvers running. Press Ctrl+C to stop.\n');
  await Promise.all(tasks);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('\n  [FATAL]', err.message ?? err);
  process.exit(1);
});
