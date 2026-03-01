"use client";

import { useState } from "react";
import { OrderBook } from "@/components/orderbook/OrderBook";
import { OrderPlacementForm } from "@/components/forms/OrderPlacementForm";
import { MyPositions } from "@/components/positions/MyPositions";

type Tab = "lend" | "borrow";

export default function TradingDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>("lend");

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

      {/* Panel 3: My Positions (right, 35%) */}
      <div className="w-[35%] min-w-0 bg-terminal-bg">
        <MyPositions />
      </div>
    </div>
  );
}
