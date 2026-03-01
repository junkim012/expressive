export type Mode = 'local' | 'staging';

export interface Config {
  mode: Mode;
  rpcUrl: string;
  contractAddress: `0x${string}`;
  apiUrl: string;
  solverKeys: [`0x${string}`, `0x${string}`, `0x${string}`];
  pollIntervalMs: number;
  minGas: bigint;
}

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export function loadConfig(): Config {
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
    solverKeys: [
      required('SOLVER1_KEY') as `0x${string}`,
      required('SOLVER2_KEY') as `0x${string}`,
      required('SOLVER3_KEY') as `0x${string}`,
    ],
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? '5000'),
    minGas: BigInt(process.env.MIN_GAS ?? '5000000000000000000'), // 5 MON
  };
}
