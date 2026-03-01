"use client";

import { useState } from "react";
import { useUnlink } from "@unlink-xyz/react";

/**
 * Inline wallet setup flow shown when Unlink wallet doesn't exist yet.
 * Handles both create-new and import-existing paths.
 * Calls onComplete when the user is done — parent is responsible for hiding.
 */
export function UnlinkWalletSetup({ onComplete }: { onComplete: () => void }) {
  const { createWallet, importWallet } = useUnlink();

  type View = "prompt" | "creating" | "show-mnemonic" | "import" | "done";
  const [view, setView] = useState<View>("prompt");
  const [mnemonic, setMnemonic] = useState("");
  const [importInput, setImportInput] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      setView("creating");
      const result = await createWallet();
      setMnemonic(result.mnemonic);
      setView("show-mnemonic");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create wallet");
      setView("prompt");
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    if (!importInput.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await importWallet(importInput.trim());
      setView("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid mnemonic");
    } finally {
      setBusy(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(mnemonic);
  }

  if (view === "done") { onComplete(); return null; }

  return (
    <div className="border border-terminal-border p-3 flex flex-col gap-2 bg-black/30">
      {view === "prompt" && (
        <>
          <p className="text-[10px] text-terminal-muted leading-relaxed">
            Private orders require an Unlink wallet. Your mnemonic is stored
            locally — back it up to recover positions across devices.
          </p>
          {error && (
            <p className="text-[10px] text-terminal-red">{error}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={busy}
              className="flex-1 py-1.5 bg-terminal-green text-black text-[10px] font-bold tracking-wider hover:bg-green-400 disabled:opacity-50 transition-colors"
            >
              Create New Wallet
            </button>
            <button
              onClick={() => setView("import")}
              disabled={busy}
              className="flex-1 py-1.5 border border-terminal-border text-terminal-muted text-[10px] hover:border-terminal-muted hover:text-terminal-text transition-colors"
            >
              Import Mnemonic
            </button>
          </div>
        </>
      )}

      {view === "creating" && (
        <p className="text-[10px] text-terminal-muted">Generating wallet...</p>
      )}

      {view === "show-mnemonic" && (
        <>
          <p className="text-[10px] text-terminal-amber font-semibold tracking-wider uppercase">
            Back up your mnemonic
          </p>
          <p className="text-[10px] text-terminal-muted leading-relaxed">
            This is the only time you will see it. Loss of this phrase means
            loss of all private positions.
          </p>
          <div className="bg-black border border-terminal-border px-2 py-2 font-mono text-[10px] text-terminal-text leading-relaxed break-all select-all">
            {mnemonic}
          </div>
          <button
            onClick={handleCopy}
            className="text-[10px] text-terminal-muted hover:text-terminal-text transition-colors text-left"
          >
            Copy to clipboard
          </button>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="accent-terminal-green"
            />
            <span className="text-[10px] text-terminal-muted">
              I have saved my mnemonic securely
            </span>
          </label>
          <button
            onClick={() => setView("done")}
            disabled={!confirmed}
            className="w-full py-1.5 bg-terminal-green text-black text-[10px] font-bold tracking-wider hover:bg-green-400 disabled:opacity-50 transition-colors"
          >
            Done
          </button>
        </>
      )}

      {view === "import" && (
        <>
          <p className="text-[10px] text-terminal-muted">
            Paste your 12 or 24 word mnemonic phrase.
          </p>
          {error && (
            <p className="text-[10px] text-terminal-red">{error}</p>
          )}
          <textarea
            value={importInput}
            onChange={(e) => setImportInput(e.target.value)}
            placeholder="word1 word2 word3 ..."
            rows={3}
            className="w-full bg-transparent border border-terminal-border px-2 py-1.5 text-terminal-text placeholder-terminal-muted focus:border-terminal-green focus:outline-none text-[10px] font-mono resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={handleImport}
              disabled={busy || !importInput.trim()}
              className="flex-1 py-1.5 bg-terminal-green text-black text-[10px] font-bold tracking-wider hover:bg-green-400 disabled:opacity-50 transition-colors"
            >
              {busy ? "Importing..." : "Import"}
            </button>
            <button
              onClick={() => setView("prompt")}
              className="flex-1 py-1.5 border border-terminal-border text-terminal-muted text-[10px] hover:border-terminal-muted hover:text-terminal-text transition-colors"
            >
              Back
            </button>
          </div>
        </>
      )}
    </div>
  );
}
