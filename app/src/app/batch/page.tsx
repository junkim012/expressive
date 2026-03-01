"use client";

import { useEffect, useState } from "react";
import { useReadContracts } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { useBatchWindow } from "@/hooks/useBatchWindow";
import { useAssets } from "@/hooks/useAssets";
import { useCurrentSubmissions } from "@/hooks/useCurrentSubmissions";
import { fetchBatches, fetchBatchLoans } from "@/lib/api";
import { CONTRACT_ADDRESS, CONTRACT_ABI } from "@/lib/contract";
import {
  formatCountdown,
  formatDate,
  formatDateTime,
  formatRate,
  formatTokenAmount,
  timeRemaining,
  truncateAddress,
} from "@/lib/format";
import type { Batch, Loan } from "@/types";

// ── Current window ────────────────────────────────────────────────────────────

function WinningPairRow({ index }: { index: number }) {
  const { data } = useReadContracts({
    contracts: [
      {
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "currentWinningPairs",
        args: [BigInt(index)],
      },
    ],
    query: { refetchInterval: 2000 },
  });

  const pair = data?.[0]?.result as [bigint, bigint, bigint] | undefined;
  if (!pair) return null;

  return (
    <tr className="border-b border-terminal-border text-xs">
      <td className="py-1.5 px-4 text-terminal-muted">{index + 1}</td>
      <td className="py-1.5 px-4">#{pair[0].toString()}</td>
      <td className="py-1.5 px-4">#{pair[1].toString()}</td>
      <td className="py-1.5 px-4 tabular-nums">{pair[2].toString()}</td>
    </tr>
  );
}

