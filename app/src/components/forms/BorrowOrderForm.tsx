"use client";

import { useState } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { useAssets } from "@/hooks/useAssets";
import { CONTRACT_ADDRESS, CONTRACT_ABI, ERC20_ABI, MAX_UINT256 } from "@/lib/contract";
import { parsePctToBps, parseLtvToBps, parseDurationToSeconds, parseTokenAmount } from "@/lib/format";

interface CollateralRow {
  asset: string;
  amount: string;
}

interface FormState {
  borrowAsset: string;
  amount: string;
  collateralRows: CollateralRow[];
  maxRate: string;
  minLtv: string;
  minLltv: string;
  durationValue: string;
  durationUnit: "days" | "months" | "years";
  fillOrKill: boolean;
}

const EMPTY: FormState = {
  borrowAsset: "",
  amount: "",
  collateralRows: [{ asset: "", amount: "" }],
  maxRate: "",
  minLtv: "",
  minLltv: "",
  durationValue: "",
  durationUnit: "days",
  fillOrKill: false,
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
      className="w-full bg-transparent border border-terminal-border px-2 py-1.5 text-terminal-text placeholder-terminal-muted focus:border-terminal-amber focus:outline-none text-xs transition-colors"
    />
  );
}

export function BorrowOrderForm() {
  const { address, isConnected } = useAccount();
  const { data: assets } = useAssets();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"idle" | "approving" | "approving-idx" | "placing" | "done">("idle");
  const [approvingIndex, setApprovingIndex] = useState(0);

  const set = (key: keyof FormState) => (val: unknown) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const updateCollateralRow = (i: number, key: keyof CollateralRow, val: string) => {
    setForm((prev) => {
      const rows = [...prev.collateralRows];
      rows[i] = { ...rows[i], [key]: val };
      return { ...prev, collateralRows: rows };
    });
  };

  const addCollateralRow = () =>
    setForm((prev) => ({
      ...prev,
      collateralRows: [...prev.collateralRows, { asset: "", amount: "" }],
    }));

  const removeCollateralRow = (i: number) =>
    setForm((prev) => ({
      ...prev,
      collateralRows: prev.collateralRows.filter((_, idx) => idx !== i),
    }));

  const { writeContract, data: txHash, isPending: isWritePending, reset } = useWriteContract();
  const { isLoading: isTxLoading, isSuccess: isTxSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const isLoading = isWritePending || isTxLoading;

  // Collect collateral assets and amounts
  const validRows = form.collateralRows.filter((r) => r.asset && r.amount);

  function placeOrder() {
    const borrowAssetInfo = assets?.borrowAssets.find((a) => a.address === form.borrowAsset);
    const dec = borrowAssetInfo?.decimals ?? 6;
    const amountRaw = parseTokenAmount(form.amount, dec);
    const maxRate = BigInt(parsePctToBps(form.maxRate));
    const minLtv = BigInt(parseLtvToBps(form.minLtv));
    const minLltv = BigInt(parseLtvToBps(form.minLltv));
    const minDuration = BigInt(parseDurationToSeconds(form.durationValue, form.durationUnit));

    const collateralAssets = validRows.map((r) => r.asset as `0x${string}`);
    const collateralAmounts = validRows.map((r) => {
      const colAsset = assets?.collateralAssets.find((a) => a.address === r.asset);
      return parseTokenAmount(r.amount, colAsset?.decimals ?? 18);
    });

    setStep("placing");
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: "placeBorrowOrder",
      args: [
        form.borrowAsset as `0x${string}`,
        collateralAssets,
        collateralAmounts,
        maxRate,
        minLtv,
        minDuration,
        minLltv,
        amountRaw,
        form.fillOrKill,
      ],
    });
  }

  function approveNext(idx: number) {
    if (idx >= validRows.length) {
      placeOrder();
      return;
    }
    const row = validRows[idx];
    const colAsset = assets?.collateralAssets.find((a) => a.address === row.asset);
    const amount = parseTokenAmount(row.amount, colAsset?.decimals ?? 18);
    setApprovingIndex(idx);
    setStep("approving-idx");
    writeContract({
      address: row.asset as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [CONTRACT_ADDRESS, MAX_UINT256],
    });
  }

  if (isTxSuccess && step === "approving-idx") {
    reset();
    approveNext(approvingIndex + 1);
  }

  if (isTxSuccess && step === "placing") {
    setStep("done");
    setTimeout(() => {
      setForm(EMPTY);
      setStep("idle");
      reset();
    }, 3000);
  }

  async function handleSubmit() {
    setError(null);
    if (!address) return setError("Connect wallet first");
    if (!form.borrowAsset) return setError("Select borrow asset");
    if (!form.amount || parseFloat(form.amount) <= 0) return setError("Enter amount");
    if (validRows.length === 0) return setError("Add at least one collateral row");
    if (!form.maxRate || parseFloat(form.maxRate) <= 0) return setError("Enter max rate");
    if (!form.minLtv || parseFloat(form.minLtv) <= 0) return setError("Enter min LTV");
    if (!form.minLltv || parseFloat(form.minLltv) <= 0) return setError("Enter min LLTV");
    if (!form.durationValue || parseFloat(form.durationValue) <= 0) return setError("Enter duration");

    // Start approval chain
    setStep("approving");
    approveNext(0);
  }

  if (step === "done") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-terminal-amber">
        <span className="text-2xl">✓</span>
        <span className="text-sm">Borrow order placed!</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <FieldRow label="Borrow Asset">
        <select
          value={form.borrowAsset}
          onChange={(e) => set("borrowAsset")(e.target.value)}
          className="w-full bg-terminal-panel border border-terminal-border px-2 py-1.5 text-terminal-text focus:border-terminal-amber focus:outline-none text-xs"
        >
          <option value="">Select asset...</option>
          {assets?.borrowAssets.map((a) => (
            <option key={a.address} value={a.address}>{a.symbol}</option>
          ))}
        </select>
      </FieldRow>

      <FieldRow label="Amount Desired">
        <Input
          type="number"
          value={form.amount}
          onChange={set("amount")}
          placeholder="0.00"
        />
      </FieldRow>

      <FieldRow label="Collateral">
        <div className="flex flex-col gap-1.5">
          {form.collateralRows.map((row, i) => (
            <div key={i} className="flex gap-1">
              <select
                value={row.asset}
                onChange={(e) => updateCollateralRow(i, "asset", e.target.value)}
                className="flex-1 bg-terminal-panel border border-terminal-border px-2 py-1.5 text-terminal-text focus:border-terminal-amber focus:outline-none text-xs"
              >
                <option value="">Asset...</option>
                {assets?.collateralAssets.map((a) => (
                  <option key={a.address} value={a.address}>{a.symbol}</option>
                ))}
              </select>
              <input
                type="number"
                value={row.amount}
                onChange={(e) => updateCollateralRow(i, "amount", e.target.value)}
                placeholder="0.00"
                className="flex-1 bg-transparent border border-terminal-border px-2 py-1.5 text-terminal-text placeholder-terminal-muted focus:border-terminal-amber focus:outline-none text-xs"
              />
              {form.collateralRows.length > 1 && (
                <button
                  onClick={() => removeCollateralRow(i)}
                  className="px-2 text-terminal-muted hover:text-terminal-red transition-colors text-xs"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            onClick={addCollateralRow}
            className="text-[10px] text-terminal-muted hover:text-terminal-text transition-colors text-left"
          >
            + Add collateral
          </button>
        </div>
      </FieldRow>

      <FieldRow label="Max Rate" hint={form.maxRate ? `${parsePctToBps(form.maxRate)} bps` : ""}>
        <div className="relative">
          <Input
            type="number"
            value={form.maxRate}
            onChange={set("maxRate")}
            placeholder="7.0"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-terminal-muted text-xs">%</span>
        </div>
      </FieldRow>

      <FieldRow label="Min LTV" hint={form.minLtv ? `${parseLtvToBps(form.minLtv)} bps` : ""}>
        <div className="relative">
          <Input
            type="number"
            value={form.minLtv}
            onChange={set("minLtv")}
            placeholder="50"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-terminal-muted text-xs">%</span>
        </div>
      </FieldRow>

      <FieldRow label="Min LLTV" hint={form.minLltv ? `${parseLtvToBps(form.minLltv)} bps` : ""}>
        <div className="relative">
          <Input
            type="number"
            value={form.minLltv}
            onChange={set("minLltv")}
            placeholder="70"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-terminal-muted text-xs">%</span>
        </div>
      </FieldRow>

      <FieldRow
        label="Min Duration"
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
            className="bg-terminal-panel border border-terminal-border px-2 text-terminal-text focus:border-terminal-amber focus:outline-none text-xs"
          >
            <option value="days">d</option>
            <option value="months">mo</option>
            <option value="years">y</option>
          </select>
        </div>
      </FieldRow>

      <FieldRow label="Fill-or-Kill">
        <div className="flex items-center gap-2">
          <button
            onClick={() => set("fillOrKill")(!form.fillOrKill)}
            className={`w-8 h-4 rounded-full relative transition-colors ${
              form.fillOrKill ? "bg-terminal-amber" : "bg-terminal-border"
            }`}
          >
            <span
              className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                form.fillOrKill ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
          <span className="text-xs text-terminal-muted">
            {form.fillOrKill ? "ON — must fill fully or skip" : "OFF — partial fills allowed"}
          </span>
        </div>
      </FieldRow>

      {error && (
        <div className="text-terminal-red text-xs border border-terminal-red px-2 py-1.5">
          {error}
        </div>
      )}

      {(step === "approving" || step === "approving-idx") && isLoading && (
        <div className="text-terminal-amber text-xs">
          Approving collateral {approvingIndex + 1}/{validRows.length}...
        </div>
      )}

      {isConnected ? (
        <button
          onClick={handleSubmit}
          disabled={isLoading}
          className="w-full py-2 bg-terminal-amber text-black text-xs font-bold tracking-wider hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-1"
        >
          {isLoading ? "Processing..." : "Place Borrow Order"}
        </button>
      ) : (
        <div className="w-full py-2 border border-terminal-border text-terminal-muted text-xs text-center mt-1">
          Connect wallet to place orders
        </div>
      )}
    </div>
  );
}
