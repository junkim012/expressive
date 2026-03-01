"use client";

import { useEffect, useState } from "react";
import { useReadContracts } from "wagmi";
import { CONTRACT_ADDRESS, CONTRACT_ABI } from "@/lib/contract";
import { formatCountdown } from "@/lib/format";
import Link from "next/link";

export function BatchStatusBadge() {
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const { data } = useReadContracts({
    contracts: [
      { address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: "windowStart" },
      { address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: "batchWindowSeconds" },
      { address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: "currentBestSurplus" },
      { address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: "winningPairCount" },
    ],
    query: { refetchInterval: 2000 },
  });

  const windowStart = data?.[0]?.result ? Number(data[0].result as bigint) : null;
  const windowSecs = data?.[1]?.result ? Number(data[1].result as bigint) : null;
  const surplus = data?.[2]?.result as bigint | undefined;
  const pairCount = data?.[3]?.result ? Number(data[3].result as bigint) : 0;

  if (windowStart === null || windowSecs === null) {
    return (
      <Link href="/batch" className="flex items-center gap-2 text-terminal-muted hover:text-terminal-text transition-colors">
        <span className="w-1.5 h-1.5 rounded-full bg-terminal-muted" />
        <span className="text-xs">BATCH —</span>
      </Link>
    );
  }

  const deadline = windowStart + windowSecs;
  const remaining = deadline - now;
  const isOpen = remaining > 0;

  return (
    <Link
      href="/batch"
      className="flex items-center gap-2 text-xs hover:text-terminal-text transition-colors group"
    >
      <span
        className={`w-1.5 h-1.5 rounded-full animate-pulse ${
          isOpen ? "bg-terminal-green" : "bg-terminal-amber"
        }`}
      />
      <span className={isOpen ? "text-terminal-green" : "text-terminal-amber"}>
        {isOpen ? "OPEN" : "EXECUTING"}
      </span>
      <span className="text-terminal-muted">|</span>
      {isOpen ? (
        <span className="text-terminal-text tabular-nums">
          {formatCountdown(remaining)}
        </span>
      ) : (
        <span className="text-terminal-amber">Awaiting execution</span>
      )}
      {pairCount > 0 && (
        <>
          <span className="text-terminal-muted">|</span>
          <span className="text-terminal-muted">{pairCount} pairs</span>
        </>
      )}
    </Link>
  );
}
