"use client";

import { useState } from "react";
import { OrderBook } from "@/components/orderbook/OrderBook";
import { OrderPlacementForm } from "@/components/forms/OrderPlacementForm";
import { MyPositions } from "@/components/positions/MyPositions";
import { PrivatePositions } from "@/components/positions/PrivatePositions";
import { DepositPanel } from "@/components/unlink/DepositPanel";
import { BurnerPanel } from "@/components/unlink/BurnerPanel";
import { useWalletMode } from "@/lib/walletMode";

type Tab = "lend" | "borrow";

export default function TradingDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>("lend");
  const { mode } = useWalletMode();

  return (
    <div className="flex h-[calc(100vh-40px)] gap-px bg-terminal-border overflow-hidden">
      {/* Panel 1: Order Book (left, 40%) */}
      <div className="w-[40%] min-w-0 bg-terminal-bg">
        <OrderBook />
      </div>

      {/* Panel 2: Order Placement Form (center, 25%) */}
      <div className="w-[25%] min-w-0 bg-terminal-bg">
        <OrderPlacementForm activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      {/* Panel 3: Positions (right, 35%) */}
      <div className="w-[35%] min-w-0 bg-terminal-bg flex flex-col gap-px">
        {mode === "public" ? (
          <div className="flex-1 min-h-0 overflow-auto">
            <MyPositions />
          </div>
        ) : (
          <>
            <DepositPanel />
            <BurnerPanel />
            <div className="flex-1 min-h-0 overflow-auto">
              <PrivatePositions />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
