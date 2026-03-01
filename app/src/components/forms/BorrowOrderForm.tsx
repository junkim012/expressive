"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { useUnlink } from "@unlink-xyz/react";
import { useAssets } from "@/hooks/useAssets";
import { CONTRACT_ADDRESS, CONTRACT_ABI, ERC20_ABI, MAX_UINT256, NATIVE_TOKEN, GAS_RESERVE } from "@/lib/contract";
import { parsePctToBps, parseLtvToBps, parseDurationToSeconds, parseTokenAmount } from "@/lib/format";
import { encodeBurnerCall, waitForBurnerTx } from "@/lib/burnerClient";
import { addBurnerForWallet } from "@/lib/burnerStorage";
import { useWalletMode } from "@/lib/walletMode";
import { ensureAsset } from "@/lib/ensureAsset";

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

type BurnerIndex = 0 | 1 | 2;
const BURNER_INDICES = [0, 1, 2] as const;

export function BorrowOrderForm() {
  const { address, isConnected } = useAccount();
  const { data: assets } = useAssets();
  const {
    walletExists,
    balances,
    createBurner,
    burnerFund,
    burnerSend,
    burnerGetBalance,
    burnerGetTokenBalance,
    waitForConfirmation,
  } = useUnlink();
  const { mode } = useWalletMode();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [selectedBurnerIdx, setSelectedBurnerIdx] = useState<BurnerIndex>(0);

  // "idle" | "approving-N" (approving collateral index N) | "placing" | "done"
  // or private steps
  type Step =
    | "idle"
    | `approving-${number}`
    | "placing"
    | "done"
    | "private:gas"
    | `private:funding-${number}`
    | `private:approving-${number}`
    | "private:placing";
  const [step, setStep] = useState<Step>("idle");
  const stepRef = useRef<Step>("idle");
  stepRef.current = step;

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

  // Valid (non-empty) collateral rows from the current form state.
  // We store the snapshot used for the approval chain in a ref so the useEffect
  // closure always sees the rows that were validated at submit time.
  const validRowsRef = useRef<CollateralRow[]>([]);

  const placeOrder = useCallback(
    (rows: CollateralRow[]) => {
      const borrowAssetInfo = assets?.borrowAssets.find((a) => a.address === form.borrowAsset);
      const dec = borrowAssetInfo?.decimals ?? 6;
      const amountRaw = parseTokenAmount(form.amount, dec);
      const maxRate = BigInt(parsePctToBps(form.maxRate));
      const minLtv = BigInt(parseLtvToBps(form.minLtv));
      const minLltv = BigInt(parseLtvToBps(form.minLltv));
      const minDuration = BigInt(parseDurationToSeconds(form.durationValue, form.durationUnit));

      const collateralAssets = rows.map((r) => r.asset as `0x${string}`);
      const collateralAmounts = rows.map((r) => {
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
    },
    [form, assets, writeContract]
  );

  const approveAt = useCallback(
    (idx: number, rows: CollateralRow[]) => {
      if (idx >= rows.length) {
        placeOrder(rows);
        return;
      }
      const row = rows[idx];
      const colAsset = assets?.collateralAssets.find((a) => a.address === row.asset);
      const amount = parseTokenAmount(row.amount, colAsset?.decimals ?? 18);
      setStep(`approving-${idx}`);
      writeContract({
        address: row.asset as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CONTRACT_ADDRESS, MAX_UINT256],
      });
      void amount; // amount only needed for display; wagmi encodes MAX_UINT256
    },
    [assets, writeContract, placeOrder]
  );

  // Advance the approval chain (or move to place) after each tx confirms.
  useEffect(() => {
    if (!isTxSuccess || !txHash) return;

    const current = stepRef.current;
    const rows = validRowsRef.current;

    if (current.startsWith("approving-")) {
      const idx = parseInt(current.replace("approving-", ""), 10);
      reset();
      approveAt(idx + 1, rows);
    } else if (current === "placing") {
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
    if (!form.amount || parseFloat(form.amount) <= 0) return setError("Enter amount");
    if (!form.maxRate || parseFloat(form.maxRate) <= 0) return setError("Enter max rate");
    if (!form.minLtv || parseFloat(form.minLtv) <= 0) return setError("Enter min LTV");
    if (!form.minLltv || parseFloat(form.minLltv) <= 0) return setError("Enter min LLTV");
    if (!form.durationValue || parseFloat(form.durationValue) <= 0) return setError("Enter duration");

    const validRows = form.collateralRows.filter((r) => r.asset && r.amount);
    if (validRows.length === 0) return setError("Add at least one collateral row");

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

    const deps = { balances, burnerGetBalance, burnerGetTokenBalance, burnerFund, waitForConfirmation };

    try {
      // Derive burner
      const burnerIndex = selectedBurnerIdx;
      const burner = await createBurner(burnerIndex);

      // Ensure burner has gas (tops up shortfall only)
      setStep("private:gas");
      await ensureAsset(deps, burnerIndex, burner.address, NATIVE_TOKEN, GAS_RESERVE, "MON");

      // Ensure burner has each collateral asset (tops up shortfall only)
      for (let i = 0; i < validRows.length; i++) {
        setStep(`private:funding-${i}`);
        const colAsset = assets?.collateralAssets.find((a) => a.address === validRows[i].asset);
        await ensureAsset(deps, burnerIndex, burner.address, validRows[i].asset, collateralAmounts[i], colAsset?.symbol ?? "");
      }

      // Approve each collateral asset
      for (let i = 0; i < validRows.length; i++) {
        setStep(`private:approving-${i}`);
        const { txHash } = await burnerSend(
          burnerIndex,
          encodeBurnerCall({
            address: validRows[i].asset as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [CONTRACT_ADDRESS, collateralAmounts[i]],
          })
        );
        await waitForBurnerTx(txHash);
      }

      // Place borrow order
      setStep("private:placing");
      const { txHash: placeTxHash } = await burnerSend(
        burnerIndex,
        encodeBurnerCall({
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
        })
      );
      await waitForBurnerTx(placeTxHash);

      addBurnerForWallet(address, {
        burnerIndex,
        burnerAddress: burner.address,
        orderType: "borrow",
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
    if (!form.amount || parseFloat(form.amount) <= 0) return setError("Enter amount");
    if (!form.maxRate || parseFloat(form.maxRate) <= 0) return setError("Enter max rate");
    if (!form.minLtv || parseFloat(form.minLtv) <= 0) return setError("Enter min LTV");
    if (!form.minLltv || parseFloat(form.minLltv) <= 0) return setError("Enter min LLTV");
    if (!form.durationValue || parseFloat(form.durationValue) <= 0) return setError("Enter duration");

    const validRows = form.collateralRows.filter((r) => r.asset && r.amount);
    if (validRows.length === 0) return setError("Add at least one collateral row");

    // Snapshot the validated rows for use in the useEffect closure.
    validRowsRef.current = validRows;

    // Start the approval chain. Each approve confirms → useEffect advances to next.
    approveAt(0, validRows);
  }

  const isPrivateLoading =
    step === "private:gas" ||
    step.startsWith("private:funding-") ||
    step.startsWith("private:approving-") ||
    step === "private:placing";
  const isLoading = isWritePending || isTxLoading || isPrivateLoading;

  const approvalIndex = step.startsWith("approving-")
    ? parseInt(step.replace("approving-", ""), 10)
    : null;
  const totalApprovals = validRowsRef.current.length;
  const totalCollateral = validRowsRef.current.length;

  function privateStepLabel(): string {
    if (step === "private:gas") return "Funding burner gas from shielded pool...";
    if (step.startsWith("private:funding-")) {
      const i = parseInt(step.replace("private:funding-", ""), 10);
      return `Funding collateral ${i + 1}/${totalCollateral} from pool...`;
    }
    if (step.startsWith("private:approving-")) {
      const i = parseInt(step.replace("private:approving-", ""), 10);
      return `Approving collateral ${i + 1}/${totalCollateral}...`;
    }
    if (step === "private:placing") return "Placing borrow order...";
    return "Processing...";
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

      {approvalIndex !== null && isLoading && !isPrivateLoading && (
        <div className="text-terminal-amber text-xs">
          Approving collateral {approvalIndex + 1}/{totalApprovals}...
        </div>
      )}
      {step === "placing" && isLoading && !isPrivateLoading && (
        <div className="text-terminal-amber text-xs">Placing borrow order...</div>
      )}
      {isPrivateLoading && (
        <div className="text-terminal-amber text-xs">{privateStepLabel()}</div>
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
                  ? "border-terminal-amber bg-terminal-amber text-black"
                  : "border-terminal-border text-terminal-muted hover:border-terminal-amber hover:text-terminal-amber"
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
          className="w-full py-2 bg-terminal-amber text-black text-xs font-bold tracking-wider hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-1"
        >
          {isLoading
            ? isPrivateLoading
              ? privateStepLabel()
              : approvalIndex !== null
              ? `Approving ${approvalIndex + 1}/${totalApprovals}...`
              : "Placing..."
            : mode === "private"
            ? "Place Borrow Order (Private)"
            : "Place Borrow Order"}
        </button>
      )}
    </div>
  );
}
