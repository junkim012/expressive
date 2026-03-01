"use client";

import { useState } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { useUnlink } from "@unlink-xyz/react";
import { usePrivatePositions } from "@/hooks/usePrivatePositions";
import { useAssets } from "@/hooks/useAssets";
import { CONTRACT_ADDRESS, CONTRACT_ABI, ERC20_ABI, ORACLE_ABI, NATIVE_TOKEN, GAS_RESERVE } from "@/lib/contract";
import { encodeBurnerCall, waitForBurnerTx, publicClient } from "@/lib/burnerClient";
import { ensureAsset } from "@/lib/ensureAsset";
import {
  formatRate,
  formatLtv,
  formatDuration,
  formatTokenAmount,
  fillPercent,
  timeRemaining,
  truncateAddress,
} from "@/lib/format";
import type { LendOrder, BorrowOrder, Loan, AssetInfo } from "@/types";

type Variant = "trade" | "positions";

// ── Multi-token sweep button ─────────────────────────────────────────────────

function MultiSweepButton({
  burnerIndex,
  burnerAddress,
  tokens,
}: {
  burnerIndex: number;
  burnerAddress: string;
  tokens: { address: string; decimals: number; symbol: string }[];
}) {
  const { burnerGetTokenBalance, burnerSweepToPool } = useUnlink();
  const [balances, setBalances] = useState<(bigint | null)[] | null>(null);
  const [sweeping, setSweeping] = useState<Set<number>>(new Set());
  const [swept, setSwept] = useState<Set<number>>(new Set());

  async function loadBalances() {
    const results = await Promise.all(
      tokens.map((t) => burnerGetTokenBalance(burnerAddress, t.address))
    );
    setBalances(results);
  }

  async function handleSweep(idx: number) {
    const bal = balances?.[idx];
    if (!bal || bal === 0n) return;
    setSweeping((prev) => new Set(prev).add(idx));
    try {
      await burnerSweepToPool(burnerIndex, { token: tokens[idx].address, amount: bal });
      setSwept((prev) => new Set(prev).add(idx));
    } finally {
      setSweeping((prev) => {
        const next = new Set(prev);
        next.delete(idx);
        return next;
      });
    }
  }

  if (balances === null) {
    return (
      <button
        onClick={loadBalances}
        className="text-[10px] text-terminal-muted hover:text-terminal-text transition-colors"
      >
        Check balance
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {tokens.map((t, i) => {
        const bal = balances[i];
        if (swept.has(i)) {
          return <span key={t.address} className="text-terminal-green text-[10px]">{t.symbol}: Swept</span>;
        }
        if (!bal || bal === 0n) {
          return <span key={t.address} className="text-[10px] text-terminal-muted">{t.symbol}: No balance</span>;
        }
        return (
          <button
            key={t.address}
            onClick={() => handleSweep(i)}
            disabled={sweeping.has(i)}
            className="text-[10px] text-terminal-green border border-terminal-green px-1.5 py-0.5 hover:bg-terminal-green hover:text-black transition-colors disabled:opacity-50"
          >
            {sweeping.has(i)
              ? `Sweeping ${t.symbol}...`
              : `Sweep ${formatTokenAmount(bal.toString(), t.decimals, 2)} ${t.symbol}`}
          </button>
        );
      })}
    </div>
  );
}

// ── Private repay button ──────────────────────────────────────────────────────

function PrivateRepayButton({
  burnerIndex,
  burnerAddress,
  loan,
  decimals,
  borrowOrder,
  assets,
}: {
  burnerIndex: number;
  burnerAddress: string;
  loan: Loan;
  decimals: number;
  borrowOrder: BorrowOrder | undefined;
  assets: ReturnType<typeof useAssets>["data"];
}) {
  const {
    balances,
    burnerFund,
    burnerSend,
    burnerGetBalance,
    burnerGetTokenBalance,
    burnerSweepToPool,
    waitForConfirmation,
  } = useUnlink();
  const [step, setStep] = useState<
    "idle" | "gas" | "funding" | "approving" | "repaying" | "sweeping" | "done"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleRepay() {
    setError(null);
    const deps = { balances, burnerGetBalance, burnerGetTokenBalance, burnerFund, waitForConfirmation };
    try {
      const interest = await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "getAccruedInterest",
        args: [BigInt(loan.loanId)],
      }) as bigint;
      const repayAmount = BigInt(loan.principal) + interest;
      // Add 1% buffer for interest accruing between approve and repay txs
      const repayWithBuffer = repayAmount + repayAmount / 100n;

      const borrowAssetInfo = assets?.borrowAssets.find(
        (a) => a.address.toLowerCase() === loan.borrowAsset.toLowerCase()
      );

      setStep("gas");
      await ensureAsset(deps, burnerIndex, burnerAddress, NATIVE_TOKEN, GAS_RESERVE, "MON");

      setStep("funding");
      await ensureAsset(deps, burnerIndex, burnerAddress, loan.borrowAsset, repayWithBuffer, borrowAssetInfo?.symbol ?? "");

      setStep("approving");
      const { txHash: approveTx } = await burnerSend(
        burnerIndex,
        encodeBurnerCall({
          address: loan.borrowAsset as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [CONTRACT_ADDRESS, repayWithBuffer],
        })
      );
      await waitForBurnerTx(approveTx);

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

      if (borrowOrder && borrowOrder.collateralAssets.length > 0) {
        setStep("sweeping");
        for (const collateralAsset of borrowOrder.collateralAssets) {
          const returned = await burnerGetTokenBalance(burnerAddress, collateralAsset);
          if (returned > 0n) {
            await burnerSweepToPool(burnerIndex, { token: collateralAsset, amount: returned });
          }
        }
      }

      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Repay failed");
      setStep("idle");
    }
  }

  if (step === "done") return <span className="text-terminal-green text-[10px]">Repaid</span>;

  function stepLabel() {
    if (step === "gas") return "Ensuring gas...";
    if (step === "funding") return "Ensuring repay funds...";
    if (step === "approving") return "Approving...";
    if (step === "repaying") return "Repaying...";
    if (step === "sweeping") return "Sweeping collateral...";
    return "Repay";
  }

  return (
    <div className="flex flex-col gap-0.5">
      <button
        onClick={handleRepay}
        disabled={step !== "idle"}
        className="text-[10px] text-terminal-amber border border-terminal-amber px-1.5 py-0.5 hover:bg-terminal-amber hover:text-black transition-colors disabled:opacity-50"
      >
        {stepLabel()}
      </button>
      {error && <span className="text-[10px] text-terminal-red">{error}</span>}
    </div>
  );
}

