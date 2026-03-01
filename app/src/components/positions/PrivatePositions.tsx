"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useUnlink } from "@unlink-xyz/react";
import { usePrivatePositions } from "@/hooks/usePrivatePositions";
import { useAssets } from "@/hooks/useAssets";
import { CONTRACT_ADDRESS, CONTRACT_ABI, ERC20_ABI } from "@/lib/contract";
import { encodeBurnerCall, waitForBurnerTx, publicClient } from "@/lib/burnerClient";
import {
  formatRate,
  formatTokenAmount,
  fillPercent,
  timeRemaining,
  truncateAddress,
} from "@/lib/format";
import type { LendOrder, BorrowOrder, Loan } from "@/types";

// ── Sweep button ──────────────────────────────────────────────────────────────

function SweepButton({
  burnerIndex,
  burnerAddress,
  token,
  decimals,
  symbol,
}: {
  burnerIndex: number;
  burnerAddress: string;
  token: string;
  decimals: number;
  symbol: string;
}) {
  const { burnerGetTokenBalance, burnerSweepToPool } = useUnlink();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [done, setDone] = useState(false);

  async function loadBalance() {
    const b = await burnerGetTokenBalance(burnerAddress, token);
    setBalance(b);
  }

  async function handleSweep() {
    if (!balance || balance === 0n) return;
    setSweeping(true);
    try {
      await burnerSweepToPool(burnerIndex, { token, amount: balance });
      setDone(true);
    } finally {
      setSweeping(false);
    }
  }

  if (done) return <span className="text-terminal-green text-[10px]">Swept</span>;

  if (balance === null) {
    return (
      <button
        onClick={loadBalance}
        className="text-[10px] text-terminal-muted hover:text-terminal-text transition-colors"
      >
        Check balance
      </button>
    );
  }

  if (balance === 0n) {
    return <span className="text-[10px] text-terminal-muted">No balance</span>;
  }

  return (
    <button
      onClick={handleSweep}
      disabled={sweeping}
      className="text-[10px] text-terminal-green border border-terminal-green px-1.5 py-0.5 hover:bg-terminal-green hover:text-black transition-colors disabled:opacity-50"
    >
      {sweeping
        ? "Sweeping..."
        : `Sweep ${formatTokenAmount(balance.toString(), decimals, 2)} ${symbol}`}
    </button>
  );
}

// ── Private repay button ──────────────────────────────────────────────────────

function PrivateRepayButton({
  burnerIndex,
  loan,
  decimals,
}: {
  burnerIndex: number;
  loan: Loan;
  decimals: number;
}) {
  const { burnerSend } = useUnlink();
  const [step, setStep] = useState<"idle" | "approving" | "repaying" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleRepay() {
    setError(null);
    try {
      // Compute total due from on-chain
      const interest = await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "getAccruedInterest",
        args: [BigInt(loan.loanId)],
      }) as bigint;
      const repayAmount = BigInt(loan.principal) + interest;

      // Step 1: approve
      setStep("approving");
      const { txHash: approveTx } = await burnerSend(
        burnerIndex,
        encodeBurnerCall({
          address: loan.borrowAsset as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [CONTRACT_ADDRESS, repayAmount],
        })
      );
      await waitForBurnerTx(approveTx);

      // Step 2: repay
      setStep("repaying");
      const { txHash: repayTx } = await burnerSend(
        burnerIndex,
        encodeBurnerCall({
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI,
          functionName: "repay",
          args: [BigInt(loan.loanId)],
        })
      );
      await waitForBurnerTx(repayTx);

      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Repay failed");
      setStep("idle");
    }
  }

  if (step === "done") return <span className="text-terminal-green text-[10px]">Repaid</span>;

  return (
    <div className="flex flex-col gap-0.5">
      <button
        onClick={handleRepay}
        disabled={step !== "idle"}
        className="text-[10px] text-terminal-amber border border-terminal-amber px-1.5 py-0.5 hover:bg-terminal-amber hover:text-black transition-colors disabled:opacity-50"
      >
        {step === "approving" ? "Approving..." : step === "repaying" ? "Repaying..." : "Repay"}
      </button>
      {error && <span className="text-[10px] text-terminal-red">{error}</span>}
    </div>
  );
}

// ── Private redeem button ─────────────────────────────────────────────────────

function PrivateRedeemButton({
  burnerIndex,
  loan,
}: {
  burnerIndex: number;
  loan: Loan;
}) {
  const { burnerSend } = useUnlink();
  const [step, setStep] = useState<"idle" | "redeeming" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleRedeem() {
    setError(null);
    setStep("redeeming");
    try {
      const tokenId = await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "loanToNft",
        args: [BigInt(loan.loanId)],
      }) as bigint;

      const { txHash } = await burnerSend(
        burnerIndex,
        encodeBurnerCall({
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI,
          functionName: "redeem",
          args: [tokenId],
        })
      );
      await waitForBurnerTx(txHash);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Redeem failed");
      setStep("idle");
    }
  }

  if (loan.status !== "repaid" && loan.status !== "liquidated") return null;
  if (step === "done") return <span className="text-terminal-green text-[10px]">Redeemed</span>;

  return (
    <div className="flex flex-col gap-0.5">
      <button
        onClick={handleRedeem}
        disabled={step !== "idle"}
        className="text-[10px] text-terminal-green border border-terminal-green px-1.5 py-0.5 hover:bg-terminal-green hover:text-black transition-colors disabled:opacity-50"
      >
        {step === "redeeming" ? "Redeeming..." : "Redeem"}
      </button>
      {error && <span className="text-[10px] text-terminal-red">{error}</span>}
    </div>
  );
}

