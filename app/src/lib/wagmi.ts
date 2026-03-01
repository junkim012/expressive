import { createConfig, http } from "wagmi";
import { injected, walletConnect, coinbaseWallet } from "wagmi/connectors";
import { type Chain } from "viem";

// Build the chain definition from env vars
const chainId = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID ?? "31337");
const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL ?? "http://localhost:8545";

// Anvil / local chain
export const localChain: Chain = {
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://localhost:8545"] } },
};

// Monad Testnet (chain ID 41454 or as configured)
export const monadTestnet: Chain = {
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" },
  },
};

function getChain(): Chain {
  if (chainId === 10143)
    return { ...monadTestnet, rpcUrls: { default: { http: [rpcUrl] } } };
  // Default to local for dev
  return { ...localChain, id: chainId, rpcUrls: { default: { http: [rpcUrl] } } };
}

const activeChain = getChain();

const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

export const wagmiConfig = createConfig({
  chains: [activeChain],
  connectors: [
    injected(),
    ...(wcProjectId
      ? [walletConnect({ projectId: wcProjectId })]
      : []),
    coinbaseWallet({ appName: "Expressive Lending" }),
  ],
  transports: {
    [activeChain.id]: http(rpcUrl),
  },
  ssr: true,
});

export { activeChain };
