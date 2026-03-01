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
import type { Config } from './config';

const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.monad.xyz'] },
  },
});

export type SolverWalletClient = WalletClient<Transport, Chain, Account>;

export interface Clients {
  publicClient: PublicClient<Transport, Chain>;
  walletClients: SolverWalletClient[];
}

export function createClients(config: Config): Clients {
  const chain = config.mode === 'local' ? foundry : monadTestnet;
  const transport = http(config.rpcUrl);

  const publicClient = createPublicClient({ chain, transport }) as PublicClient<Transport, Chain>;

  const walletClients: SolverWalletClient[] = config.solverKeys.map((key) => {
    const account = privateKeyToAccount(key);
    return createWalletClient({ account, chain, transport });
  });

  return { publicClient, walletClients };
}
