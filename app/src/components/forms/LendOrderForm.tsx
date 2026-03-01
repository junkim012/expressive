"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { useUnlink } from "@unlink-xyz/react";
import { useAssets } from "@/hooks/useAssets";
import { CONTRACT_ADDRESS, CONTRACT_ABI, ERC20_ABI, MAX_UINT256, NATIVE_TOKEN, GAS_RESERVE } from "@/lib/contract";
import { parsePctToBps, parseLtvToBps, parseDurationToSeconds, parseTokenAmount, formatTokenAmount } from "@/lib/format";
import { encodeBurnerCall, waitForBurnerTx } from "@/lib/burnerClient";
import { getNextBurnerIndex, addBurnerForWallet } from "@/lib/burnerStorage";
import { useWalletMode } from "@/lib/walletMode";

interface FormState {
  borrowAsset: string;
  acceptableCollateral: string[];
  amount: string;
  minRate: string;
  maxLtv: string;
  maxLltv: string;
  durationValue: string;
  durationUnit: "days" | "months" | "years";
}

const EMPTY: FormState = {
  borrowAsset: "",
  acceptableCollateral: [],
  amount: "",
  minRate: "",
  maxLtv: "",
  maxLltv: "",
  durationValue: "",
  durationUnit: "days",
};

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label className="text-[10px] tracking-wider text-terminal-muted uppercase">{label}</label>
        {hint && <span className="text-[10px] text-terminal-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-transparent border border-terminal-border px-2 py-1.5 text-terminal-text placeholder-terminal-muted focus:border-terminal-green focus:outline-none text-xs transition-colors"
    />
  );
}

type BurnerIndex = 0 | 1 | 2;
const BURNER_INDICES = [0, 1, 2] as const;

