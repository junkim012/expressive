"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useState } from "react";
import { truncateAddress } from "@/lib/format";
import { BatchStatusBadge } from "./BatchStatusBadge";
import { useWalletMode } from "@/lib/walletMode";

function ModeToggle() {
  const { mode, setMode } = useWalletMode();

  return (
    <div className="flex items-center border border-terminal-border text-[10px]">
      <button
        onClick={() => setMode("public")}
        className={`px-2 py-1 transition-colors ${
          mode === "public"
            ? "bg-terminal-green text-black font-bold"
            : "text-terminal-muted hover:text-terminal-text"
        }`}
      >
        PUBLIC
      </button>
      <button
        onClick={() => setMode("private")}
        className={`px-2 py-1 transition-colors border-l border-terminal-border ${
          mode === "private"
            ? "bg-terminal-amber text-black font-bold"
            : "text-terminal-muted hover:text-terminal-text"
        }`}
      >
        PRIVATE
      </button>
    </div>
  );
}

function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [showMenu, setShowMenu] = useState(false);
  const [showConnectors, setShowConnectors] = useState(false);

  if (isConnected && address) {
    return (
      <div className="relative">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="flex items-center gap-2 px-3 py-1.5 border border-terminal-green text-terminal-green text-xs hover:bg-terminal-green hover:text-black transition-colors"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-terminal-green" />
          {truncateAddress(address)}
        </button>
        {showMenu && (
          <div className="absolute right-0 top-full mt-1 w-40 bg-terminal-panel border border-terminal-border z-50 animate-fade-in">
            <div className="px-3 py-2 text-xs text-terminal-muted border-b border-terminal-border">
              {truncateAddress(address, 6)}
            </div>
            <button
              onClick={() => { navigator.clipboard.writeText(address); setShowMenu(false); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-terminal-border transition-colors"
            >
              Copy Address
            </button>
            <button
              onClick={() => { disconnect(); setShowMenu(false); }}
              className="w-full text-left px-3 py-2 text-xs text-terminal-red hover:bg-terminal-border transition-colors"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowConnectors(!showConnectors)}
        disabled={isPending}
        className="flex items-center gap-2 px-3 py-1.5 border border-terminal-border text-terminal-muted text-xs hover:border-terminal-green hover:text-terminal-green transition-colors disabled:opacity-50"
      >
        {isPending ? "Connecting..." : "Connect Wallet"}
      </button>
      {showConnectors && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-terminal-panel border border-terminal-border z-50 animate-fade-in">
          {connectors.map((connector) => (
            <button
              key={connector.id}
              onClick={() => { connect({ connector }); setShowConnectors(false); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-terminal-border transition-colors flex items-center gap-2"
            >
              <span className="w-1 h-1 rounded-full bg-terminal-muted" />
              {connector.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const NAV_LINKS = [
  { href: "/", label: "TRADE" },
  { href: "/positions", label: "POSITIONS" },
  { href: "/batch", label: "BATCH" },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="flex items-center justify-between h-10 px-4 border-b border-terminal-border bg-terminal-header shrink-0">
      {/* Brand */}
      <div className="flex items-center gap-6">
        <Link href="/" className="text-terminal-green text-sm font-bold tracking-widest">
          EL
        </Link>
        <nav className="flex items-center gap-1">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`px-3 py-1 text-xs tracking-wider transition-colors ${
                pathname === link.href
                  ? "text-terminal-green border-b border-terminal-green"
                  : "text-terminal-muted hover:text-terminal-text"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>

      {/* Center: batch status */}
      <div className="hidden md:flex items-center">
        <BatchStatusBadge />
      </div>

      {/* Right: mode toggle + wallet */}
      <div className="flex items-center gap-2">
        <ModeToggle />
        <WalletButton />
      </div>
    </header>
  );
}
