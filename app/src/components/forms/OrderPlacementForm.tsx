"use client";

import { useState } from "react";
import { LendOrderForm } from "./LendOrderForm";
import { BorrowOrderForm } from "./BorrowOrderForm";

type Tab = "lend" | "borrow";

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

export function OrderPlacementForm({ activeTab, onTabChange }: Props) {
  return (
    <div className="flex flex-col h-full bg-terminal-panel border border-terminal-border">
      {/* Panel header + tab switcher */}
      <div className="flex items-center border-b border-terminal-border shrink-0">
        <button
          onClick={() => onTabChange("lend")}
          className={`flex-1 py-2 text-xs font-semibold tracking-widest transition-colors border-b-2 ${
            activeTab === "lend"
              ? "border-terminal-green text-terminal-green"
              : "border-transparent text-terminal-muted hover:text-terminal-text"
          }`}
        >
          LEND
        </button>
        <button
          onClick={() => onTabChange("borrow")}
          className={`flex-1 py-2 text-xs font-semibold tracking-widest transition-colors border-b-2 ${
            activeTab === "borrow"
              ? "border-terminal-amber text-terminal-amber"
              : "border-transparent text-terminal-muted hover:text-terminal-text"
          }`}
        >
          BORROW
        </button>
      </div>

      {/* Form content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "lend" ? <LendOrderForm /> : <BorrowOrderForm />}
      </div>
    </div>
  );
}
