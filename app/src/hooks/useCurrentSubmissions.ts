"use client";

import { useEffect, useState, useRef } from "react";
import { decodeFunctionData, getAddress } from "viem";
import { publicClient } from "@/lib/burnerClient";
import { CONTRACT_ADDRESS, CONTRACT_ABI, SUBMIT_BATCH_ABI } from "@/lib/contract";
import { useBatchWindow } from "./useBatchWindow";

export interface Submission {
  solver: string;
  pairCount: number;
  timestamp: number;
  txHash: string;
  surplus: bigint | null;
  success: boolean;
}

export function useCurrentSubmissions() {
  const { windowStart, windowId } = useBatchWindow();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const lastScannedRef = useRef<bigint>(0n);
  const prevWindowRef = useRef<number | null>(null);

  useEffect(() => {
    if (!windowStart || windowId === null) return;

    // Reset on window change
    if (prevWindowRef.current !== windowId) {
      setSubmissions([]);
      lastScannedRef.current = 0n;
      prevWindowRef.current = windowId;
    }

    let cancelled = false;

    async function scan() {
      try {
        const latest = await publicClient.getBlockNumber();

        let fromBlock: bigint;
        if (lastScannedRef.current > 0n) {
          fromBlock = lastScannedRef.current + 1n;
          if (fromBlock > latest) return;
        } else {
          // Estimate window start block (~1 block/sec on Monad, add buffer)
          const now = Math.floor(Date.now() / 1000);
          const elapsed = BigInt(Math.max(now - windowStart!, 0));
          fromBlock = latest > elapsed + 20n ? latest - elapsed - 20n : 0n;
        }

        // Collect block numbers to scan
        const blockNums: bigint[] = [];
        for (let bn = fromBlock; bn <= latest; bn++) blockNums.push(bn);

        // Fetch blocks in parallel batches of 20
        const CHUNK = 20;
        const candidates: Array<{
          solver: string;
          pairCount: number;
          timestamp: number;
          txHash: string;
          blockNumber: bigint;
        }> = [];

        for (let i = 0; i < blockNums.length; i += CHUNK) {
          if (cancelled) return;
          const chunk = blockNums.slice(i, i + CHUNK);
          const blocks = await Promise.all(
            chunk.map((bn) =>
              publicClient
                .getBlock({ blockNumber: bn, includeTransactions: true })
                .catch(() => null)
            )
          );

          for (const block of blocks) {
            if (!block || Number(block.timestamp) < windowStart!) continue;
            for (const tx of block.transactions) {
              if (typeof tx === "string") continue;
              if (tx.to?.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) continue;
              try {
                const decoded = decodeFunctionData({
                  abi: SUBMIT_BATCH_ABI,
                  data: tx.input,
                });
                if (decoded.functionName === "submitBatch") {
                  const pairs = decoded.args[0] as readonly unknown[];
                  candidates.push({
                    solver: getAddress(tx.from),
                    pairCount: pairs.length,
                    timestamp: Number(block.timestamp),
                    txHash: tx.hash,
                    blockNumber: block.number,
                  });
                }
              } catch {
                // Not a submitBatch call
              }
            }
          }
        }

        if (cancelled) return;

        // For each candidate, check receipt status and read surplus at that block
        const newSubs: Submission[] = await Promise.all(
          candidates.map(async (c) => {
            try {
              const [receipt, surplus] = await Promise.all([
                publicClient.getTransactionReceipt({
                  hash: c.txHash as `0x${string}`,
                }),
                publicClient.readContract({
                  address: CONTRACT_ADDRESS,
                  abi: CONTRACT_ABI,
                  functionName: "currentBestSurplus",
                  blockNumber: c.blockNumber,
                }),
              ]);
              const ok = receipt.status === "success";
              return {
                solver: c.solver,
                pairCount: c.pairCount,
                timestamp: c.timestamp,
                txHash: c.txHash,
                surplus: ok ? (surplus as bigint) : null,
                success: ok,
              };
            } catch {
              return { ...c, surplus: null, success: false };
            }
          })
        );

        if (!cancelled) {
          if (newSubs.length > 0) {
            setSubmissions((prev) => [...prev, ...newSubs]);
          }
          lastScannedRef.current = latest;
          setIsLoading(false);
        }
      } catch (err) {
        console.error("[useCurrentSubmissions] scan error:", err);
        if (!cancelled) setIsLoading(false);
      }
    }

    scan();
    const interval = setInterval(scan, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [windowStart, windowId]);

  return { submissions, isLoading };
}
