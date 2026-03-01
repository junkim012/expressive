"use client";

import { useState, useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { useUnlink } from "@unlink-xyz/react";
import { useAssets } from "@/hooks/useAssets";
import { NATIVE_TOKEN } from "@/lib/contract";
import { formatTokenAmount, parseTokenAmount } from "@/lib/format";

const INDICES = [0, 1, 2] as const;
type BurnerIndex = 0 | 1 | 2;
type BurnerTokenBals = { native: bigint; [tokenAddr: string]: bigint };

/**
 * Shows the first three deterministically derived burner addresses (index 0–2)
 * with their on-chain native MON balance and ERC-20 token balances, plus a
 * form to top them up from the shielded pool.
 */
export function BurnerPanel() {
  const { address } = useAccount();
  const {
    walletExists, balances, createBurner,
    burnerFund, burnerGetBalance, burnerGetTokenBalance, waitForConfirmation, refresh,
  } = useUnlink();

  const { data: assets } = useAssets();
  // Deduplicate across borrow + collateral asset lists
  const erc20Assets = [
    ...(assets?.borrowAssets ?? []),
    ...(assets?.collateralAssets ?? []),
  ].filter((a, i, arr) => arr.findIndex(x => x.address === a.address) === i);

  // Map of burnerIndex → derived address
  const [burnerAddrs, setBurnerAddrs] = useState<Partial<Record<BurnerIndex, string>>>({});
  // Map of burnerIndex → native + ERC-20 balances
  const [burnerBals, setBurnerBals] = useState<Partial<Record<BurnerIndex, BurnerTokenBals>>>({});

  const [amount, setAmount] = useState("");
  const [funding, setFunding] = useState<BurnerIndex | null>(null);
  const [done, setDone] = useState<BurnerIndex | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shieldedMon = walletExists ? (balances[NATIVE_TOKEN] ?? 0n) : 0n;

  // Stable refs so polling effect doesn't re-run when balances/assets update
  const burnerAddrsRef = useRef(burnerAddrs);
  burnerAddrsRef.current = burnerAddrs;
  const erc20AssetsRef = useRef(erc20Assets);
  erc20AssetsRef.current = erc20Assets;

  // Derive all three addresses once the wallet is ready
  useEffect(() => {
    if (!walletExists) return;
    Promise.all(
      INDICES.map(async (i) => {
        const b = await createBurner(i);
        return [i, b.address] as [BurnerIndex, string];
      })
    ).then((pairs) => {
      setBurnerAddrs(Object.fromEntries(pairs) as Record<BurnerIndex, string>);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletExists]);

  // Poll on-chain native MON + ERC-20 balances for each derived address every 5 s
  useEffect(() => {
    if (Object.keys(burnerAddrs).length === 0) return;

    let cancelled = false;
    async function poll() {
      const addrs = burnerAddrsRef.current;
      const tokenList = erc20AssetsRef.current;
      const pairs = await Promise.all(
        (Object.entries(addrs) as [string, string][]).map(async ([idx, addr]) => {
          const native = await burnerGetBalance(addr);
          const erc20Entries = await Promise.all(
            tokenList.map(async (a) => {
              const bal = await burnerGetTokenBalance(addr, a.address);
              return [a.address, bal] as [string, bigint];
            })
          );
          const bals: BurnerTokenBals = { native, ...Object.fromEntries(erc20Entries) };
          return [Number(idx) as BurnerIndex, bals] as [BurnerIndex, BurnerTokenBals];
        })
      );
      if (!cancelled) setBurnerBals(Object.fromEntries(pairs) as Record<BurnerIndex, BurnerTokenBals>);
    }

    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burnerAddrs]);

  async function handleFund(idx: BurnerIndex) {
    setError(null);
    const amountRaw = parseTokenAmount(amount, 18);
    if (amountRaw <= 0n) return setError("Enter an amount");
    if (shieldedMon < amountRaw) return setError("Insufficient shielded MON");

    setFunding(idx);
    try {
      const result = await burnerFund(idx, { token: NATIVE_TOKEN, amount: amountRaw });
      await waitForConfirmation(result.relayId);

      // Refresh shielded balance after funding
      await refresh();

      const addr = burnerAddrs[idx];
      if (addr) {
        const newNative = await burnerGetBalance(addr);
        setBurnerBals((prev) => ({
          ...prev,
          [idx]: { ...(prev[idx] ?? { native: 0n }), native: newNative },
        }));
      }
      setDone(idx);
      setTimeout(() => { setDone(null); setAmount(""); }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fund failed");
    } finally {
      setFunding(null);
    }
  }

  if (!address || !walletExists) return null;

  const addrsReady = Object.keys(burnerAddrs).length === INDICES.length;
  const colCount = 1 + erc20Assets.length; // MON + each ERC-20

  return (
    <div className="border-b border-terminal-border p-3 flex flex-col gap-2">
      <span className="text-[10px] tracking-wider text-terminal-muted uppercase">Burner Gas</span>

      {/* Shielded MON available to fund burners */}
      <div className="grid grid-cols-2 gap-1">
        <span className="text-[9px] text-terminal-muted uppercase tracking-wider">Shielded MON</span>
        <span className={`text-[10px] font-mono text-right ${shieldedMon > 0n ? "text-terminal-green" : "text-terminal-muted"}`}>
          {formatTokenAmount(shieldedMon.toString(), 18, 4)}
        </span>
      </div>

      {/* Burner table */}
      {!addrsReady ? (
        <span className="text-[10px] text-terminal-muted">Deriving addresses...</span>
      ) : (
        <div
          className="grid gap-x-2 gap-y-0.5 items-center"
          style={{ gridTemplateColumns: `1rem 1fr repeat(${colCount}, auto)` }}
        >
          {/* Header */}
          <span className="text-[9px] text-terminal-muted uppercase tracking-wider">#</span>
          <span className="text-[9px] text-terminal-muted uppercase tracking-wider">Address</span>
          <span className="text-[9px] text-terminal-muted uppercase tracking-wider text-right">MON</span>
          {erc20Assets.map((a) => (
            <span key={a.address} className="text-[9px] text-terminal-muted uppercase tracking-wider text-right">
              {a.symbol}
            </span>
          ))}
          {/* Rows */}
          {INDICES.map((i) => {
            const addr = burnerAddrs[i];
            const bals = burnerBals[i];
            const nativeBal = bals?.native ?? 0n;
            if (!addr) return null;
            return (
              <>
                <span key={`idx-${i}`} className="text-[10px] text-terminal-muted">{i}</span>
                <span key={`addr-${i}`} className="text-[10px] font-mono text-terminal-muted truncate" title={addr}>
                  {addr.slice(0, 8)}…{addr.slice(-4)}
                </span>
                <span key={`mon-${i}`} className={`text-[10px] font-mono text-right tabular-nums ${nativeBal > 0n ? "text-terminal-text" : "text-terminal-muted"}`}>
                  {formatTokenAmount(nativeBal.toString(), 18, 4)}
                </span>
                {erc20Assets.map((a) => {
                  const bal = bals?.[a.address] ?? 0n;
                  return (
                    <span key={`${i}-${a.address}`} className={`text-[10px] font-mono text-right tabular-nums ${bal > 0n ? "text-terminal-text" : "text-terminal-muted"}`}>
                      {formatTokenAmount(bal.toString(), a.decimals, 4)}
                    </span>
                  );
                })}
              </>
            );
          })}
        </div>
      )}

      {/* Fund form — shared amount, one button per burner */}
      {addrsReady && (
        <>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="MON amount"
            className="w-full bg-transparent border border-terminal-border px-2 py-1 text-terminal-text placeholder-terminal-muted focus:border-terminal-green focus:outline-none text-[10px]"
          />
          <div className="flex gap-1">
            {INDICES.map((i) => {
              const isFunding = funding === i;
              const isDone = done === i;
              return (
                <button
                  key={i}
                  onClick={() => handleFund(i)}
                  disabled={funding !== null}
                  className="flex-1 py-1 bg-terminal-green text-black text-[10px] font-bold hover:bg-green-400 disabled:opacity-50 transition-colors"
                >
                  {isDone ? "✓" : isFunding ? "..." : `#${i}`}
                </button>
              );
            })}
          </div>

          {error && <p className="text-[10px] text-terminal-red">{error}</p>}
          {funding !== null && (
            <p className="text-[10px] text-terminal-amber">
              Funding burner #{funding} from shielded pool...
            </p>
          )}
        </>
      )}
    </div>
  );
}
