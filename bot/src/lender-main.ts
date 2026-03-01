import 'dotenv/config';
import { loadLenderConfig } from './config';
import { createLenderClients } from './chain';
import { runLender } from './lender';
import { log, resetLogFiles } from './logger';
import { approveMax, fundLocal, checkBalances } from './setup';

const LABELS = ['Lender-1', 'Lender-2'] as const;

async function main() {
  const config = loadLenderConfig();
  const { publicClient, walletClients } = createLenderClients(config);

  resetLogFiles([...LABELS]);

  const addresses = walletClients.map((wc) => wc.account!.address);

  console.log(`\n  Expressive Lending — Lender Bots (${config.mode})\n`);
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

    // Approve USDC for lending
    await approveMax(LABELS[i], walletClients[i], config.tokens.usdc, config.contractAddress, 'USDC');
  }
  console.log('');

  // ── Start 2 lender loops, staggered by 2s ────────────────────────────────
  const tasks = walletClients.map((wc, i) =>
    sleep(i * 2000).then(() =>
      runLender(LABELS[i], wc, publicClient, config.contractAddress, config.tokens),
    ),
  );

  console.log('  All lender bots running. Press Ctrl+C to stop.\n');
  await Promise.all(tasks);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('\n  [FATAL]', err.message ?? err);
  process.exit(1);
});