// ── Row components ────────────────────────────────────────────────────────────

function PrivateLendOrderRow({
  order,
  assets,
}: {
  order: LendOrder;
  assets: ReturnType<typeof useAssets>["data"];
}) {
  const borrowAsset = assets?.borrowAssets.find(
    (a) => a.address.toLowerCase() === order.borrowAsset.toLowerCase()
  );
  const pct = fillPercent(order.filledAmount, order.amount);
  return (
    <tr className="border-b border-terminal-border text-xs">
      <td className="py-1 px-2 text-terminal-muted">#{order.orderId}</td>
      <td className="py-1 px-2">
        {formatTokenAmount(order.amount, borrowAsset?.decimals ?? 6, 0)}{" "}
        {borrowAsset?.symbol}
      </td>
      <td className="py-1 px-2">
        <div className="flex items-center gap-1">
          <div className="w-10 h-1 bg-terminal-border rounded-full overflow-hidden">
            <div className="h-full bg-terminal-green" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[10px] text-terminal-muted">{pct.toFixed(0)}%</span>
        </div>
      </td>
      <td className="py-1 px-2 text-terminal-green">{formatRate(order.minRate)}</td>
      <td className="py-1 px-2 text-terminal-muted text-[10px]">—</td>
    </tr>
  );
}

function PrivateBorrowOrderRow({
  order,
  assets,
}: {
  order: BorrowOrder;
  assets: ReturnType<typeof useAssets>["data"];
}) {
  const borrowAsset = assets?.borrowAssets.find(
    (a) => a.address.toLowerCase() === order.borrowAsset.toLowerCase()
  );
  const pct = fillPercent(order.filledAmount, order.amount);
  return (
    <tr className="border-b border-terminal-border text-xs">
      <td className="py-1 px-2 text-terminal-muted">#{order.orderId}</td>
      <td className="py-1 px-2">
        {formatTokenAmount(order.amount, borrowAsset?.decimals ?? 6, 0)}{" "}
        {borrowAsset?.symbol}
      </td>
      <td className="py-1 px-2">
        <div className="flex items-center gap-1">
          <div className="w-10 h-1 bg-terminal-border rounded-full overflow-hidden">
            <div className="h-full bg-terminal-amber" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[10px] text-terminal-muted">{pct.toFixed(0)}%</span>
        </div>
      </td>
      <td className="py-1 px-2 text-terminal-amber">{formatRate(order.maxRate)}</td>
      <td className="py-1 px-2 text-terminal-muted text-[10px]">—</td>
    </tr>
  );
}

