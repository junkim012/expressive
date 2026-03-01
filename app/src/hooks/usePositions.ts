"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { fetchLendOrders, fetchBorrowOrders, fetchLoans } from "@/lib/api";

export function useMyPositions() {
  const { address } = useAccount();

  const lendOrders = useQuery({
    queryKey: ["orders", "lend", address],
    queryFn: () => fetchLendOrders({ owner: address }),
    enabled: !!address,
    refetchInterval: 10_000,
  });

  const borrowOrders = useQuery({
    queryKey: ["orders", "borrow", address],
    queryFn: () => fetchBorrowOrders({ owner: address }),
    enabled: !!address,
    refetchInterval: 10_000,
  });

  const lenderLoans = useQuery({
    queryKey: ["loans", "lender", address],
    queryFn: () => fetchLoans({ lender: address }),
    enabled: !!address,
    refetchInterval: 10_000,
  });

  const borrowerLoans = useQuery({
    queryKey: ["loans", "borrower", address],
    queryFn: () => fetchLoans({ borrower: address }),
    enabled: !!address,
    refetchInterval: 10_000,
  });

  return { lendOrders, borrowOrders, lenderLoans, borrowerLoans, address };
}
