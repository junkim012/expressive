import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  type PublicClient,
  type WalletClient,
  type Transport,
  type Chain,
  type Account,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import type { BaseConfig, SolverConfig, LenderConfig, BorrowerConfig } from './config';

const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.monad.xyz'] },
  },
});

export type BotWalletClient = WalletClient<Transport, Chain, Account>;

// Keep backward compat
export type SolverWalletClient = BotWalletClient;

export interface Clients {
  publicClient: PublicClient<Transport, Chain>;
  walletClients: BotWalletClient[];
}

function buildClients(config: BaseConfig, keys: `0x${string}`[]): Clients {
  const chain = config.mode === 'local'
    ? foundry
    : { ...monadTestnet, rpcUrls: { default: { http: [config.rpcUrl] } } };
  const transport = http(config.rpcUrl);

  const publicClient = createPublicClient({ chain, transport }) as PublicClient<Transport, Chain>;

  const walletClients: BotWalletClient[] = keys.map((key) => {
    const account = privateKeyToAccount(key);
    return createWalletClient({ account, chain, transport });
  });

  return { publicClient, walletClients };
}

export function createClients(config: SolverConfig): Clients {
  return buildClients(config, [...config.solverKeys]);
}

export function createLenderClients(config: LenderConfig): Clients {
  return buildClients(config, [...config.lenderKeys]);
}

export function createBorrowerClients(config: BorrowerConfig): Clients {
  return buildClients(config, [...config.borrowerKeys]);
}
