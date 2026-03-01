"use client";

import { useState } from "react";
import Link from "next/link";
import { useReadContract } from "wagmi";
import { useMyPositions } from "@/hooks/usePositions";
import { useAssets } from "@/hooks/useAssets";
import { CONTRACT_ADDRESS, CONTRACT_ABI } from "@/lib/contract";
import { LoanDetailModal } from "./LoanDetailModal";
import type { LendOrder, BorrowOrder, Loan } from "@/types";
import {
  formatRate,
  formatTokenAmount,
  fillPercent,
  timeRemaining,
  formatDate,
  healthColor,
  formatHealthFactor,
} from "@/lib/format";

// ── Health indicator ──────────────────────────────────────────────────────────

function HealthIndicator({ loanId }: { loanId: string }) {
  const { data: hf } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getHealthFactor",
    args: [BigInt(loanId)],
    query: { refetchInterval: 1_000 },
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

// ── Lend order row ────────────────────────────────────────────────────────────

function LendOrderRow({ order, assets }: { order: LendOrder; assets: ReturnType<typeof useAssets>["data"] }) {
  const borrowAsset = assets?.borrowAssets.find(
    (a) => a.address.toLowerCase() === order.borrowAsset.toLowerCase()
  );
  const pct = fillPercent(order.filledAmount, order.amount);

  return (
    <tr className="border-b border-terminal-border text-xs hover:bg-white/[0.02]">
      <td className="py-1 px-2 text-terminal-muted">#{order.orderId}</td>
      <td className="py-1 px-2">
        {formatTokenAmount(order.amount, borrowAsset?.decimals ?? 6, 0)} {borrowAsset?.symbol}
      </td>
      <td className="py-1 px-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 bg-terminal-border rounded-full overflow-hidden w-16">
            <div
              className="h-full bg-terminal-green"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-terminal-muted text-[10px] tabular-nums">{pct.toFixed(0)}%</span>
        </div>
      </td>
      <td className="py-1 px-2 text-terminal-green">{formatRate(order.minRate)}</td>
      <td className="py-1 px-2">
        <span
          className={`text-[10px] px-1 py-0.5 ${
            order.status === "open"
              ? "text-terminal-green"
              : "text-terminal-muted"
          }`}
        >
          {order.status.toUpperCase()}
        </span>
      </td>
    </tr>
  );
}

// ── Borrow order row ──────────────────────────────────────────────────────────

function BorrowOrderRow({ order, assets }: { order: BorrowOrder; assets: ReturnType<typeof useAssets>["data"] }) {
  const borrowAsset = assets?.borrowAssets.find(
    (a) => a.address.toLowerCase() === order.borrowAsset.toLowerCase()
  );
  const pct = fillPercent(order.filledAmount, order.amount);

  return (
    <tr className="border-b border-terminal-border text-xs hover:bg-white/[0.02]">
      <td className="py-1 px-2 text-terminal-muted">#{order.orderId}</td>
      <td className="py-1 px-2">
        {formatTokenAmount(order.amount, borrowAsset?.decimals ?? 6, 0)} {borrowAsset?.symbol}
      </td>
      <td className="py-1 px-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 bg-terminal-border rounded-full overflow-hidden w-16">
            <div
              className="h-full bg-terminal-amber"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-terminal-muted text-[10px] tabular-nums">{pct.toFixed(0)}%</span>
        </div>
      </td>
      <td className="py-1 px-2 text-terminal-amber">{formatRate(order.maxRate)}</td>
      <td className="py-1 px-2">
        <span
          className={`text-[10px] px-1 py-0.5 ${
            order.status === "open"
              ? "text-terminal-amber"
              : "text-terminal-muted"
          }`}
        >
          {order.status.toUpperCase()}
          {order.fillOrKill && " FOK"}
        </span>
      </td>
    </tr>
  );
}

// ── Active loan row ───────────────────────────────────────────────────────────

function LoanRow({
  loan,
  assets,
  onSelect,
  showHealth,
}: {
  loan: Loan;
  assets: ReturnType<typeof useAssets>["data"];
  onSelect: () => void;
  showHealth?: boolean;
}) {
  const borrowAsset = assets?.borrowAssets.find(
    (a) => a.address.toLowerCase() === loan.borrowAsset.toLowerCase()
  );
  const statusClass: Record<string, string> = {
    active: "text-terminal-green",
    repaid: "text-terminal-blue",
    liquidated: "text-terminal-red",
    defaulted: "text-terminal-amber",
  };

  return (
    <tr
      className="border-b border-terminal-border text-xs hover:bg-white/[0.02] cursor-pointer"
      onClick={onSelect}
    >
      <td className="py-1 px-2 text-terminal-muted">#{loan.loanId}</td>
      <td className="py-1 px-2">
        {formatTokenAmount(loan.principal, borrowAsset?.decimals ?? 6, 0)} {borrowAsset?.symbol}
      </td>
      <td className="py-1 px-2">{formatRate(loan.rate)}</td>
      <td className="py-1 px-2 text-terminal-muted">
        {loan.status === "active" ? timeRemaining(loan.maturityDate) : formatDate(loan.maturityDate)}
      </td>
      {showHealth && (
        <td className="py-1 px-2">
          {loan.status === "active" ? (
            <HealthIndicator loanId={loan.loanId} />
          ) : (
            <span className={statusClass[loan.status] ?? "text-terminal-muted"}>
              {loan.status.toUpperCase()}
            </span>
          )}
        </td>
      )}
      {!showHealth && (
        <td className="py-1 px-2">
          <span className={statusClass[loan.status] ?? "text-terminal-muted"}>
            {loan.status.toUpperCase()}
          </span>
        </td>
      )}
    </tr>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

function Section({
  title,
  color,
  children,
}: {
  title: string;
  color: "green" | "amber";
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className={`text-[10px] tracking-widest font-semibold px-3 py-1.5 border-b border-terminal-border ${
          color === "green" ? "text-terminal-green" : "text-terminal-amber"
        }`}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MyPositions() {
  const { lendOrders, borrowOrders, lenderLoans, borrowerLoans, address } = useMyPositions();
  const { data: assets } = useAssets();
  const [selectedLoan, setSelectedLoan] = useState<string | null>(null);

  if (!address) {
    return (
      <div className="flex flex-col h-full bg-terminal-panel border border-terminal-border">
        <div className="px-3 py-2 border-b border-terminal-border shrink-0">
          <span className="text-xs font-semibold tracking-widest text-terminal-text">MY POSITIONS</span>
        </div>
        <div className="flex-1 flex items-center justify-center text-terminal-muted text-xs">
          Connect wallet to view positions
        </div>
      </div>
    );
  }

  const openLendOrders = (lendOrders.data ?? []).filter((o) => o.status === "open");
  const openBorrowOrders = (borrowOrders.data ?? []).filter((o) => o.status === "open");
  const activeLenderLoans = (lenderLoans.data ?? []).filter((l) => l.status === "active");
  const activeBorrowerLoans = (borrowerLoans.data ?? []).filter((l) => l.status === "active");

  return (
    <>
      <div className="flex flex-col h-full bg-terminal-panel border border-terminal-border overflow-auto">
        <div className="flex items-center justify-between px-3 py-2 border-b border-terminal-border shrink-0">
          <span className="text-xs font-semibold tracking-widest text-terminal-text">MY POSITIONS</span>
          <Link href="/positions" className="text-[10px] text-terminal-muted hover:text-terminal-text transition-colors">
            Full View →
          </Link>
        </div>

        {/* Lend side */}
        <Section title={`LEND (${openLendOrders.length} orders · ${activeLenderLoans.length} loans)`} color="green">
          {openLendOrders.length > 0 && (
            <table className="w-full text-xs mb-1">
              <thead>
                <tr className="border-b border-terminal-border">
                  {["ID", "Amount", "Fill", "Rate", "Status"].map((h) => (
                    <th key={h} className="py-1 px-2 text-left text-terminal-muted font-normal text-[10px] uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {openLendOrders.map((o) => (
                  <LendOrderRow key={o.orderId} order={o} assets={assets} />
                ))}
              </tbody>
            </table>
          )}
          {activeLenderLoans.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-terminal-border">
                  {["ID", "Principal", "Rate", "Matures", "Status"].map((h) => (
                    <th key={h} className="py-1 px-2 text-left text-terminal-muted font-normal text-[10px] uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeLenderLoans.map((l) => (
                  <LoanRow
                    key={l.loanId}
                    loan={l}
                    assets={assets}
                    onSelect={() => setSelectedLoan(l.loanId)}
                  />
                ))}
              </tbody>
            </table>
          )}
          {openLendOrders.length === 0 && activeLenderLoans.length === 0 && (
            <div className="py-3 px-3 text-terminal-muted text-xs">No open lend positions</div>
          )}
        </Section>

        {/* Borrow side */}
        <Section title={`BORROW (${openBorrowOrders.length} orders · ${activeBorrowerLoans.length} loans)`} color="amber">
          {openBorrowOrders.length > 0 && (
            <table className="w-full text-xs mb-1">
              <thead>
                <tr className="border-b border-terminal-border">
                  {["ID", "Amount", "Fill", "Rate", "Status"].map((h) => (
                    <th key={h} className="py-1 px-2 text-left text-terminal-muted font-normal text-[10px] uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {openBorrowOrders.map((o) => (
                  <BorrowOrderRow key={o.orderId} order={o} assets={assets} />
                ))}
              </tbody>
            </table>
          )}
          {activeBorrowerLoans.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-terminal-border">
                  {["ID", "Principal", "Rate", "Matures", "Health"].map((h) => (
                    <th key={h} className="py-1 px-2 text-left text-terminal-muted font-normal text-[10px] uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeBorrowerLoans.map((l) => (
                  <LoanRow
                    key={l.loanId}
                    loan={l}
                    assets={assets}
                    onSelect={() => setSelectedLoan(l.loanId)}
                    showHealth
                  />
                ))}
              </tbody>
            </table>
          )}
          {openBorrowOrders.length === 0 && activeBorrowerLoans.length === 0 && (
            <div className="py-3 px-3 text-terminal-muted text-xs">No open borrow positions</div>
          )}
        </Section>
      </div>

      {selectedLoan && (
        <LoanDetailModal loanId={selectedLoan} onClose={() => setSelectedLoan(null)} />
      )}
    </>
  );
}
