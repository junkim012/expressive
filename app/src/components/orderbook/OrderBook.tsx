"use client";

import { useState, useMemo } from "react";
import { useOrderBook } from "@/hooks/useOrderBook";
import { useAssets } from "@/hooks/useAssets";
import type { LendOrder, BorrowOrder } from "@/types";
import {
  formatRate,
  formatLtv,
  formatDuration,
  formatTokenAmount,
  fillPercent,
  truncateAddress,
} from "@/lib/format";

// ── Filter state ─────────────────────────────────────────────────────────────

interface Filters {
  minRate: string;
  maxRate: string;
  minLtv: string;
  maxLtv: string;
  minLltv: string;
  maxLltv: string;
  minDuration: string;
  maxDuration: string;
  collateralAssets: string[];
}

const defaultFilters: Filters = {
  minRate: "",
  maxRate: "",
  minLtv: "",
  maxLtv: "",
  minLltv: "",
  maxLltv: "",
  minDuration: "",
  maxDuration: "",
  collateralAssets: [],
};

// ── Lend orders table ─────────────────────────────────────────────────────────

function LendOrderRow({ order, assets }: { order: LendOrder; assets: ReturnType<typeof useAssets>["data"] }) {
  const borrowAsset = assets?.borrowAssets.find(
    (a) => a.address.toLowerCase() === order.borrowAsset.toLowerCase()
  );
  const pct = fillPercent(order.filledAmount, order.amount);
  const filled = pct >= 99.99;

  return (
    <tr className={`border-b border-terminal-border hover:bg-white/[0.02] transition-colors ${filled ? "opacity-40" : ""}`}>
      <td className="py-1 px-2 text-terminal-green tabular-nums">{formatRate(order.minRate)}</td>
      <td className="py-1 px-2 tabular-nums">
        <div>{formatTokenAmount(order.amount, borrowAsset?.decimals ?? 6, 0)} {borrowAsset?.symbol ?? "?"}</div>
        <div className="text-terminal-muted text-[10px]">{pct.toFixed(1)}% filled</div>
      </td>
      <td className="py-1 px-2 text-terminal-muted">{formatLtv(order.maxLtv)}</td>
      <td className="py-1 px-2 text-terminal-muted">{formatLtv(order.maxLltv)}</td>
      <td className="py-1 px-2 text-terminal-muted">{formatDuration(order.maxDuration)}</td>
      <td className="py-1 px-2 text-terminal-muted text-[10px]">
        {order.acceptableCollateral.map((addr) => {
          const c = assets?.collateralAssets.find((a) => a.address.toLowerCase() === addr.toLowerCase());
          return c ? c.symbol : truncateAddress(addr, 3);
        }).join(", ")}
      </td>
    </tr>
  );
}

function BorrowOrderRow({ order, assets }: { order: BorrowOrder; assets: ReturnType<typeof useAssets>["data"] }) {
  const borrowAsset = assets?.borrowAssets.find(
    (a) => a.address.toLowerCase() === order.borrowAsset.toLowerCase()
  );
  const pct = fillPercent(order.filledAmount, order.amount);
  const filled = pct >= 99.99;

  return (
    <tr className={`border-b border-terminal-border hover:bg-white/[0.02] transition-colors ${filled ? "opacity-40" : ""}`}>
      <td className="py-1 px-2 text-terminal-amber tabular-nums">{formatRate(order.maxRate)}</td>
      <td className="py-1 px-2 tabular-nums">
        <div>{formatTokenAmount(order.amount, borrowAsset?.decimals ?? 6, 0)} {borrowAsset?.symbol ?? "?"}</div>
        <div className="text-terminal-muted text-[10px]">{pct.toFixed(1)}% filled</div>
      </td>
      <td className="py-1 px-2 text-terminal-muted">{formatLtv(order.minLtv)}</td>
      <td className="py-1 px-2 text-terminal-muted">{formatLtv(order.minLltv)}</td>
      <td className="py-1 px-2 text-terminal-muted">{formatDuration(order.minDuration)}</td>
      <td className="py-1 px-2 text-terminal-muted text-[10px]">
        {order.collateralAssets.map((addr) => {
          const c = assets?.collateralAssets.find((a) => a.address.toLowerCase() === addr.toLowerCase());
          return c ? c.symbol : truncateAddress(addr, 3);
        }).join(", ")}
        {order.fillOrKill && <span className="ml-1 text-terminal-amber">FOK</span>}
      </td>
    </tr>
  );
}

