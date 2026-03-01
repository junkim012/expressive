"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { UnlinkProvider } from "@unlink-xyz/react";
import { WalletModeProvider } from "@/lib/walletMode";
import { wagmiConfig } from "@/lib/wagmi";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            retry: 2,
          },
        },
      })
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <UnlinkProvider
          chain="monad-testnet"
          chainRpcUrl={process.env.NEXT_PUBLIC_RPC_URL}
        >
          <WalletModeProvider>
            {children}
          </WalletModeProvider>
        </UnlinkProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