function PrivateLoanRow({
  loan,
  burnerIndex,
  burnerAddress,
  assets,
  side,
}: {
  loan: Loan;
  burnerIndex: number;
  burnerAddress: string;
  assets: ReturnType<typeof useAssets>["data"];
  side: "lend" | "borrow";
}) {
  const borrowAsset = assets?.borrowAssets.find(
    (a) => a.address.toLowerCase() === loan.borrowAsset.toLowerCase()
  );
  const dec = borrowAsset?.decimals ?? 6;
  const statusColor: Record<string, string> = {
    active: "text-terminal-green",
    repaid: "text-blue-400",
    liquidated: "text-terminal-red",
    defaulted: "text-terminal-amber",
  };

  return (
    <tr className="border-b border-terminal-border text-xs">
      <td className="py-1 px-2 text-terminal-muted">#{loan.loanId}</td>
      <td className="py-1 px-2">
        {formatTokenAmount(loan.principal, dec, 0)} {borrowAsset?.symbol}
      </td>
      <td className="py-1 px-2">{formatRate(loan.rate)}</td>
      <td className="py-1 px-2 text-terminal-muted">
        {loan.status === "active" ? timeRemaining(loan.maturityDate) : loan.status.toUpperCase()}
      </td>
      <td className="py-1 px-2">
        <span className={statusColor[loan.status] ?? "text-terminal-muted"}>
          {loan.status.toUpperCase()}
        </span>
      </td>
      <td className="py-1 px-2">
        <div className="flex flex-col gap-1">
          {side === "borrow" && loan.status === "active" && (
            <PrivateRepayButton burnerIndex={burnerIndex} loan={loan} decimals={dec} />
          )}
          {side === "lend" && (loan.status === "repaid" || loan.status === "liquidated") && (
            <PrivateRedeemButton burnerIndex={burnerIndex} loan={loan} />
          )}
          {(loan.status === "repaid" || loan.status === "liquidated") && borrowAsset && (
            <SweepButton
              burnerIndex={burnerIndex}
              burnerAddress={burnerAddress}
              token={loan.borrowAsset}
              decimals={dec}
              symbol={borrowAsset.symbol}
            />
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PrivatePositions() {
  const { address } = useAccount();
  const { walletExists } = useUnlink();
  const { data: assets } = useAssets();
  const { positions, isLoading } = usePrivatePositions();

  if (!address || !walletExists) return null;

  const totalLendOrders = positions.reduce((s, p) => s + p.lendOrders.length, 0);
  const totalBorrowOrders = positions.reduce((s, p) => s + p.borrowOrders.length, 0);
  const totalLenderLoans = positions.reduce((s, p) => s + p.lenderLoans.length, 0);
  const totalBorrowerLoans = positions.reduce((s, p) => s + p.borrowerLoans.length, 0);

  const hasAny =
    totalLendOrders + totalBorrowOrders + totalLenderLoans + totalBorrowerLoans > 0;

  const LOAN_HEADERS = ["ID", "Principal", "Rate", "Matures", "Status", "Action"];
  const ORDER_HEADERS = ["ID", "Amount", "Fill", "Rate", "Action"];

  return (
    <div className="flex flex-col bg-terminal-panel border border-terminal-border overflow-auto">
      <div className="flex items-center justify-between px-3 py-2 border-b border-terminal-border shrink-0">
        <span className="text-xs font-semibold tracking-widest text-terminal-text">
          PRIVATE POSITIONS
        </span>
        <span className="text-[10px] text-terminal-green border border-terminal-green px-1.5 py-0.5">
          UNLINK
        </span>
      </div>

      {isLoading && !hasAny && (
        <div className="py-3 px-3 text-terminal-muted text-xs">Loading...</div>
      )}

      {!isLoading && !hasAny && (
        <div className="py-3 px-3 text-terminal-muted text-xs">
          No private positions. Toggle "Place privately" on an order form to get started.
        </div>
      )}

      {hasAny && (
        <>
          {/* Lend section */}
          {(totalLendOrders > 0 || totalLenderLoans > 0) && (
            <div>
              <div className="text-[10px] tracking-widest font-semibold px-3 py-1.5 border-b border-terminal-border text-terminal-green">
                LEND ({totalLendOrders} orders · {totalLenderLoans} loans)
              </div>
              {positions.map((p) => (
                <div key={p.burner.burnerAddress}>
                  {p.lendOrders.length > 0 && (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-terminal-border">
                          {ORDER_HEADERS.map((h) => (
                            <th key={h} className="py-1 px-2 text-left text-terminal-muted font-normal text-[10px] uppercase">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {p.lendOrders.map((o) => (
                          <PrivateLendOrderRow key={o.orderId} order={o} assets={assets} />
                        ))}
                      </tbody>
                    </table>
                  )}
                  {p.lenderLoans.length > 0 && (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-terminal-border">
                          {LOAN_HEADERS.map((h) => (
                            <th key={h} className="py-1 px-2 text-left text-terminal-muted font-normal text-[10px] uppercase">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {p.lenderLoans.map((l) => (
                          <PrivateLoanRow
                            key={l.loanId}
                            loan={l}
                            burnerIndex={p.burner.burnerIndex}
                            burnerAddress={p.burner.burnerAddress}
                            assets={assets}
                            side="lend"
                          />
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div className="px-3 py-1 text-[10px] text-terminal-muted border-b border-terminal-border">
                    Burner: {truncateAddress(p.burner.burnerAddress)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Borrow section */}
          {(totalBorrowOrders > 0 || totalBorrowerLoans > 0) && (
            <div>
              <div className="text-[10px] tracking-widest font-semibold px-3 py-1.5 border-b border-terminal-border text-terminal-amber">
                BORROW ({totalBorrowOrders} orders · {totalBorrowerLoans} loans)
              </div>
              {positions.map((p) => (
                <div key={p.burner.burnerAddress}>
                  {p.borrowOrders.length > 0 && (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-terminal-border">
                          {ORDER_HEADERS.map((h) => (
                            <th key={h} className="py-1 px-2 text-left text-terminal-muted font-normal text-[10px] uppercase">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {p.borrowOrders.map((o) => (
                          <PrivateBorrowOrderRow key={o.orderId} order={o} assets={assets} />
                        ))}
                      </tbody>
                    </table>
                  )}
                  {p.borrowerLoans.length > 0 && (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-terminal-border">
                          {LOAN_HEADERS.map((h) => (
                            <th key={h} className="py-1 px-2 text-left text-terminal-muted font-normal text-[10px] uppercase">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {p.borrowerLoans.map((l) => (
                          <PrivateLoanRow
                            key={l.loanId}
                            loan={l}
                            burnerIndex={p.burner.burnerIndex}
                            burnerAddress={p.burner.burnerAddress}
                            assets={assets}
                            side="borrow"
                          />
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div className="px-3 py-1 text-[10px] text-terminal-muted border-b border-terminal-border">
                    Burner: {truncateAddress(p.burner.burnerAddress)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