const COL_HEADERS = ["Rate", "Amount", "LTV", "LLTV", "Duration", "Collateral"];

function OrderTable<T extends LendOrder | BorrowOrder>({
  orders,
  renderRow,
  emptyMessage,
  connected,
}: {
  orders: T[];
  renderRow: (order: T) => React.ReactNode;
  emptyMessage: string;
  connected: boolean;
}) {
  return (
    <div className="overflow-auto h-full">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-terminal-panel z-10">
          <tr className="border-b border-terminal-border-bright">
            {COL_HEADERS.map((h) => (
              <th
                key={h}
                className="py-1 px-2 text-left text-terminal-muted font-normal tracking-wider text-[10px] uppercase"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orders.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-8 text-center text-terminal-muted">
                {!connected ? (
                  <span className="text-terminal-amber">⚠ No backend connection</span>
                ) : (
                  emptyMessage
                )}
              </td>
            </tr>
          ) : (
            orders.map((order) => renderRow(order))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

function FilterBar({
  filters,
  setFilters,
  collateralAssets,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  collateralAssets: { address: string; symbol: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-2 p-2 border-b border-terminal-border text-xs">
      <div className="flex items-center gap-1">
        <span className="text-terminal-muted">Rate:</span>
        <input
          type="text"
          placeholder="min%"
          value={filters.minRate}
          onChange={(e) => setFilters({ ...filters, minRate: e.target.value })}
          className="w-14 bg-transparent border border-terminal-border px-1 py-0.5 text-terminal-text placeholder-terminal-muted focus:border-terminal-green"
        />
        <span className="text-terminal-muted">–</span>
        <input
          type="text"
          placeholder="max%"
          value={filters.maxRate}
          onChange={(e) => setFilters({ ...filters, maxRate: e.target.value })}
          className="w-14 bg-transparent border border-terminal-border px-1 py-0.5 text-terminal-text placeholder-terminal-muted focus:border-terminal-green"
        />
      </div>
      <div className="flex items-center gap-1">
        <span className="text-terminal-muted">LTV:</span>
        <input
          type="text"
          placeholder="min%"
          value={filters.minLtv}
          onChange={(e) => setFilters({ ...filters, minLtv: e.target.value })}
          className="w-14 bg-transparent border border-terminal-border px-1 py-0.5 text-terminal-text placeholder-terminal-muted focus:border-terminal-green"
        />
        <span className="text-terminal-muted">–</span>
        <input
          type="text"
          placeholder="max%"
          value={filters.maxLtv}
          onChange={(e) => setFilters({ ...filters, maxLtv: e.target.value })}
          className="w-14 bg-transparent border border-terminal-border px-1 py-0.5 text-terminal-text placeholder-terminal-muted focus:border-terminal-green"
        />
      </div>
      {collateralAssets.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-terminal-muted">Collateral:</span>
          {collateralAssets.map((asset) => {
            const selected = filters.collateralAssets.includes(asset.address);
            return (
              <button
                key={asset.address}
                onClick={() => {
                  const next = selected
                    ? filters.collateralAssets.filter((a) => a !== asset.address)
                    : [...filters.collateralAssets, asset.address];
                  setFilters({ ...filters, collateralAssets: next });
                }}
                className={`px-2 py-0.5 border text-[10px] transition-colors ${
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
      )}
      <button
        onClick={() => setFilters(defaultFilters)}
        className="ml-auto text-terminal-muted hover:text-terminal-text text-[10px] transition-colors"
      >
        Clear
      </button>
    </div>
  );
}

// ── Main OrderBook component ───────────────────────────────────────────────────

export function OrderBook() {
  const { lendOrders, borrowOrders, connected } = useOrderBook();
  const { data: assets } = useAssets();
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [showFilters, setShowFilters] = useState(false);

  // Apply filters
  const filteredLend = useMemo(() => {
    let orders = lendOrders.filter((o) => o.status === "open");

    if (filters.minRate) orders = orders.filter((o) => o.minRate >= parseFloat(filters.minRate) * 100);
    if (filters.maxRate) orders = orders.filter((o) => o.minRate <= parseFloat(filters.maxRate) * 100);
    if (filters.minLtv) orders = orders.filter((o) => o.maxLtv >= parseFloat(filters.minLtv) * 100);
    if (filters.maxLtv) orders = orders.filter((o) => o.maxLtv <= parseFloat(filters.maxLtv) * 100);
    if (filters.collateralAssets.length > 0) {
      orders = orders.filter((o) =>
        filters.collateralAssets.every((addr) =>
          o.acceptableCollateral.some((c) => c.toLowerCase() === addr.toLowerCase())
        )
      );
    }

    // Sort by minRate descending (highest rate lenders first)
    return orders.sort((a, b) => b.minRate - a.minRate);
  }, [lendOrders, filters]);

  const filteredBorrow = useMemo(() => {
    let orders = borrowOrders.filter((o) => o.status === "open");

    if (filters.minRate) orders = orders.filter((o) => o.maxRate >= parseFloat(filters.minRate) * 100);
    if (filters.maxRate) orders = orders.filter((o) => o.maxRate <= parseFloat(filters.maxRate) * 100);
    if (filters.minLtv) orders = orders.filter((o) => o.minLtv >= parseFloat(filters.minLtv) * 100);
    if (filters.maxLtv) orders = orders.filter((o) => o.minLtv <= parseFloat(filters.maxLtv) * 100);
    if (filters.collateralAssets.length > 0) {
      orders = orders.filter((o) =>
        filters.collateralAssets.some((addr) =>
          o.collateralAssets.some((c) => c.toLowerCase() === addr.toLowerCase())
        )
      );
    }

    // Sort by maxRate ascending (lowest rate borrowers first — best deal for lenders)
    return orders.sort((a, b) => a.maxRate - b.maxRate);
  }, [borrowOrders, filters]);

  return (
    <div className="flex flex-col h-full bg-terminal-panel border border-terminal-border">
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-terminal-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tracking-widest text-terminal-text">ORDER BOOK</span>
          <span
            className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-terminal-green animate-pulse" : "bg-terminal-red"}`}
            title={connected ? "Live" : "Disconnected"}
          />
        </div>
        <div className="flex items-center gap-3 text-xs text-terminal-muted">
          <span>{filteredLend.length}L / {filteredBorrow.length}B</span>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`text-[10px] tracking-wider transition-colors ${showFilters ? "text-terminal-green" : "text-terminal-muted hover:text-terminal-text"}`}
          >
            FILTERS {showFilters ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <FilterBar
          filters={filters}
          setFilters={setFilters}
          collateralAssets={assets?.collateralAssets ?? []}
        />
      )}

      {/* Split view: lend (left) | borrow (right) */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Lend side */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-terminal-border">
          <div className="px-3 py-1.5 border-b border-terminal-border shrink-0">
            <span className="text-[10px] tracking-widest text-terminal-green font-semibold">
              LEND ORDERS ({filteredLend.length})
            </span>
          </div>
          <OrderTable
            orders={filteredLend}
            renderRow={(order) => (
              <LendOrderRow key={order.orderId} order={order} assets={assets} />
            )}
            emptyMessage="No open lend orders"
            connected={connected}
          />
        </div>

        {/* Borrow side */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-3 py-1.5 border-b border-terminal-border shrink-0">
            <span className="text-[10px] tracking-widest text-terminal-amber font-semibold">
              BORROW ORDERS ({filteredBorrow.length})
            </span>
          </div>
          <OrderTable
            orders={filteredBorrow}
            renderRow={(order) => (
              <BorrowOrderRow key={order.orderId} order={order} assets={assets} />
            )}
            emptyMessage="No open borrow orders"
            connected={connected}
          />
        </div>
      </div>
    </div>
  );
}
