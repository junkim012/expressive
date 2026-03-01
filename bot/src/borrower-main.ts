import 'dotenv/config';
import { loadBorrowerConfig } from './config';
import { createBorrowerClients } from './chain';
import { runBorrower } from './borrower';
import { log, resetLogFiles } from './logger';
import { approveMax, fundLocal, checkBalances } from './setup';

const LABELS = ['Borrower-1', 'Borrower-2'] as const;

async function main() {
  const config = loadBorrowerConfig();
  const { publicClient, walletClients } = createBorrowerClients(config);

  resetLogFiles([...LABELS]);

  const addresses = walletClients.map((wc) => wc.account!.address);

  console.log(`\n  Expressive Lending — Borrower Bots (${config.mode})\n`);
  console.log(`  Contract:  ${config.contractAddress}`);
  console.log(`  RPC:       ${config.rpcUrl}\n`);
  for (let i = 0; i < 2; i++) {
    console.log(`  ${LABELS[i]}:  ${addresses[i]}`);
  }
  console.log('');

  // ── Setup: fund (local) or check balances (staging) ───────────────────────
  for (let i = 0; i < walletClients.length; i++) {
    const addr = addresses[i] as `0x${string}`;

    if (config.mode === 'local') {
      await fundLocal(LABELS[i], publicClient, addr, config.tokens, config.deployerKey!, config.rpcUrl);
    } else {
      await checkBalances(LABELS[i], publicClient, addr, config.tokens, config.minGas);
    }

    // Approve WBTC + WETH for collateral
    await approveMax(LABELS[i], walletClients[i], config.tokens.wbtc, config.contractAddress, 'WBTC');
    await approveMax(LABELS[i], walletClients[i], config.tokens.weth, config.contractAddress, 'WETH');
  }
  console.log('');

  // ── Start 2 borrower loops, staggered by 2s ──────────────────────────────
  const tasks = walletClients.map((wc, i) =>
    sleep(i * 2000).then(() =>
      runBorrower(
        LABELS[i], wc, publicClient, config.contractAddress,
        config.tokens, config.btcPrice, config.ethPrice,
      ),
    ),
  );

  console.log('  All borrower bots running. Press Ctrl+C to stop.\n');
  await Promise.all(tasks);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('\n  [FATAL]', err.message ?? err);
  process.exit(1);
});
