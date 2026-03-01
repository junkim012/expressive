"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { OrderBook } from "@/components/orderbook/OrderBook";
import { OrderPlacementForm } from "@/components/forms/OrderPlacementForm";
import { MyPositions } from "@/components/positions/MyPositions";
import { PrivatePositions } from "@/components/positions/PrivatePositions";
import { DepositPanel } from "@/components/unlink/DepositPanel";
import { BurnerPanel } from "@/components/unlink/BurnerPanel";
import { useWalletMode } from "@/lib/walletMode";

type Tab = "lend" | "borrow";

const MIN_PANEL_PCT = 12;

export default function TradingDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>("lend");
  const { mode } = useWalletMode();

  const containerRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState([40, 25, 35]);
  const draggingRef = useRef<number | null>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

  const handleMouseDown = useCallback(
    (dividerIndex: number) => (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = dividerIndex;
      setDraggingIdx(dividerIndex);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    []
  );

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (draggingRef.current === null || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;

      setWidths((prev) => {
        const next = [...prev];
        if (draggingRef.current === 0) {
          const newLeft = pct;
          const newCenter = prev[0] + prev[1] - pct;
          if (newLeft < MIN_PANEL_PCT || newCenter < MIN_PANEL_PCT) return prev;
          next[0] = newLeft;
          next[1] = newCenter;
        } else {
          const newCenter = pct - prev[0];
          const newRight = 100 - pct;
          if (newCenter < MIN_PANEL_PCT || newRight < MIN_PANEL_PCT) return prev;
          next[1] = newCenter;
          next[2] = newRight;
        }
        return next;
      });
    }

    function handleMouseUp() {
      draggingRef.current = null;
      setDraggingIdx(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleClass = (idx: number) =>
    `w-1 shrink-0 cursor-col-resize transition-colors ${
      draggingIdx === idx
        ? "bg-terminal-green/40"
        : "bg-terminal-border hover:bg-terminal-green/40"
    }`;

  return (
    <div
      ref={containerRef}
      className="flex h-[calc(100vh-40px)] overflow-hidden"
    >
      {/* Panel 1: Order Book */}
      <div
        className="min-w-0 bg-terminal-bg overflow-hidden"
        style={{ width: `${widths[0]}%` }}
      >
        <OrderBook />
      </div>

      {/* Resize handle 1 */}
      <div className={handleClass(0)} onMouseDown={handleMouseDown(0)} />

      {/* Panel 2: Order Placement Form */}
      <div
        className="min-w-0 bg-terminal-bg overflow-hidden"
        style={{ width: `${widths[1]}%` }}
      >
        <OrderPlacementForm activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      {/* Resize handle 2 */}
      <div className={handleClass(1)} onMouseDown={handleMouseDown(1)} />

      {/* Panel 3: Positions */}
      <div
        className="min-w-0 bg-terminal-bg flex flex-col gap-px overflow-hidden"
        style={{ width: `${widths[2]}%` }}
      >
        <DepositPanel />
        {mode === "public" ? (
          <div className="flex-1 min-h-0 overflow-auto">
            <MyPositions />
          </div>
        ) : (
          <>
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