export function LendOrderForm() {
  const { address, isConnected } = useAccount();
  const { data: assets } = useAssets();
  const {
    walletExists,
    balances,
    createBurner,
    burnerFund,
    burnerSend,
    waitForConfirmation,
  } = useUnlink();
  const { mode } = useWalletMode();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [selectedBurnerIdx, setSelectedBurnerIdx] = useState<BurnerIndex>(0);

  useEffect(() => {
    if (!address) return;
    const next = Math.min(getNextBurnerIndex(address), 2) as BurnerIndex;
    setSelectedBurnerIdx(next);
  }, [address]);
  const [step, setStep] = useState<
    "idle" | "approving" | "placing" | "done" |
    "private:deriving" | "private:gas" | "private:funding" | "private:approving" | "private:placing"
  >("idle");

  // Keep a ref so useEffect closures always see the latest step without needing
  // it in the dependency array (which would re-run the effect on every step change).
  const stepRef = useRef(step);
  stepRef.current = step;

  const set = (key: keyof FormState) => (val: string | string[]) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const selectedAsset = assets?.borrowAssets.find(
    (a) => a.address === form.borrowAsset
  );

  const borrowAssetAddress = form.borrowAsset as `0x${string}` | "";

  const { data: allowance } = useReadContract({
    address: borrowAssetAddress || undefined,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address && borrowAssetAddress ? [address, CONTRACT_ADDRESS] : undefined,
    query: { enabled: !!address && !!borrowAssetAddress },
  });

  const { data: balance } = useReadContract({
    address: borrowAssetAddress || undefined,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!borrowAssetAddress },
  });

  const { writeContract, data: txHash, isPending: isWritePending, reset } = useWriteContract();
  const { isLoading: isTxLoading, isSuccess: isTxSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Extracted so it can be called both from handleSubmit (when already approved)
  // and automatically from the useEffect after an approval tx confirms.
  const placeOrder = useCallback(() => {
    const dec = selectedAsset?.decimals ?? 6;
    const amountRaw = parseTokenAmount(form.amount, dec);
    const minRate = BigInt(parsePctToBps(form.minRate));
    const maxLtv = BigInt(parseLtvToBps(form.maxLtv));
    const maxLltv = BigInt(parseLtvToBps(form.maxLltv));
    const maxDuration = BigInt(parseDurationToSeconds(form.durationValue, form.durationUnit));

    setStep("placing");
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: "placeLendOrder",
      args: [
        form.borrowAsset as `0x${string}`,
        form.acceptableCollateral as `0x${string}`[],
        minRate,
        maxLtv,
        maxDuration,
        maxLltv,
        amountRaw,
      ],
    });
  }, [form, selectedAsset, writeContract]);

  // React to transaction confirmation. We use txHash in the dep array so this
  // fires exactly once per confirmed tx (isTxSuccess stays true until reset()).
  useEffect(() => {
    if (!isTxSuccess || !txHash) return;

    if (stepRef.current === "approving") {
      // Approval confirmed — immediately proceed to place the order.
      // reset() clears txHash so the next writeContract gets a fresh receipt watcher.
      reset();
      placeOrder();
    } else if (stepRef.current === "placing") {
      setStep("done");
      const t = setTimeout(() => {
        setForm(EMPTY);
        setStep("idle");
        reset();
      }, 3000);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTxSuccess, txHash]);

  async function handlePrivateSubmit() {
    setError(null);
    if (!address) return setError("Connect wallet first");
    if (!walletExists) return setError("Set up your Unlink wallet first");
    if (!form.borrowAsset) return setError("Select borrow asset");
    if (form.acceptableCollateral.length === 0) return setError("Select at least one collateral");
    if (!form.amount || parseFloat(form.amount) <= 0) return setError("Enter amount");
    if (!form.minRate || parseFloat(form.minRate) <= 0) return setError("Enter min rate");
    if (!form.maxLtv || parseFloat(form.maxLtv) <= 0) return setError("Enter max LTV");
    if (!form.maxLltv || parseFloat(form.maxLltv) <= 0) return setError("Enter max LLTV");
    if (!form.durationValue || parseFloat(form.durationValue) <= 0) return setError("Enter duration");

    const dec = selectedAsset?.decimals ?? 6;
    const amountRaw = parseTokenAmount(form.amount, dec);
    const shieldedBalance = balances[form.borrowAsset.toLowerCase()] ?? 0n;
    if (shieldedBalance < amountRaw) {
      return setError(
        `Insufficient Unlink shielded balance (${formatTokenAmount(shieldedBalance.toString(), dec)} ${selectedAsset?.symbol ?? ""}). Deposit more via Unlink.`
      );
    }

    try {
      // Step 1: derive burner
      setStep("private:deriving");
      const burnerIndex = selectedBurnerIdx;
      const burner = await createBurner(burnerIndex);

      // Step 2: fund burner with native MON for gas from shielded pool
      setStep("private:gas");
      const gasResult = await burnerFund(burnerIndex, { token: NATIVE_TOKEN, amount: GAS_RESERVE });
      await waitForConfirmation(gasResult.relayId);

      // Step 3: fund burner with borrow asset from shielded pool
      setStep("private:funding");
      const fundResult = await burnerFund(burnerIndex, {
        token: form.borrowAsset,
        amount: amountRaw,
      });
      await waitForConfirmation(fundResult.relayId);

      // Step 3: approve
      setStep("private:approving");
      const approveCall = encodeBurnerCall({
        address: form.borrowAsset as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CONTRACT_ADDRESS, amountRaw],
      });
      const { txHash: approveTxHash } = await burnerSend(burnerIndex, approveCall);
      await waitForBurnerTx(approveTxHash);

      // Step 4: place lend order
      setStep("private:placing");
      const minRate = BigInt(parsePctToBps(form.minRate));
      const maxLtv = BigInt(parseLtvToBps(form.maxLtv));
      const maxLltv = BigInt(parseLtvToBps(form.maxLltv));
      const maxDuration = BigInt(parseDurationToSeconds(form.durationValue, form.durationUnit));

      const placeCall = encodeBurnerCall({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "placeLendOrder",
        args: [
          form.borrowAsset as `0x${string}`,
          form.acceptableCollateral as `0x${string}`[],
          minRate,
          maxLtv,
          maxDuration,
          maxLltv,
          amountRaw,
        ],
      });
      const { txHash: placeTxHash } = await burnerSend(burnerIndex, placeCall);
      await waitForBurnerTx(placeTxHash);

      // Persist burner mapping
      addBurnerForWallet(address, {
        burnerIndex,
        burnerAddress: burner.address,
        orderType: "lend",
      });

      setStep("done");
      setTimeout(() => { setForm(EMPTY); setStep("idle"); }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Private order failed");
      setStep("idle");
    }
  }

  function handleSubmit() {
    if (mode === "private") { handlePrivateSubmit(); return; }
    setError(null);
    if (!address) return setError("Connect wallet first");
    if (!form.borrowAsset) return setError("Select borrow asset");
    if (form.acceptableCollateral.length === 0) return setError("Select at least one collateral");
    if (!form.amount || parseFloat(form.amount) <= 0) return setError("Enter amount");
    if (!form.minRate || parseFloat(form.minRate) <= 0) return setError("Enter min rate");
    if (!form.maxLtv || parseFloat(form.maxLtv) <= 0) return setError("Enter max LTV");
    if (!form.maxLltv || parseFloat(form.maxLltv) <= 0) return setError("Enter max LLTV");
    if (!form.durationValue || parseFloat(form.durationValue) <= 0) return setError("Enter duration");

    const dec = selectedAsset?.decimals ?? 6;
    const amountRaw = parseTokenAmount(form.amount, dec);
    const currentAllowance = (allowance as bigint | undefined) ?? 0n;

    if (currentAllowance < amountRaw) {
      setStep("approving");
      writeContract({
        address: form.borrowAsset as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CONTRACT_ADDRESS, MAX_UINT256],
      });
    } else {
      placeOrder();
    }
  }

  const isPrivateLoading = step.startsWith("private:");
  const isLoading = isWritePending || isTxLoading || isPrivateLoading;

  const PRIVATE_STEP_LABELS: Record<string, string> = {
    "private:deriving": "1/5 — Deriving burner account...",
    "private:gas":      "2/5 — Funding burner gas from shielded pool...",
    "private:funding":  "3/5 — Funding from shielded pool...",
    "private:approving":"4/5 — Approving token spend...",
    "private:placing":  "5/5 — Placing lend order...",
  };

  if (step === "done") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-terminal-green">
        <span className="text-2xl">✓</span>
        <span className="text-sm">Lend order placed!</span>
      </div>
    );
  }

  const balanceDisplay =
    balance && selectedAsset
      ? `Balance: ${(Number(balance as bigint) / 10 ** selectedAsset.decimals).toFixed(2)} ${selectedAsset.symbol}`
      : "";

  return (
    <div className="flex flex-col gap-3 p-3">
      <FieldRow label="Borrow Asset">
        <select
          value={form.borrowAsset}
          onChange={(e) => set("borrowAsset")(e.target.value)}
          className="w-full bg-terminal-panel border border-terminal-border px-2 py-1.5 text-terminal-text focus:border-terminal-green focus:outline-none text-xs"
        >
          <option value="">Select asset...</option>
          {assets?.borrowAssets.map((a) => (
            <option key={a.address} value={a.address}>{a.symbol}</option>
          ))}
        </select>
      </FieldRow>

      <FieldRow label="Acceptable Collateral">
        <div className="flex flex-wrap gap-1">
          {assets?.collateralAssets.map((asset) => {
            const selected = form.acceptableCollateral.includes(asset.address);
            return (
              <button
                key={asset.address}
                type="button"
                onClick={() => {
                  const next = selected
                    ? form.acceptableCollateral.filter((a) => a !== asset.address)
                    : [...form.acceptableCollateral, asset.address];
                  set("acceptableCollateral")(next);
                }}
                className={`px-2 py-1 text-xs border transition-colors ${
                  selected
                    ? "border-terminal-green text-terminal-green"
                    : "border-terminal-border text-terminal-muted hover:border-terminal-muted"
                }`}
              >
                {asset.symbol}
              </button>
            );
          })}
        </div>
      </FieldRow>

      <FieldRow
        label="Amount"
        hint={
          mode === "private" && form.borrowAsset && selectedAsset
            ? `Shielded: ${formatTokenAmount(
                (balances[form.borrowAsset.toLowerCase()] ?? 0n).toString(),
                selectedAsset.decimals
              )} ${selectedAsset.symbol}`
            : balanceDisplay
        }
      >
        <Input
          type="number"
          value={form.amount}
          onChange={set("amount")}
          placeholder="0.00"
        />
      </FieldRow>

      <FieldRow label="Min Rate" hint={form.minRate ? `${parsePctToBps(form.minRate)} bps` : ""}>
        <div className="relative">
          <Input
            type="number"
            value={form.minRate}
            onChange={set("minRate")}
            placeholder="4.5"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-terminal-muted text-xs">%</span>
        </div>
      </FieldRow>

      <FieldRow label="Max LTV" hint={form.maxLtv ? `${parseLtvToBps(form.maxLtv)} bps` : ""}>
        <div className="relative">
          <Input
            type="number"
            value={form.maxLtv}
            onChange={set("maxLtv")}
            placeholder="70"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-terminal-muted text-xs">%</span>
        </div>
      </FieldRow>

      <FieldRow label="Max LLTV" hint={form.maxLltv ? `${parseLtvToBps(form.maxLltv)} bps` : ""}>
        <div className="relative">
          <Input
            type="number"
            value={form.maxLltv}
            onChange={set("maxLltv")}
            placeholder="80"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-terminal-muted text-xs">%</span>
        </div>
      </FieldRow>

      <FieldRow
        label="Max Duration"
        hint={
          form.durationValue
            ? `${parseDurationToSeconds(form.durationValue, form.durationUnit).toLocaleString()}s`
            : ""
        }
      >
        <div className="flex gap-1">
          <Input
            type="number"
            value={form.durationValue}
            onChange={set("durationValue")}
            placeholder="90"
          />
          <select
            value={form.durationUnit}
            onChange={(e) => set("durationUnit")(e.target.value)}
            className="bg-terminal-panel border border-terminal-border px-2 text-terminal-text focus:border-terminal-green focus:outline-none text-xs"
          >
            <option value="days">d</option>
            <option value="months">mo</option>
            <option value="years">y</option>
          </select>
        </div>
      </FieldRow>

      {error && (
        <div className="text-terminal-red text-xs border border-terminal-red px-2 py-1.5">
          {error}
        </div>
      )}

      {step === "approving" && isLoading && (
        <div className="text-terminal-amber text-xs">
          Step 1/2 — Approving token spend...
        </div>
      )}
      {step === "placing" && isLoading && (
        <div className="text-terminal-amber text-xs">
          Step 2/2 — Placing lend order...
        </div>
      )}
      {isPrivateLoading && (
        <div className="text-terminal-green text-xs">
          {PRIVATE_STEP_LABELS[step] ?? "Processing..."}
        </div>
      )}

      {mode === "private" && !isPrivateLoading && (
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-terminal-muted uppercase tracking-wider">Burner</span>
          {BURNER_INDICES.map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => setSelectedBurnerIdx(i)}
              className={`px-2 py-0.5 text-[10px] font-bold border transition-colors ${
                selectedBurnerIdx === i
                  ? "border-terminal-green bg-terminal-green text-black"
                  : "border-terminal-border text-terminal-muted hover:border-terminal-green hover:text-terminal-green"
              }`}
            >
              #{i}
            </button>
          ))}
        </div>
      )}

      {!isConnected && mode === "public" ? (
        <div className="w-full py-2 border border-terminal-border text-terminal-muted text-xs text-center mt-1">
          Connect wallet to place orders
        </div>
      ) : (
        <button
          onClick={handleSubmit}
          disabled={isLoading}
          className="w-full py-2 bg-terminal-green text-black text-xs font-bold tracking-wider hover:bg-green-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-1"
        >
          {isLoading
            ? isPrivateLoading
              ? PRIVATE_STEP_LABELS[step] ?? "Processing..."
              : step === "approving"
              ? "Approving... (1/2)"
              : "Placing... (2/2)"
            : mode === "private"
            ? "Place Lend Order (Private)"
            : "Place Lend Order"}
        </button>
      )}
    </div>
  );
}
