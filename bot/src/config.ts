export type Mode = 'local' | 'staging';

export interface BaseConfig {
  mode: Mode;
  rpcUrl: string;
  contractAddress: `0x${string}`;
  apiUrl: string;
  pollIntervalMs: number;
  minGas: bigint;
}

export interface SolverConfig extends BaseConfig {
  solverKeys: [`0x${string}`, `0x${string}`, `0x${string}`];
}

export interface TokenAddresses {
  usdc: `0x${string}`;
  wbtc: `0x${string}`;
  weth: `0x${string}`;
}

export interface LenderConfig extends BaseConfig {
  lenderKeys: [`0x${string}`, `0x${string}`];
  tokens: TokenAddresses;
  deployerKey?: `0x${string}`;
  btcPrice: bigint;
  ethPrice: bigint;
}

export interface BorrowerConfig extends BaseConfig {
  borrowerKeys: [`0x${string}`, `0x${string}`];
  tokens: TokenAddresses;
  deployerKey?: `0x${string}`;
  btcPrice: bigint;
  ethPrice: bigint;
}

// Keep backward compatibility: Config = SolverConfig
export type Config = SolverConfig;

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function loadBaseConfig(): BaseConfig {
  const mode = (process.env.MODE ?? 'local') as Mode;
  if (mode !== 'local' && mode !== 'staging') {
    throw new Error(`Invalid MODE: ${mode} (must be "local" or "staging")`);
  }

  const defaultApiUrl = mode === 'local' ? 'http://localhost:3002' : 'http://localhost:3001';

  return {
    mode,
    rpcUrl: required('RPC_URL'),
    contractAddress: required('CONTRACT_ADDRESS') as `0x${string}`,
    apiUrl: process.env.API_URL ?? defaultApiUrl,
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? '5000'),
    minGas: BigInt(process.env.MIN_GAS ?? '5000000000000000000'), // 5 MON
  };
}

function loadTokenAddresses(): TokenAddresses {
  return {
    usdc: required('USDC') as `0x${string}`,
    wbtc: required('WBTC') as `0x${string}`,
    weth: required('WETH') as `0x${string}`,
  };
}

export function loadConfig(): SolverConfig {
  return {
    ...loadBaseConfig(),
    solverKeys: [
      required('SOLVER1_KEY') as `0x${string}`,
      required('SOLVER2_KEY') as `0x${string}`,
      required('SOLVER3_KEY') as `0x${string}`,
    ],
  };
}

export function loadLenderConfig(): LenderConfig {
  const base = loadBaseConfig();
  return {
    ...base,
    lenderKeys: [
      required('LENDER1_KEY') as `0x${string}`,
      required('LENDER2_KEY') as `0x${string}`,
    ],
    tokens: loadTokenAddresses(),
    deployerKey: base.mode === 'local' ? (required('DEPLOYER_KEY') as `0x${string}`) : undefined,
    btcPrice: BigInt(process.env.BTC_PRICE ?? '80000000000'),   // 80_000e6
    ethPrice: BigInt(process.env.ETH_PRICE ?? '3000000000'),    // 3_000e6
  };
}

export function loadBorrowerConfig(): BorrowerConfig {
  const base = loadBaseConfig();
  return {
    ...base,
    borrowerKeys: [
      required('BORROWER1_KEY') as `0x${string}`,
      required('BORROWER2_KEY') as `0x${string}`,
    ],
    tokens: loadTokenAddresses(),
    deployerKey: base.mode === 'local' ? (required('DEPLOYER_KEY') as `0x${string}`) : undefined,
    btcPrice: BigInt(process.env.BTC_PRICE ?? '80000000000'),
    ethPrice: BigInt(process.env.ETH_PRICE ?? '3000000000'),
  };
}
