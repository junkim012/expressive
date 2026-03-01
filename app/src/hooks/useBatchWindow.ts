"use client";

import { useEffect, useReducer } from "react";
import { useReadContracts } from "wagmi";
import { CONTRACT_ADDRESS, CONTRACT_ABI } from "@/lib/contract";

export function useBatchWindow() {
  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      { address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: "windowId" },
      { address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: "windowStart" },
      { address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: "batchWindowSeconds" },
      { address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: "currentBestSurplus" },
      { address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: "currentWinner" },
      { address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: "winningPairCount" },
    ],
    query: { refetchInterval: 2000 },
  });

  const windowId = data?.[0]?.result ? Number(data[0].result as bigint) : null;
  const windowStart = data?.[1]?.result ? Number(data[1].result as bigint) : null;
  const windowSecs = data?.[2]?.result ? Number(data[2].result as bigint) : null;
  const currentBestSurplus = data?.[3]?.result as bigint | undefined;
  const currentWinner = data?.[4]?.result as string | undefined;
  const pairCount = data?.[5]?.result ? Number(data[5].result as bigint) : 0;

  const deadline = windowStart !== null && windowSecs !== null ? windowStart + windowSecs : null;

  return {
    windowId,
    windowStart,
    windowSecs,
    deadline,
    currentBestSurplus,
    currentWinner,
    pairCount,
    isLoading,
    refetch,
  };
}
