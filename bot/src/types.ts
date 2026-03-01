// ─────────────────────────────────────────────────────────────────────────────
// Order types (matching backend REST API shape from orders.ts)
// ─────────────────────────────────────────────────────────────────────────────

export interface LendOrder {
  orderId: number;
  orderType: 'lend';
  owner: string;
  borrowAsset: string;
  amount: string;          // BigInt as string
  filledAmount: string;    // BigInt as string
  status: string;
  acceptableCollateral: string[];
  minRate: number;         // basis points
  maxLtv: number;          // basis points
  maxDuration: number;     // seconds
  maxLltv: number;         // basis points
}

export interface BorrowOrder {
  orderId: number;
  orderType: 'borrow';
  owner: string;
  borrowAsset: string;
  amount: string;
  filledAmount: string;
  status: string;
  collateralAssets: string[];
  collateralAmounts: string[];  // BigInt strings
  maxRate: number;
  minLtv: number;
  minDuration: number;
  minLltv: number;
  fillOrKill: boolean;
}

export type Order = LendOrder | BorrowOrder;

export function isLendOrder(o: Order): o is LendOrder {
  return o.orderType === 'lend';
}

export function isBorrowOrder(o: Order): o is BorrowOrder {
  return o.orderType === 'borrow';
}

// ─────────────────────────────────────────────────────────────────────────────
// Matching types
// ─────────────────────────────────────────────────────────────────────────────

export interface CandidatePair {
  lendOrderId: number;
  borrowOrderId: number;
  amount: bigint;          // matchAmount = min(lendRemaining, borrowRemaining)
  surplus: bigint;         // (B.maxRate - L.minRate) * amount
  lendRate: number;        // L.minRate (bps)
  borrowRate: number;      // B.maxRate (bps)
}

export interface SubmitBatchArgs {
  pairs: { lendOrderId: bigint; borrowOrderId: bigint; amount: bigint }[];
  consumptions: { orderId: bigint; totalConsumed: bigint }[];
  totalSurplus: bigint;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chain state
// ─────────────────────────────────────────────────────────────────────────────

export interface WindowState {
  windowId: bigint;
  windowStart: bigint;
  batchWindowSeconds: bigint;
  currentWinner: string;
  currentBestSurplus: bigint;
}
