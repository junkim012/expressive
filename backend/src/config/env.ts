function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const env = {
  RPC_URL: required('RPC_URL'),
  CONTRACT_ADDRESS: required('CONTRACT_ADDRESS') as `0x${string}`,
  START_BLOCK: BigInt(required('START_BLOCK')),
  SOLVER_FEE_RATE: Number(required('SOLVER_FEE_RATE')),
  PORT: Number(process.env.PORT ?? '3001'),
  POLL_INTERVAL_MS: Number(process.env.POLL_INTERVAL_MS ?? '2000'),
  LOG_CHUNK_SIZE: Number(process.env.LOG_CHUNK_SIZE ?? '500'),
  DB_PATH: process.env.DB_PATH ?? './data/index.db',
};