// ── Private redeem button ─────────────────────────────────────────────────────

function PrivateRedeemButton({
  burnerIndex,
  burnerAddress,
  loan,
  borrowAssetInfo,
  redeemable,
  onRedeemed,
}: {
  burnerIndex: number;
  burnerAddress: string;
  loan: Loan;
  borrowAssetInfo: AssetInfo | undefined;
  redeemable: bigint | undefined;
  onRedeemed?: () => void;
}) {
  const {
    balances,
    burnerFund,
    burnerSend,
    burnerGetBalance,
    burnerGetTokenBalance,
    burnerSweepToPool,
    waitForConfirmation,
  } = useUnlink();
  const [step, setStep] = useState<"idle" | "gas" | "redeeming" | "sweeping" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleRedeem() {
    setError(null);
    const deps = { balances, burnerGetBalance, burnerGetTokenBalance, burnerFund, waitForConfirmation };
    try {
      setStep("gas");
      await ensureAsset(deps, burnerIndex, burnerAddress, NATIVE_TOKEN, GAS_RESERVE, "MON");

      setStep("redeeming");
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

      if (borrowAssetInfo) {
        setStep("sweeping");
        const redeemed = await burnerGetTokenBalance(burnerAddress, borrowAssetInfo.address);
        if (redeemed > 0n) {
          await burnerSweepToPool(burnerIndex, { token: borrowAssetInfo.address, amount: redeemed });
        }
      }

      setStep("done");
      onRedeemed?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Redeem failed");
      setStep("idle");
    }
  }

  if (loan.status !== "repaid" && loan.status !== "liquidated") return null;
  if (redeemable === undefined) return null;
  if (redeemable === 0n) return null;
  if (step === "done") return null;

  function stepLabel() {
    if (step === "gas") return "Ensuring gas...";
    if (step === "redeeming") return "Redeeming...";
    if (step === "sweeping") return "Sweeping to pool...";
    return "Redeem";
  }

  return (
    <div className="flex flex-col gap-0.5">
      <button
        onClick={handleRedeem}
        disabled={step !== "idle"}
        className="text-[10px] text-terminal-green border border-terminal-green px-1.5 py-0.5 hover:bg-terminal-green hover:text-black transition-colors disabled:opacity-50"
      >
        {stepLabel()}
      </button>
      {error && <span className="text-[10px] text-terminal-red">{error}</span>}
    </div>
  );
}

// ── Order row components ──────────────────────────────────────────────────────

