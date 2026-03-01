"use client";

import { useEffect, useRef } from "react";
import {
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
  useAccount,
} from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { CONTRACT_ADDRESS, CONTRACT_ABI, ERC20_ABI, BASIS_POINTS } from "@/lib/contract";
import { fetchLoan } from "@/lib/api";
import { useAssets } from "@/hooks/useAssets";
import {
  formatRate,
  formatLtv,
  formatDate,
  formatDateTime,
  timeRemaining,
  timeElapsed,
  truncateAddress,
  formatTokenAmount,
  formatHealthFactor,
  healthColor,
} from "@/lib/format";
import type { Loan } from "@/types";

interface Props {
  loanId: string;
  onClose: () => void;
}

const STATUS_CLASSES: Record<string, string> = {
  active: "text-terminal-green border-terminal-green",
  repaid: "text-terminal-blue border-terminal-blue",
  liquidated: "text-terminal-red border-terminal-red",
  defaulted: "text-terminal-amber border-terminal-amber",
};

function HealthBar({ healthFactor }: { healthFactor: bigint }) {
  const color = healthColor(healthFactor);
  const maxHf = 2n ** 256n - 1n;
  let pct = 100;
  if (healthFactor !== maxHf) {
    pct = Math.min(100, Math.max(0, Number((healthFactor * 100n) / 20000n)));
  }

  return (
    <div className="w-full h-1.5 bg-terminal-border rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${
          color === "green"
            ? "bg-terminal-green"
            : color === "amber"
            ? "bg-terminal-amber"
            : "bg-terminal-red"
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function LoanDetailModal({ loanId, onClose }: Props) {
  const { address } = useAccount();
  const { data: assets } = useAssets();
  const overlayRef = useRef<HTMLDivElement>(null);

  // Fetch loan from backend (status + events)
  const { data: loanDetail, isLoading: isLoanLoading } = useQuery({
    queryKey: ["loan", loanId],
    queryFn: () => fetchLoan(loanId),
    refetchInterval: 10_000,
  });

  // Fetch on-chain loan data (collateral, health)
  const { data: contractData } = useReadContracts({
    contracts: [
      {
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "getLoan",
        args: [BigInt(loanId)],
      },
      {
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "getHealthFactor",
        args: [BigInt(loanId)],
      },
      {
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "getAccruedInterest",
        args: [BigInt(loanId)],
      },
    ],
    query: { refetchInterval: 10_000 },
  });

  const onChainLoan = contractData?.[0]?.result as
    | {
        lender: `0x${string}`;
        borrower: `0x${string}`;
        borrowAsset: `0x${string}`;
        collateralAssets: readonly `0x${string}`[];
        collateralAmounts: readonly bigint[];
        principal: bigint;
        rate: bigint;
        ltv: bigint;
        lltv: bigint;
        duration: bigint;
        originationDate: bigint;
        maturityDate: bigint;
        status: number;
      }
    | undefined;
  const healthFactor = contractData?.[1]?.result as bigint | undefined;
  const accruedInterest = contractData?.[2]?.result as bigint | undefined;

  // Write: repay
  const { writeContract, data: repayHash, isPending: isRepayPending, reset: resetRepay } = useWriteContract();
  const { isLoading: isRepayLoading, isSuccess: isRepaySuccess } = useWaitForTransactionReceipt({
    hash: repayHash,
  });

  const loan = loanDetail?.loan;
  const events = loanDetail?.events ?? [];

  const borrowAssetInfo = assets?.borrowAssets.find(
    (a) => a.address.toLowerCase() === loan?.borrowAsset.toLowerCase()
  );
  const dec = borrowAssetInfo?.decimals ?? 6;

  const isBorrower =
    address && onChainLoan && address.toLowerCase() === onChainLoan.borrower.toLowerCase();
  const isActive = loan?.status === "active";

  const totalDue =
    onChainLoan && accruedInterest !== undefined
      ? onChainLoan.principal + accruedInterest
      : undefined;

  function handleRepay() {
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: "repay",
      args: [BigInt(loanId)],
    });
  }

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose();
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 animate-fade-in"
    >
      <div className="bg-terminal-panel border border-terminal-border w-full max-w-xl max-h-[90vh] overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-terminal-border">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold tracking-widest">LOAN #{loanId}</span>
            {loan && (
              <span
                className={`text-[10px] border px-1.5 py-0.5 uppercase tracking-wider ${
                  STATUS_CLASSES[loan.status] ?? "text-terminal-muted border-terminal-muted"
                }`}
              >
                {loan.status}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-terminal-muted hover:text-terminal-text transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>

        {isLoanLoading ? (
          <div className="p-6 text-center text-terminal-muted text-xs">Loading...</div>
        ) : !loan ? (
          <div className="p-6 text-center text-terminal-red text-xs">Loan not found</div>
        ) : (
          <div className="p-4 flex flex-col gap-4">
            {/* Parties */}
            <section>
              <div className="text-[10px] tracking-widest text-terminal-muted mb-2 uppercase">Parties</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-terminal-muted text-[10px]">Lender</div>
                  <div className="font-mono">{truncateAddress(loan.lender, 8)}</div>
                </div>
                <div>
                  <div className="text-terminal-muted text-[10px]">Borrower</div>
                  <div className="font-mono">{truncateAddress(loan.borrower, 8)}</div>
                </div>
              </div>
            </section>

            {/* Loan terms */}
            <section>
              <div className="text-[10px] tracking-widest text-terminal-muted mb-2 uppercase">Terms</div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-terminal-muted text-[10px]">Principal</div>
                  <div>{formatTokenAmount(loan.principal, dec)} {borrowAssetInfo?.symbol ?? ""}</div>
                </div>
                <div>
                  <div className="text-terminal-muted text-[10px]">Rate</div>
                  <div>{formatRate(loan.rate)}</div>
                  <div className="text-terminal-muted text-[10px]">{loan.rate} bps</div>
                </div>
                <div>
                  <div className="text-terminal-muted text-[10px]">LTV / LLTV</div>
                  <div>{formatLtv(loan.ltv)} / {formatLtv(loan.lltv)}</div>
                </div>
                <div>
                  <div className="text-terminal-muted text-[10px]">Originated</div>
                  <div>{formatDate(loan.originationDate)}</div>
                </div>
                <div>
                  <div className="text-terminal-muted text-[10px]">Matures</div>
                  <div>{formatDate(loan.maturityDate)}</div>
                </div>
                <div>
                  <div className="text-terminal-muted text-[10px]">
                    {isActive ? "Time remaining" : "Duration"}
                  </div>
                  <div
                    className={
                      isActive && loan.maturityDate < Math.floor(Date.now() / 1000)
                        ? "text-terminal-red"
                        : ""
                    }
                  >
                    {isActive ? timeRemaining(loan.maturityDate) : timeElapsed(loan.originationDate)}
                  </div>
                </div>
              </div>
            </section>

            {/* Accrued interest */}
            {isActive && accruedInterest !== undefined && (
              <section>
                <div className="text-[10px] tracking-widest text-terminal-muted mb-2 uppercase">Interest Accrued</div>
                <div className="flex justify-between text-xs">
                  <span>
                    {formatTokenAmount(accruedInterest.toString(), dec, 4)} {borrowAssetInfo?.symbol ?? ""}
                  </span>
                  {totalDue !== undefined && (
                    <span className="text-terminal-muted">
                      Total due: {formatTokenAmount(totalDue.toString(), dec)} {borrowAssetInfo?.symbol ?? ""}
                    </span>
                  )}
                </div>
              </section>
            )}

            {/* Collateral health */}
            {onChainLoan && healthFactor !== undefined && (
              <section>
                <div className="text-[10px] tracking-widest text-terminal-muted mb-2 uppercase">
                  Collateral Health
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs">Health Factor</span>
                  <span
                    className={`text-sm font-semibold ${
                      healthColor(healthFactor) === "green"
                        ? "text-terminal-green"
                        : healthColor(healthFactor) === "amber"
                        ? "text-terminal-amber"
                        : "text-terminal-red"
                    }`}
                  >
                    {formatHealthFactor(healthFactor)}
                  </span>
                </div>
                <HealthBar healthFactor={healthFactor} />
                <div className="text-[10px] text-terminal-muted mt-1">
                  Liquidation threshold at 1.00 (LLTV {formatLtv(Number(onChainLoan.lltv))})
                </div>

                {/* Per-asset breakdown */}
                {onChainLoan.collateralAssets.length > 0 && (
                  <div className="mt-3 flex flex-col gap-1">
                    {onChainLoan.collateralAssets.map((addr, i) => {
                      const colAsset = assets?.collateralAssets.find(
                        (a) => a.address.toLowerCase() === addr.toLowerCase()
                      );
                      return (
                        <div key={addr} className="flex justify-between text-xs">
                          <span className="text-terminal-muted">{colAsset?.symbol ?? truncateAddress(addr)}</span>
                          <span>
                            {formatTokenAmount(
                              onChainLoan.collateralAmounts[i].toString(),
                              colAsset?.decimals ?? 18,
                              4
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* Event history */}
            {events.length > 0 && (
              <section>
                <div className="text-[10px] tracking-widest text-terminal-muted mb-2 uppercase">Events</div>
                <div className="flex flex-col gap-1">
                  {events.map((evt, i) => (
                    <div key={i} className="flex justify-between text-xs border-b border-terminal-border py-1">
                      <span
                        className={
                          evt.eventType === "liquidated"
                            ? "text-terminal-red"
                            : evt.eventType === "defaulted"
                            ? "text-terminal-amber"
                            : "text-terminal-blue"
                        }
                      >
                        {evt.eventType.toUpperCase()}
                      </span>
                      <span className="text-terminal-muted">{formatDateTime(evt.blockTime)}</span>
                      {evt.liquidator && (
                        <span className="text-terminal-muted">{truncateAddress(evt.liquidator)}</span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Actions */}
            <section className="flex flex-col gap-2">
              {isBorrower && isActive && (
                <div>
                  {isRepaySuccess ? (
                    <div className="text-terminal-green text-xs text-center py-2">✓ Loan repaid</div>
                  ) : (
                    <button
                      onClick={handleRepay}
                      disabled={isRepayPending || isRepayLoading}
                      className="w-full py-2 bg-terminal-green text-black text-xs font-bold tracking-wider hover:bg-green-400 disabled:opacity-50 transition-colors"
                    >
                      {isRepayPending || isRepayLoading
                        ? "Repaying..."
                        : totalDue !== undefined
                        ? `Repay ${formatTokenAmount(totalDue.toString(), dec)} ${borrowAssetInfo?.symbol ?? ""}`
                        : "Repay Loan"}
                    </button>
                  )}
                </div>
              )}
              <a
                href={`https://testnet.monadexplorer.com/tx/${loan.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-1.5 border border-terminal-border text-terminal-muted text-xs text-center hover:border-terminal-muted hover:text-terminal-text transition-colors"
              >
                View on Explorer ↗
              </a>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
