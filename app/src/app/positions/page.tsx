"use client";

import { useState } from "react";
import { useMyPositions } from "@/hooks/usePositions";
import { useAssets } from "@/hooks/useAssets";
import { LoanDetailModal } from "@/components/positions/LoanDetailModal";
import { PrivatePositions } from "@/components/positions/PrivatePositions";
import { useWalletMode } from "@/lib/walletMode";
import type { LendOrder, BorrowOrder, Loan } from "@/types";
import {
  formatRate,
  formatLtv,
  formatDuration,
  formatTokenAmount,
  formatDate,
  fillPercent,
  truncateAddress,
  timeRemaining,
  formatHealthFactor,
  healthColor,
} from "@/lib/format";
import { useReadContract, useAccount } from "wagmi";
import { CONTRACT_ADDRESS, CONTRACT_ABI } from "@/lib/contract";

// ── Health cell ───────────────────────────────────────────────────────────────

function HealthCell({ loanId }: { loanId: string }) {
  const { data: hf } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getHealthFactor",
    args: [BigInt(loanId)],
    query: { refetchInterval: 10_000 },
  });

  if (hf === undefined) return <span className="text-terminal-muted">—</span>;
  const color = healthColor(hf as bigint);
  return (
    <span
      className={
        color === "green"
          ? "text-terminal-green"
          : color === "amber"
          ? "text-terminal-amber"
          : "text-terminal-red"
      }
    >
      {formatHealthFactor(hf as bigint)}
    </span>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ title, color }: { title: string; color: "green" | "amber" }) {
  return (
    <div
      className={`text-xs font-semibold tracking-widest py-2 px-4 border-b border-terminal-border ${
        color === "green" ? "text-terminal-green" : "text-terminal-amber"
      }`}
    >
      {title}
    </div>
  );
}

// ── Sub-section header ────────────────────────────────────────────────────────

function SubHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center justify-between px-4 py-1.5 border-b border-terminal-border bg-black/20">
      <span className="text-[10px] tracking-widest text-terminal-muted uppercase">{title}</span>
      <span className="text-[10px] text-terminal-muted">{count}</span>
    </div>
  );
}

// ── Lend orders table ─────────────────────────────────────────────────────────