function PrivateLendOrderRow({
  order,
  assets,
  variant,
}: {
  order: LendOrder;
  assets: ReturnType<typeof useAssets>["data"];
  variant: Variant;
}) {
  const borrowAsset = assets?.borrowAssets.find(
    (a) => a.address.toLowerCase() === order.borrowAsset.toLowerCase()
  );
  const dec = borrowAsset?.decimals ?? 6;

  if (variant === "positions") {
    const collateralSymbols = order.acceptableCollateral
      .map((addr) => {
        const ca = assets?.collateralAssets.find(
          (a) => a.address.toLowerCase() === addr.toLowerCase()
        );
        return ca?.symbol ?? truncateAddress(addr);
      })
      .join(", ");

    return (
      <tr className="border-b border-terminal-border text-xs">
        <td className="py-1 px-2 text-terminal-muted">#{order.orderId}</td>
        <td className="py-1 px-2">
          {formatTokenAmount(order.amount, dec, 2)} {borrowAsset?.symbol}
        </td>
        <td className="py-1 px-2 text-terminal-green">{formatRate(order.minRate)}</td>
        <td className="py-1 px-2 text-terminal-muted">{formatLtv(order.maxLtv)}</td>
        <td className="py-1 px-2 text-terminal-muted">{formatLtv(order.maxLltv)}</td>
        <td className="py-1 px-2 text-terminal-muted">{formatDuration(order.maxDuration)}</td>
        <td className="py-1 px-2 text-terminal-muted text-[10px]">{collateralSymbols || "—"}</td>
      </tr>
    );
  }

  // Trade variant
  const pct = fillPercent(order.filledAmount, order.amount);
  return (
    <tr className="border-b border-terminal-border text-xs">
      <td className="py-1 px-2 text-terminal-muted">#{order.orderId}</td>
      <td className="py-1 px-2">
        {formatTokenAmount(order.amount, dec, 2)} {borrowAsset?.symbol}
      </td>
      <td className="py-1 px-2">
        {formatTokenAmount(order.filledAmount, dec, 2)} {borrowAsset?.symbol}
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
    </tr>
  );
}

function PrivateBorrowOrderRow({
  order,
  assets,
  variant,
}: {
  order: BorrowOrder;
  assets: ReturnType<typeof useAssets>["data"];
  variant: Variant;
}) {
  const borrowAsset = assets?.borrowAssets.find(
    (a) => a.address.toLowerCase() === order.borrowAsset.toLowerCase()
  );
  const dec = borrowAsset?.decimals ?? 6;

  if (variant === "positions") {
    const collateralSymbols = order.collateralAssets
      .map((addr) => {
        const ca = assets?.collateralAssets.find(
          (a) => a.address.toLowerCase() === addr.toLowerCase()
        );
        return ca?.symbol ?? truncateAddress(addr);
      })
      .join(", ");

    return (
      <tr className="border-b border-terminal-border text-xs">
        <td className="py-1 px-2 text-terminal-muted">#{order.orderId}</td>
        <td className="py-1 px-2">
          {formatTokenAmount(order.amount, dec, 2)} {borrowAsset?.symbol}
        </td>
        <td className="py-1 px-2 text-terminal-amber">{formatRate(order.maxRate)}</td>
        <td className="py-1 px-2 text-terminal-muted">{formatLtv(order.minLtv)}</td>
        <td className="py-1 px-2 text-terminal-muted">{formatLtv(order.minLltv)}</td>
        <td className="py-1 px-2 text-terminal-muted">{formatDuration(order.minDuration)}</td>
        <td className="py-1 px-2 text-terminal-muted text-[10px]">{collateralSymbols || "—"}</td>
      </tr>
    );
  }

  // Trade variant
  const pct = fillPercent(order.filledAmount, order.amount);
  return (
    <tr className="border-b border-terminal-border text-xs">
      <td className="py-1 px-2 text-terminal-muted">#{order.orderId}</td>
      <td className="py-1 px-2">
        {formatTokenAmount(order.amount, dec, 2)} {borrowAsset?.symbol}
      </td>
      <td className="py-1 px-2">
        {formatTokenAmount(order.filledAmount, dec, 2)} {borrowAsset?.symbol}
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
    </tr>
  );
}

// ── Loan row component ────────────────────────────────────────────────────────