function CurrentWindowPanel() {
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const { data: assets } = useAssets();

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const {
    windowId,
    deadline,
    currentBestSurplus,
    currentWinner,
    pairCount,
    isLoading,
    windowSecs,
  } = useBatchWindow();

  const remaining = deadline !== null ? Math.max(0, deadline - now) : null;
  const isOpen = remaining !== null && remaining > 0;
  const pct =
    remaining !== null && windowSecs !== null
      ? Math.max(0, 100 - (remaining / windowSecs) * 100)
      : 0;

  // We'll read a simplified borrow asset (just the first one from assets)
  const borrowAsset = assets?.borrowAssets[0];

  return (
    <div className="border border-terminal-border bg-terminal-panel">
      <div className="px-4 py-2 border-b border-terminal-border">
        <span className="text-xs font-semibold tracking-widest text-terminal-text">
          CURRENT WINDOW
          {windowId !== null && (
            <span className="ml-2 text-terminal-muted">#{windowId}</span>
          )}
        </span>
      </div>

      <div className="p-4 flex flex-col gap-4">
        {/* Large countdown */}
        <div className="flex items-center gap-6">
          <div>
            <div className="text-[10px] tracking-widest text-terminal-muted mb-1">
              {isOpen ? "NEXT BATCH IN" : "WINDOW CLOSED"}
            </div>
            <div
              className={`text-4xl font-bold tabular-nums ${
                isOpen ? "text-terminal-green" : "text-terminal-amber"
              }`}
            >
              {remaining !== null ? formatCountdown(remaining) : "—"}
            </div>
          </div>

          {/* Progress bar */}
          <div className="flex-1">
            <div className="w-full h-2 bg-terminal-border rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  isOpen ? "bg-terminal-green" : "bg-terminal-amber"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-terminal-muted mt-1">
              <span>Window start</span>
              <span>Execution</span>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-[10px] tracking-widest text-terminal-muted mb-1">BEST SURPLUS</div>
            <div className="text-sm font-semibold text-terminal-green">
              {currentBestSurplus !== undefined
                ? formatTokenAmount(currentBestSurplus.toString(), borrowAsset?.decimals ?? 6, 2)
                : "—"}
              {borrowAsset && (
                <span className="text-terminal-muted text-xs ml-1">{borrowAsset.symbol}</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-[10px] tracking-widest text-terminal-muted mb-1">PAIRS MATCHED</div>
            <div className="text-sm font-semibold">{pairCount}</div>
          </div>
          <div>
            <div className="text-[10px] tracking-widest text-terminal-muted mb-1">CURRENT WINNER</div>
            <div className="text-sm">
              {currentWinner && currentWinner !== "0x0000000000000000000000000000000000000000"
                ? truncateAddress(currentWinner)
                : <span className="text-terminal-muted">None</span>}
            </div>
          </div>
        </div>

        {/* Winning pairs table */}
        {pairCount > 0 && (
          <div>
            <div className="text-[10px] tracking-widest text-terminal-muted mb-2 uppercase">Winning Pairs</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-terminal-border">
                  {["#", "Lend Order", "Borrow Order", "Amount"].map((h) => (
                    <th key={h} className="py-1.5 px-4 text-left text-terminal-muted font-normal text-[10px] uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: pairCount }).map((_, i) => (
                  <WinningPairRow key={i} index={i} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Current submissions ──────────────────────────────────────────────────

function CurrentSubmissionsTable() {
  const { submissions, isLoading } = useCurrentSubmissions();
  const { data: assets } = useAssets();
  const borrowAsset = assets?.borrowAssets[0];

  if (isLoading) {
    return (
      <div className="p-4 text-center text-terminal-muted text-xs">Scanning for submissions...</div>
    );
  }

  return (
    <div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-terminal-border">
            {["Solver", "Pairs", "Time", "Surplus", "Tx"].map((h) => (
              <th key={h} className="py-2 px-4 text-left text-terminal-muted font-normal text-[10px] uppercase">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {submissions.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-6 text-center text-terminal-muted">
                No submissions in current window
              </td>
            </tr>
          ) : (
            submissions.map((sub) => (
              <tr
                key={sub.txHash}
                className={`border-b border-terminal-border hover:bg-white/[0.02] text-xs ${!sub.success ? "opacity-50" : ""}`}
              >
                <td className="py-1.5 px-4">{truncateAddress(sub.solver)}</td>
                <td className="py-1.5 px-4">{sub.pairCount}</td>
                <td className="py-1.5 px-4 text-terminal-muted">{formatDateTime(sub.timestamp)}</td>
                <td className="py-1.5 px-4 tabular-nums">
                  {sub.success && sub.surplus !== null ? (
                    <span className="text-terminal-green">
                      {formatTokenAmount(sub.surplus.toString(), borrowAsset?.decimals ?? 6, 2)}
                      {borrowAsset && <span className="text-terminal-muted ml-1">{borrowAsset.symbol}</span>}
                    </span>
                  ) : (
                    <span className="text-terminal-red">Reverted</span>
                  )}
                </td>
                <td className="py-1.5 px-4">
                  <a
                    href={`https://testnet.monadexplorer.com/tx/${sub.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-terminal-muted hover:text-terminal-text transition-colors text-[10px]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {truncateAddress(sub.txHash, 6)} ↗
                  </a>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Batch history ─────────────────────────────────────────────────────────────

function BatchHistoryTable() {
  const { data: assets } = useAssets();
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useQuery({
    queryKey: ["batches", page],
    queryFn: () => fetchBatches({ page, limit: 20 }),
    refetchInterval: 10_000,
  });

  const borrowAsset = assets?.borrowAssets[0];

  if (isLoading) {
    return (
      <div className="p-4 text-center text-terminal-muted text-xs">Loading batch history...</div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-4 text-center text-terminal-red text-xs">
        Could not load batch history. Is the backend running?
      </div>
    );
  }

  const { batches, total, limit } = data;
  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-terminal-border">
            {["Window", "Executed At", "Solver", "Pairs", "Total Surplus", "Tx"].map((h) => (
              <th key={h} className="py-2 px-4 text-left text-terminal-muted font-normal text-[10px] uppercase">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {batches.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-6 text-center text-terminal-muted">
                No batch history yet
              </td>
            </tr>
          ) : (
            batches.map((batch) => (
              <BatchRow key={batch.windowId} batch={batch} borrowDecimals={borrowAsset?.decimals ?? 6} borrowSymbol={borrowAsset?.symbol ?? ""} />
            ))
          )}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-terminal-border text-xs">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="text-terminal-muted hover:text-terminal-text disabled:opacity-30 transition-colors"
          >
            ← Prev
          </button>
          <span className="text-terminal-muted">
            Page {page} / {totalPages} ({total} total)
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="text-terminal-muted hover:text-terminal-text disabled:opacity-30 transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

function BatchRow({
  batch,
  borrowDecimals,
  borrowSymbol,
}: {
  batch: Batch;
  borrowDecimals: number;
  borrowSymbol: string;
}) {
  const isEmpty = batch.pairCount === 0 || batch.solver === null;
  const expandable = !isEmpty;
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className={`border-b border-terminal-border hover:bg-white/[0.02] text-xs ${isEmpty ? "opacity-50" : ""} ${expandable ? "cursor-pointer" : ""}`}
        onClick={() => expandable && setExpanded((v) => !v)}
      >
        <td className="py-1.5 px-4 text-terminal-muted">
          {expandable && (
            <span className="inline-block w-3 mr-1 text-terminal-muted">{expanded ? "▼" : "▶"}</span>
          )}
          #{batch.windowId}
        </td>
        <td className="py-1.5 px-4 text-terminal-muted">{formatDateTime(batch.executedAt)}</td>
        <td className="py-1.5 px-4">
          {batch.solver ? truncateAddress(batch.solver) : <span className="text-terminal-muted">—</span>}
        </td>
        <td className="py-1.5 px-4">
          {isEmpty ? (
            <span className="text-terminal-muted">No matches</span>
          ) : (
            <span>{batch.pairCount}</span>
          )}
        </td>
        <td className="py-1.5 px-4 text-terminal-green tabular-nums">
          {isEmpty ? (
            <span className="text-terminal-muted">—</span>
          ) : (
            `${formatTokenAmount(batch.totalSurplus, borrowDecimals, 2)} ${borrowSymbol}`
          )}
        </td>
        <td className="py-1.5 px-4">
          <a
            href={`https://testnet.monadexplorer.com/tx/${batch.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-terminal-muted hover:text-terminal-text transition-colors text-[10px]"
            onClick={(e) => e.stopPropagation()}
          >
            {truncateAddress(batch.txHash, 6)} ↗
          </a>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} className="p-0">
            <BatchLoansPanel
              windowId={batch.windowId}
              borrowDecimals={borrowDecimals}
              borrowSymbol={borrowSymbol}
            />
          </td>
        </tr>
      )}
    </>
  );
}

const STATUS_COLORS: Record<string, string> = {
  active: "text-terminal-green",
  repaid: "text-blue-400",
  liquidated: "text-terminal-red",
  defaulted: "text-terminal-amber",
};

function BatchLoansPanel({
  windowId,
  borrowDecimals,
  borrowSymbol,
}: {
  windowId: string;
  borrowDecimals: number;
  borrowSymbol: string;
}) {
  const { data: loans, isLoading, error } = useQuery({
    queryKey: ["batchLoans", windowId],
    queryFn: () => fetchBatchLoans(windowId),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="pl-8 py-3 text-xs text-terminal-muted bg-white/[0.02]">
        Loading loans...
      </div>
    );
  }

  if (error || !loans) {
    return (
      <div className="pl-8 py-3 text-xs text-terminal-red bg-white/[0.02]">
        Failed to load loans
      </div>
    );
  }

  if (loans.length === 0) {
    return (
      <div className="pl-8 py-3 text-xs text-terminal-muted bg-white/[0.02]">
        No loans found
      </div>
    );
  }

  return (
    <div className="bg-white/[0.02] border-t border-terminal-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-terminal-border">
            {["Loan ID", "Lender", "Borrower", "Principal", "Rate", "Maturity", "Status"].map((h) => (
              <th key={h} className="py-1.5 px-4 text-left text-terminal-muted font-normal text-[10px] uppercase first:pl-8">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loans.map((loan) => (
            <tr key={loan.loanId} className="border-b border-terminal-border/50 hover:bg-white/[0.02]">
              <td className="py-1.5 px-4 pl-8">#{loan.loanId}</td>
              <td className="py-1.5 px-4">{truncateAddress(loan.lender)}</td>
              <td className="py-1.5 px-4">{truncateAddress(loan.borrower)}</td>
              <td className="py-1.5 px-4 tabular-nums">
                {formatTokenAmount(loan.principal, borrowDecimals, 2)} {borrowSymbol}
              </td>
              <td className="py-1.5 px-4">{formatRate(loan.rate)}</td>
              <td className="py-1.5 px-4 text-terminal-muted">
                {timeRemaining(loan.maturityDate)}
              </td>
              <td className="py-1.5 px-4">
                <span className={STATUS_COLORS[loan.status] ?? "text-terminal-muted"}>
                  {loan.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BatchPage() {
  return (
    <div className="overflow-auto h-[calc(100vh-40px)]">
      <div className="max-w-5xl mx-auto p-4 flex flex-col gap-4">
        <h1 className="text-xs font-semibold tracking-widest text-terminal-text">
          BATCH AUCTION
        </h1>

        <CurrentWindowPanel />

        <div className="border border-terminal-border bg-terminal-panel">
          <div className="px-4 py-2 border-b border-terminal-border">
            <span className="text-xs font-semibold tracking-widest text-terminal-text">CURRENT SUBMISSIONS</span>
          </div>
          <CurrentSubmissionsTable />
        </div>

        <div className="border border-terminal-border bg-terminal-panel">
          <div className="px-4 py-2 border-b border-terminal-border">
            <span className="text-xs font-semibold tracking-widest text-terminal-text">BATCH HISTORY</span>
          </div>
          <BatchHistoryTable />
        </div>
      </div>
    </div>
  );
}
