"use client";

import { useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useUnlink } from "@unlink-xyz/react";
import {
  getBurnersForWallet,
  type BurnerEntry,
} from "@/lib/burnerStorage";
import {
  fetchLendOrders,
  fetchBorrowOrders,
  fetchLoans,
} from "@/lib/api";
import type { LendOrder, BorrowOrder, Loan } from "@/types";

export type PrivateBurnerPositions = {
  burner: BurnerEntry;
  lendOrders: LendOrder[];
  borrowOrders: BorrowOrder[];
  lenderLoans: Loan[];
  borrowerLoans: Loan[];
  tokenBalance: bigint;
};

export function usePrivatePositions(token?: string) {
  const { address } = useAccount();
  const { walletExists, burnerGetTokenBalance } = useUnlink();

  // Read burner entries from localStorage (client-side only)
  const [burners, setBurners] = useState<BurnerEntry[]>([]);
  useEffect(() => {
    if (address) setBurners(getBurnersForWallet(address));
  }, [address]);

  // Fetch orders + loans for each burner in parallel
  const positionQueries = useQueries({
    queries: burners.map((entry) => ({
      queryKey: ["private-positions", entry.burnerAddress],
      queryFn: async (): Promise<PrivateBurnerPositions> => {
        const [lendOrders, borrowOrders, lenderLoans, borrowerLoans] =
          await Promise.all([
            fetchLendOrders({ owner: entry.burnerAddress }),
            fetchBorrowOrders({ owner: entry.burnerAddress }),
            fetchLoans({ lender: entry.burnerAddress }),
            fetchLoans({ borrower: entry.burnerAddress }),
          ]);

        let tokenBalance = 0n;
        if (token && walletExists) {
          try {
            tokenBalance = await burnerGetTokenBalance(
              entry.burnerAddress,
              token
            );
          } catch {
            tokenBalance = 0n;
          }
        }

        return { burner: entry, lendOrders, borrowOrders, lenderLoans, borrowerLoans, tokenBalance };
      },
      enabled: !!address && walletExists,
      refetchInterval: 15_000,
    })),
  });

  const positions = positionQueries
    .filter((q) => q.data !== undefined)
    .map((q) => q.data as PrivateBurnerPositions);

  const isLoading = positionQueries.some((q) => q.isLoading);

  return { positions, isLoading, walletExists, burners };
}
