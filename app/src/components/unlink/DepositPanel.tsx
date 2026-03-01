"use client";

import { useState, useRef, useEffect } from "react";
import {
  useAccount,
  useBalance,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSendTransaction,
  useReadContracts,
} from "wagmi";
import { useUnlink } from "@unlink-xyz/react";
import { useAssets } from "@/hooks/useAssets";
import { ERC20_ABI, NATIVE_TOKEN } from "@/lib/contract";
import { formatTokenAmount, parseTokenAmount } from "@/lib/format";
import { UnlinkWalletSetup } from "./UnlinkWalletSetup";

type Step = "idle" | "preparing" | "approving" | "submitting" | "confirming" | "done";

const STEP_LABELS: Record<Step, string> = {
  idle:       "",
  preparing:  "Preparing deposit...",
  approving:  "Approving token...",
  submitting: "Submitting deposit...",
  confirming: "Syncing shielded balance...",
  done:       "Deposit confirmed!",
};

/**
 * Deposit panel for the private mode right column.
 * Shows shielded balances (including native MON) and walks through the
 * approve → deposit flow. Native MON skips the approve step.
 */
export function DepositPanel() {
  const { address, isConnected } = useAccount();
  const { data: assets } = useAssets();
  const { walletExists, balances, deposit, refresh } = useUnlink();

  const erc20Assets = [
    ...(assets?.borrowAssets ?? []),
    ...(assets?.collateralAssets ?? []),
  ];

  // Native MON wallet balance
  const { data: monBalance } = useBalance({
    address,
    query: { enabled: !!address },
  });
  const monWalletBal = monBalance?.value ?? 0n;
  const monShieldedBal = walletExists ? (balances[NATIVE_TOKEN] ?? 0n) : 0n;

  // Batch-read EOA balances for ERC20 assets
  const { data: walletBalanceResults } = useReadContracts({
    contracts: erc20Assets.map((a) => ({
      address: a.address as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "balanceOf" as const,
      args: [address!] as [`0x${string}`],
    })),
    query: { enabled: !!address && erc20Assets.length > 0 },
  });

  const [token, setToken] = useState("");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [showWalletSetup, setShowWalletSetup] = useState(false);

  const stepRef = useRef<Step>("idle");
  stepRef.current = step;

  const depositResultRef = useRef<{
    to: `0x${string}`;
    calldata: `0x${string}`;
    value: bigint;
    relayId: string;
  } | null>(null);

  const {
    writeContract,
    data: approveTxHash,
    isPending: isApprovePending,
    reset: resetApprove,
  } = useWriteContract();

  const { isSuccess: isApproveSuccess } = useWaitForTransactionReceipt({
    hash: approveTxHash,
  });

  const {
    sendTransaction,
    data: depositTxHash,
    isPending: isSendPending,
    reset: resetSend,
  } = useSendTransaction();

  const { isSuccess: isDepositTxSuccess } = useWaitForTransactionReceipt({
    hash: depositTxHash,
  });

  // After ERC20 approve confirms → submit deposit calldata on-chain
  useEffect(() => {
    if (!isApproveSuccess || !approveTxHash || stepRef.current !== "approving") return;
    const result = depositResultRef.current;
    if (!result) return;
    resetApprove();
    setStep("submitting");
    sendTransaction({ to: result.to, data: result.calldata, value: result.value });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isApproveSuccess, approveTxHash]);

  // After deposit tx confirms → sync shielded balances
  useEffect(() => {
    if (!isDepositTxSuccess || !depositTxHash || stepRef.current !== "submitting") return;
    const result = depositResultRef.current;
    if (!result) return;
    resetSend();
    setStep("confirming");
    refresh()
      .then(() => {
        setStep("done");
        setTimeout(() => {
          setStep("idle");
          setAmount("");
          depositResultRef.current = null;
        }, 3000);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Sync failed");
        setStep("idle");
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDepositTxSuccess, depositTxHash]);

  async function handleDeposit() {
    setError(null);
    if (!address) return setError("Connect wallet first");
    if (!walletExists) return setError("Set up your Unlink wallet first");
    if (!token) return setError("Select a token");
    if (!amount || parseFloat(amount) <= 0) return setError("Enter an amount");

    const isNative = token === NATIVE_TOKEN;
    const dec = isNative ? 18 : (erc20Assets.find((a) => a.address === token)?.decimals ?? 18);
    const amountRaw = parseTokenAmount(amount, dec);

    try {
      setStep("preparing");
      const result = await deposit([{ token, amount: amountRaw, depositor: address }]);
      depositResultRef.current = {
        to:       result.to as `0x${string}`,
        calldata: result.calldata as `0x${string}`,
        value:    result.value,
        relayId:  result.relayId,
      };

      if (isNative) {
        // Native MON: skip approve, send directly with the value set by the SDK
        setStep("submitting");
        sendTransaction({ to: result.to as `0x${string}`, data: result.calldata as `0x${string}`, value: result.value });
      } else {
        // ERC20: approve pool contract first
        setStep("approving");
        writeContract({
          address: token as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [result.to as `0x${string}`, amountRaw],
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit failed");
      setStep("idle");
    }
  }

  const isLoading = step !== "idle" && step !== "done";
  const isApproveOrSendPending = isApprovePending || isSendPending;

  function walletBalance(index: number): bigint {
    const r = walletBalanceResults?.[index];
    return r?.status === "success" ? (r.result as bigint) : 0n;
  }

  // For the amount hint below the deposit form
  const isNativeSelected = token === NATIVE_TOKEN;
  const selectedErc20 = erc20Assets.find((a) => a.address === token);
  const selectedErc20Index = erc20Assets.findIndex((a) => a.address === token);

  const hasAnyBalance =
    monWalletBal > 0n || monShieldedBal > 0n ||
    erc20Assets.some((a, i) => walletBalance(i) > 0n || (balances[a.address.toLowerCase()] ?? 0n) > 0n);

  if (!isConnected) return null;

  return (
    <div className="border-b border-terminal-border p-3 flex flex-col gap-2">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] tracking-wider text-terminal-muted uppercase">
          Balances
        </span>
        {!walletExists && (
          <button
            onClick={() => setShowWalletSetup(!showWalletSetup)}
            className="text-[10px] text-terminal-amber hover:text-yellow-300 transition-colors"
          >
            {showWalletSetup ? "cancel" : "setup wallet"}
          </button>
        )}
      </div>

      {showWalletSetup && !walletExists && (
        <UnlinkWalletSetup onComplete={() => setShowWalletSetup(false)} />
      )}

      {/* Balance table — wallet + shielded side by side */}
      <div className="flex flex-col gap-0.5">
        <div className="grid grid-cols-3 gap-1">
          <span className="text-[9px] text-terminal-muted uppercase tracking-wider">Asset</span>
          <span className="text-[9px] text-terminal-muted uppercase tracking-wider text-right">Wallet</span>
          <span className="text-[9px] text-terminal-muted uppercase tracking-wider text-right">Shielded</span>
        </div>

        {/* MON (native) row — always show if any balance */}
        {(monWalletBal > 0n || monShieldedBal > 0n) && (
          <div className="grid grid-cols-3 gap-1">
            <span className="text-[10px] text-terminal-muted">MON</span>
            <span className="text-[10px] text-terminal-text font-mono text-right">
              {formatTokenAmount(monWalletBal.toString(), 18)}
            </span>
            <span className={`text-[10px] font-mono text-right ${monShieldedBal > 0n ? "text-terminal-green" : "text-terminal-muted"}`}>
              {formatTokenAmount(monShieldedBal.toString(), 18)}
            </span>
          </div>
        )}

        {/* ERC20 asset rows */}
        {erc20Assets.map((a, i) => {
          const wBal = walletBalance(i);
          const sBal = walletExists ? (balances[a.address.toLowerCase()] ?? 0n) : 0n;
          if (wBal === 0n && sBal === 0n) return null;
          return (
            <div key={a.address} className="grid grid-cols-3 gap-1">
              <span className="text-[10px] text-terminal-muted">{a.symbol}</span>
              <span className="text-[10px] text-terminal-text font-mono text-right">
                {formatTokenAmount(wBal.toString(), a.decimals)}
              </span>
              <span className={`text-[10px] font-mono text-right ${sBal > 0n ? "text-terminal-green" : "text-terminal-muted"}`}>
                {formatTokenAmount(sBal.toString(), a.decimals)}
              </span>
            </div>
          );
        })}

        {!hasAnyBalance && (
          <span className="text-[10px] text-terminal-muted">No balances found</span>
        )}
      </div>

      {/* Deposit form — only when wallet exists */}
      {walletExists && (
        <>
          <div className="flex gap-1">
            <select
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="flex-1 bg-terminal-panel border border-terminal-border px-2 py-1 text-terminal-text focus:border-terminal-green focus:outline-none text-[10px]"
            >
              <option value="">Token...</option>
              <option value={NATIVE_TOKEN}>MON</option>
              {erc20Assets.map((a) => (
                <option key={a.address} value={a.address}>
                  {a.symbol}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-24 bg-transparent border border-terminal-border px-2 py-1 text-terminal-text placeholder-terminal-muted focus:border-terminal-green focus:outline-none text-[10px]"
            />
            <button
              onClick={handleDeposit}
              disabled={isLoading || isApproveOrSendPending}
              className="px-3 py-1 bg-terminal-green text-black text-[10px] font-bold hover:bg-green-400 disabled:opacity-50 transition-colors"
            >
              {step === "done" ? "✓" : isLoading ? "..." : "Deposit"}
            </button>
          </div>

          {/* Amount hint for selected token */}
          {isNativeSelected && (
            <div className="flex gap-3">
              <span className="text-[10px] text-terminal-muted">
                Wallet: {formatTokenAmount(monWalletBal.toString(), 18)} MON
              </span>
              <span className="text-[10px] text-terminal-muted">
                Shielded: {formatTokenAmount(monShieldedBal.toString(), 18)} MON
              </span>
            </div>
          )}
          {!isNativeSelected && selectedErc20 && selectedErc20Index >= 0 && (
            <div className="flex gap-3">
              <span className="text-[10px] text-terminal-muted">
                Wallet: {formatTokenAmount(walletBalance(selectedErc20Index).toString(), selectedErc20.decimals)} {selectedErc20.symbol}
              </span>
              <span className="text-[10px] text-terminal-muted">
                Shielded: {formatTokenAmount((balances[token.toLowerCase()] ?? 0n).toString(), selectedErc20.decimals)} {selectedErc20.symbol}
              </span>
            </div>
          )}

          {error && <p className="text-[10px] text-terminal-red">{error}</p>}
          {isLoading && (
            <p className="text-[10px] text-terminal-amber">{STEP_LABELS[step]}</p>
          )}
          {step === "done" && (
            <p className="text-[10px] text-terminal-green">Deposit confirmed!</p>
          )}
        </>
      )}
    </div>
  );
}