function LendOrdersTable({ orders }: { orders: LendOrder[] }) {
  const { data: assets } = useAssets();
  if (orders.length === 0) {
    return <div className="px-4 py-3 text-xs text-terminal-muted">No orders</div>;
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-terminal-border">
          {["ID", "Asset", "Amount", "Fill", "Min Rate", "Max LTV", "Max LLTV", "Max Dur", "Status"].map((h) => (
            <th key={h} className="py-1.5 px-4 text-left text-terminal-muted font-normal text-[10px] uppercase">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => {
          const ba = assets?.borrowAssets.find((a) => a.address.toLowerCase() === o.borrowAsset.toLowerCase());
          const pct = fillPercent(o.filledAmount, o.amount);
          return (
            <tr key={o.orderId} className="border-b border-terminal-border hover:bg-white/[0.02]">
              <td className="py-1.5 px-4 text-terminal-muted">#{o.orderId}</td>
              <td className="py-1.5 px-4">{ba?.symbol ?? "?"}</td>
              <td className="py-1.5 px-4 tabular-nums">
                {formatTokenAmount(o.amount, ba?.decimals ?? 6, 0)}
              </td>
              <td className="py-1.5 px-4">
                <div className="flex items-center gap-2">
                  <div className="w-16 h-1 bg-terminal-border rounded-full overflow-hidden">
                    <div className="h-full bg-terminal-green" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-terminal-muted text-[10px]">{pct.toFixed(0)}%</span>
                </div>
              </td>
              <td className="py-1.5 px-4 text-terminal-green">{formatRate(o.minRate)}</td>
              <td className="py-1.5 px-4 text-terminal-muted">{formatLtv(o.maxLtv)}</td>
              <td className="py-1.5 px-4 text-terminal-muted">{formatLtv(o.maxLltv)}</td>
              <td className="py-1.5 px-4 text-terminal-muted">{formatDuration(o.maxDuration)}</td>
              <td className="py-1.5 px-4">
                <span className={o.status === "open" ? "text-terminal-green" : "text-terminal-muted"}>
                  {o.status.toUpperCase()}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Borrow orders table ───────────────────────────────────────────────────────

function BorrowOrdersTable({ orders }: { orders: BorrowOrder[] }) {
  const { data: assets } = useAssets();
  if (orders.length === 0) {
    return <div className="px-4 py-3 text-xs text-terminal-muted">No orders</div>;
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-terminal-border">
          {["ID", "Asset", "Amount", "Fill", "Max Rate", "Min LTV", "Min LLTV", "Min Dur", "FOK", "Status"].map((h) => (
            <th key={h} className="py-1.5 px-4 text-left text-terminal-muted font-normal text-[10px] uppercase">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => {
          const ba = assets?.borrowAssets.find((a) => a.address.toLowerCase() === o.borrowAsset.toLowerCase());
          const pct = fillPercent(o.filledAmount, o.amount);
          return (
            <tr key={o.orderId} className="border-b border-terminal-border hover:bg-white/[0.02]">
              <td className="py-1.5 px-4 text-terminal-muted">#{o.orderId}</td>
              <td className="py-1.5 px-4">{ba?.symbol ?? "?"}</td>
              <td className="py-1.5 px-4 tabular-nums">
                {formatTokenAmount(o.amount, ba?.decimals ?? 6, 0)}
              </td>
              <td className="py-1.5 px-4">
                <div className="flex items-center gap-2">
                  <div className="w-16 h-1 bg-terminal-border rounded-full overflow-hidden">
                    <div className="h-full bg-terminal-amber" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-terminal-muted text-[10px]">{pct.toFixed(0)}%</span>
                </div>
              </td>
              <td className="py-1.5 px-4 text-terminal-amber">{formatRate(o.maxRate)}</td>
              <td className="py-1.5 px-4 text-terminal-muted">{formatLtv(o.minLtv)}</td>
              <td className="py-1.5 px-4 text-terminal-muted">{formatLtv(o.minLltv)}</td>
              <td className="py-1.5 px-4 text-terminal-muted">{formatDuration(o.minDuration)}</td>
              <td className="py-1.5 px-4 text-terminal-muted">{o.fillOrKill ? "Yes" : "No"}</td>
              <td className="py-1.5 px-4">
                <span className={o.status === "open" ? "text-terminal-amber" : "text-terminal-muted"}>
                  {o.status.toUpperCase()}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Loans table ───────────────────────────────────────────────────────────────

function LoansTable({
  loans,
  showHealth,
  onSelect,
}: {
  loans: Loan[];
  showHealth?: boolean;
  onSelect: (id: string) => void;
}) {
  const { data: assets } = useAssets();
  if (loans.length === 0) {
    return <div className="px-4 py-3 text-xs text-terminal-muted">No loans</div>;
  }

  const statusColor: Record<string, string> = {
    active: "text-terminal-green",
    repaid: "text-terminal-blue",
    liquidated: "text-terminal-red",
    defaulted: "text-terminal-amber",
  };

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-terminal-border">
          {["ID", "Asset", "Principal", "Rate", "LTV/LLTV", "Originated", "Matures", showHealth ? "Health" : "Status"].map((h) => (
            <th key={h} className="py-1.5 px-4 text-left text-terminal-muted font-normal text-[10px] uppercase">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {loans.map((l) => {
          const ba = assets?.borrowAssets.find((a) => a.address.toLowerCase() === l.borrowAsset.toLowerCase());
          return (
            <tr
              key={l.loanId}
              className="border-b border-terminal-border hover:bg-white/[0.02] cursor-pointer"
              onClick={() => onSelect(l.loanId)}
            >
              <td className="py-1.5 px-4 text-terminal-muted">#{l.loanId}</td>
              <td className="py-1.5 px-4">{ba?.symbol ?? "?"}</td>
              <td className="py-1.5 px-4 tabular-nums">
                {formatTokenAmount(l.principal, ba?.decimals ?? 6, 0)}
              </td>
              <td className="py-1.5 px-4">{formatRate(l.rate)}</td>
              <td className="py-1.5 px-4 text-terminal-muted">
                {formatLtv(l.ltv)}/{formatLtv(l.lltv)}
              </td>
              <td className="py-1.5 px-4 text-terminal-muted">{formatDate(l.originationDate)}</td>
              <td className="py-1.5 px-4 text-terminal-muted">
                {l.status === "active" ? timeRemaining(l.maturityDate) : formatDate(l.maturityDate)}
              </td>
              <td className="py-1.5 px-4">
                {showHealth && l.status === "active" ? (
                  <HealthCell loanId={l.loanId} />
                ) : (
                  <span className={statusColor[l.status] ?? "text-terminal-muted"}>
                    {l.status.toUpperCase()}
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── History table (collapsed by default) ─────────────────────────────────────

function HistorySection({ loans, onSelect }: { loans: Loan[]; onSelect: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  if (loans.length === 0) return null;
  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2 border-b border-terminal-border text-[10px] tracking-widest text-terminal-muted hover:text-terminal-text transition-colors"
      >
        <span>HISTORY ({loans.length})</span>
        <span>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && <LoansTable loans={loans} onSelect={onSelect} />}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PositionsPage() {
  const { mode } = useWalletMode();
  const { address } = useAccount();
  const { lendOrders, borrowOrders, lenderLoans, borrowerLoans } = useMyPositions();
  const [selectedLoan, setSelectedLoan] = useState<string | null>(null);

  const allLenderLoans = lenderLoans.data ?? [];
  const activeLenderLoans = allLenderLoans.filter((l) => l.status === "active");
  const historyLenderLoans = allLenderLoans.filter((l) => l.status !== "active");

  const allBorrowerLoans = borrowerLoans.data ?? [];
  const activeBorrowerLoans = allBorrowerLoans.filter((l) => l.status === "active");
  const historyBorrowerLoans = allBorrowerLoans.filter((l) => l.status !== "active");

  if (!address) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-40px)] text-terminal-muted text-sm">
        Connect wallet to view positions
      </div>
    );
  }

  if (mode === "private") {
    return (
      <div className="overflow-auto h-[calc(100vh-40px)]">
        <div className="max-w-7xl mx-auto p-4 flex flex-col gap-4">
          <PrivatePositions />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-auto h-[calc(100vh-40px)]">
        <div className="max-w-7xl mx-auto p-4 flex flex-col gap-4">
          {/* Lender section */}
          <div className="border border-terminal-border bg-terminal-panel">
            <SectionHeader title="LENDER POSITIONS" color="green" />
            <SubHeader
              title="Pending Orders"
              count={(lendOrders.data ?? []).length}
            />
            <LendOrdersTable orders={lendOrders.data ?? []} />
            <SubHeader title="Active Loans" count={activeLenderLoans.length} />
            <LoansTable loans={activeLenderLoans} onSelect={setSelectedLoan} />
            <HistorySection loans={historyLenderLoans} onSelect={setSelectedLoan} />
          </div>

          {/* Borrower section */}
          <div className="border border-terminal-border bg-terminal-panel">
            <SectionHeader title="BORROWER POSITIONS" color="amber" />
            <SubHeader
              title="Pending Orders"
              count={(borrowOrders.data ?? []).length}
            />
            <BorrowOrdersTable orders={borrowOrders.data ?? []} />
            <SubHeader title="Active Loans" count={activeBorrowerLoans.length} />
            <LoansTable loans={activeBorrowerLoans} showHealth onSelect={setSelectedLoan} />
            <HistorySection loans={historyBorrowerLoans} onSelect={setSelectedLoan} />
          </div>
        </div>
      </div>

      {selectedLoan && (
        <LoanDetailModal loanId={selectedLoan} onClose={() => setSelectedLoan(null)} />
      )}
    </>
  );
}