function PrivateLoanRow({
  loan,
  burnerIndex,
  burnerAddress,
  assets,
  side,
  borrowOrder,
  variant,
}: {
  loan: Loan;
  burnerIndex: number;
  burnerAddress: string;
  assets: ReturnType<typeof useAssets>["data"];
  side: "lend" | "borrow";
  borrowOrder?: BorrowOrder;
  variant: Variant;
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

  const isSettled = loan.status === "repaid" || loan.status === "liquidated";

  // Local override for immediate UI feedback after redeeming
  const [localRedeemed, setLocalRedeemed] = useState(false);

  // Stage 1: Get on-chain loan data + redeemable amount
  const { data: loanData } = useReadContracts({
    contracts: [
      {
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "getLoan",
        args: [BigInt(loan.loanId)],
      },
      {
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "redeemableByLoan",
        args: [BigInt(loan.loanId)],
      },
    ],
    query: { refetchInterval: 15_000 },
  });

  const onChainLoan = loanData?.[0]?.result;
  const redeemableAmount = loanData?.[1]?.result as bigint | undefined;
  const isRedeemed = (side === "lend" && isSettled && redeemableAmount === 0n) || localRedeemed;
  const collateralAssets = onChainLoan?.collateralAssets ?? [];
  const collateralAmounts = onChainLoan?.collateralAmounts ?? [];

  // Stage 2 & 3: Oracle data — only for positions variant
  const { data: oracleData } = useReadContracts({
    contracts: collateralAssets.map((asset) => ({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: "collateralOracle" as const,
      args: [asset] as const,
    })),
    query: {
      enabled: variant === "positions" && collateralAssets.length > 0,
      refetchInterval: 15_000,
    },
  });

  const oracleAddresses = (oracleData ?? [])
    .map((o) => o?.result as `0x${string}` | undefined)
    .filter((a): a is `0x${string}` => !!a);

  const { data: priceData } = useReadContracts({
    contracts: oracleAddresses.map((addr) => ({
      address: addr,
      abi: ORACLE_ABI,
      functionName: "getPrice" as const,
    })),
    query: {
      enabled: variant === "positions" && oracleAddresses.length > 0,
      refetchInterval: 15_000,
    },
  });

  // Build collateral display data
  const collateralRows = collateralAssets.map((addr, i) => {
    const colAsset = assets?.collateralAssets.find(
      (a) => a.address.toLowerCase() === addr.toLowerCase()
    );
    const amount = collateralAmounts[i];
    const colDec = colAsset?.decimals ?? 18;
    const price = priceData?.[i]?.result as bigint | undefined;

    let totalValue: bigint | undefined;
    if (price !== undefined && amount !== undefined) {
      totalValue = (price * amount) / (10n ** BigInt(colDec));
    }

    return {
      address: addr,
      symbol: colAsset?.symbol ?? truncateAddress(addr),
      amount,
      decimals: colDec,
      price,
      totalValue,
    };
  });

  // Compute current LTV (positions variant)
  const totalCollateralValue = collateralRows.reduce(
    (sum, r) => sum + (r.totalValue ?? 0n),
    0n
  );
  const currentLtv =
    totalCollateralValue > 0n
      ? Number((BigInt(loan.principal) * 10000n) / totalCollateralValue)
      : undefined;

  // Build sweep tokens list
  const sweepTokens: { address: string; decimals: number; symbol: string }[] = [];
  if (side === "lend" && borrowAsset) {
    sweepTokens.push({ address: loan.borrowAsset, decimals: dec, symbol: borrowAsset.symbol });
  } else if (side === "borrow" && borrowOrder) {
    for (const colAddr of borrowOrder.collateralAssets) {
      const colAsset = assets?.collateralAssets.find(
        (a) => a.address.toLowerCase() === colAddr.toLowerCase()
      );
      if (colAsset) {
        sweepTokens.push({ address: colAddr, decimals: colAsset.decimals, symbol: colAsset.symbol });
      }
    }
  }

  // Status display
  const statusText = isRedeemed ? "REDEEMED" : loan.status.toUpperCase();
  const statusClass = isRedeemed
    ? "text-blue-400"
    : (statusColor[loan.status] ?? "text-terminal-muted");

  // ── Action cell (shared by both variants) ──
  const actionCell = (
    <td className="py-1 px-2">
      <div className="flex flex-col gap-1">
        {side === "borrow" && loan.status === "active" && (
          <PrivateRepayButton
            burnerIndex={burnerIndex}
            burnerAddress={burnerAddress}
            loan={loan}
            decimals={dec}
            borrowOrder={borrowOrder}
            assets={assets}
          />
        )}
        {side === "lend" && isSettled && !isRedeemed && (
          <PrivateRedeemButton
            burnerIndex={burnerIndex}
            burnerAddress={burnerAddress}
            loan={loan}
            borrowAssetInfo={borrowAsset}
            redeemable={redeemableAmount}
            onRedeemed={() => setLocalRedeemed(true)}
          />
        )}
        {isSettled && (isRedeemed || side === "borrow") && sweepTokens.length > 0 && (
          <MultiSweepButton
            burnerIndex={burnerIndex}
            burnerAddress={burnerAddress}
            tokens={sweepTokens}
          />
        )}
      </div>
    </td>
  );

  // ── Positions variant ──
  if (variant === "positions") {
    return (
      <tr className="border-b border-terminal-border text-xs">
        <td className="py-1 px-2 text-terminal-muted">#{loan.loanId}</td>
        <td className="py-1 px-2">
          {formatTokenAmount(loan.principal, dec, 2)} {borrowAsset?.symbol}
        </td>
        <td className="py-1 px-2">{formatRate(loan.rate)}</td>
        {/* Collateral */}
        <td className="py-1 px-2">
          {collateralRows.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {collateralRows.map((row) => (
                <div key={row.address} className="text-[10px]">
                  {formatTokenAmount(row.amount?.toString() ?? "0", row.decimals, 4)} {row.symbol}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-terminal-muted text-[10px]">...</span>
          )}
        </td>
        {/* Price */}
        <td className="py-1 px-2">
          {collateralRows.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {collateralRows.map((row) => (
                <div key={row.address} className="flex flex-col">
                  {row.price !== undefined ? (
                    <>
                      <span className="text-[10px]">
                        {formatTokenAmount(row.price.toString(), dec, 2)} {borrowAsset?.symbol}
                      </span>
                      {row.totalValue !== undefined && (
                        <span className="text-terminal-muted text-[10px]">
                          = {formatTokenAmount(row.totalValue.toString(), dec, 2)} {borrowAsset?.symbol}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-terminal-muted text-[10px]">...</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-terminal-muted text-[10px]">...</span>
          )}
        </td>
        {/* Current LTV */}
        <td className="py-1 px-2 text-[10px]">
          {currentLtv !== undefined ? formatLtv(currentLtv) : "..."}
        </td>
        <td className="py-1 px-2 text-terminal-muted">
          {loan.status === "active" ? timeRemaining(loan.maturityDate) : "—"}
        </td>
        <td className="py-1 px-2">
          <span className={statusClass}>{statusText}</span>
        </td>
        {actionCell}
      </tr>
    );
  }

  // ── Trade variant ──
  return (
    <tr className="border-b border-terminal-border text-xs">
      <td className="py-1 px-2 text-terminal-muted">#{loan.loanId}</td>
      <td className="py-1 px-2">
        {formatTokenAmount(loan.principal, dec, 2)} {borrowAsset?.symbol}
      </td>
      <td className="py-1 px-2">{formatRate(loan.rate)}</td>
      <td className="py-1 px-2 text-terminal-muted">
        {loan.status === "active" ? timeRemaining(loan.maturityDate) : "—"}
      </td>
      <td className="py-1 px-2">
        <span className={statusClass}>{statusText}</span>
      </td>
      {actionCell}
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PrivatePositions({ variant = "trade" }: { variant?: Variant }) {
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

  // Column headers based on variant
  const LEND_ORDER_HEADERS =
    variant === "positions"
      ? ["ID", "Amount", "Min Rate", "Max LTV", "Max LLTV", "Max Duration", "Collateral"]
      : ["ID", "Amount", "Filled", "Fill %", "Min Rate"];

  const BORROW_ORDER_HEADERS =
    variant === "positions"
      ? ["ID", "Amount", "Max Rate", "Min LTV", "Min LLTV", "Min Duration", "Collateral"]
      : ["ID", "Amount", "Filled", "Fill %", "Max Rate"];

  const LOAN_HEADERS =
    variant === "positions"
      ? ["ID", "Principal", "Rate", "Collateral", "Price", "Current LTV", "Matures", "Status", "Action"]
      : ["ID", "Principal", "Rate", "Matures", "Status", "Action"];

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
                          {LEND_ORDER_HEADERS.map((h) => (
                            <th key={h} className="py-1 px-2 text-left text-terminal-muted font-normal text-[10px] uppercase">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {p.lendOrders.map((o) => (
                          <PrivateLendOrderRow key={o.orderId} order={o} assets={assets} variant={variant} />
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
                            variant={variant}
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
                          {BORROW_ORDER_HEADERS.map((h) => (
                            <th key={h} className="py-1 px-2 text-left text-terminal-muted font-normal text-[10px] uppercase">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {p.borrowOrders.map((o) => (
                          <PrivateBorrowOrderRow key={o.orderId} order={o} assets={assets} variant={variant} />
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
                            borrowOrder={p.borrowOrders.find((o) => o.orderId === l.borrowOrderId)}
                            variant={variant}
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
