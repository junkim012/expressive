// ── Order types ──────────────────────────────────────────────────────────────

export type OrderType = "lend" | "borrow";
export type OrderStatus = "open" | "filled";

export interface LendOrder {
  orderId: string;
  orderType: "lend";
  owner: string;
  borrowAsset: string;
  acceptableCollateral: string[];
  minRate: number;          // basis points
  maxLtv: number;           // basis points
  maxDuration: number;      // seconds
  maxLltv: number;          // basis points
  amount: string;           // uint256 as string
  filledAmount: string;
  status: OrderStatus;
  placedAt: number;         // unix timestamp
}

export interface BorrowOrder {
  orderId: string;
  orderType: "borrow";
  owner: string;
  borrowAsset: string;
  collateralAssets: string[];
  collateralAmounts: string[];
  maxRate: number;
  minLtv: number;
  minDuration: number;      // seconds
  minLltv: number;
  fillOrKill: boolean;
  amount: string;
  filledAmount: string;
  status: OrderStatus;
  placedAt: number;
}

export type Order = LendOrder | BorrowOrder;

// ── Loan types ────────────────────────────────────────────────────────────────

export type LoanStatus = "active" | "repaid" | "liquidated" | "defaulted";

export interface Loan {
  loanId: string;
  lendOrderId: string;
  borrowOrderId: string;
  lender: string;
  borrower: string;
  borrowAsset: string;
  principal: string;        // uint256 as string
  rate: number;             // basis points
  ltv: number;              // basis points
  lltv: number;             // basis points
  maturityDate: number;     // unix timestamp
  originationDate: number;  // unix timestamp
  status: LoanStatus;
  txHash: string;
}

export interface LoanEvent {
  eventType: "repaid" | "liquidated" | "defaulted";
  liquidator?: string;
  blockNumber: number;
  blockTime: number;
  txHash: string;
}

export interface LoanWithEvents {
  loan: Loan;
  events: LoanEvent[];
}

// ── Batch types ───────────────────────────────────────────────────────────────

export interface Batch {
  windowId: string;
  solver: string | null;
  totalSurplus: string;
  pairCount: number;
  executedAt: number;
  txHash: string;
}

// ── Asset types ───────────────────────────────────────────────────────────────

export interface AssetInfo {
  address: string;
  symbol: string;
  decimals: number;
  logoUrl: string;
}

export interface AssetsResponse {
  borrowAssets: AssetInfo[];
  collateralAssets: AssetInfo[];
}

// ── WebSocket message types ───────────────────────────────────────────────────

export interface WsSnapshot {
  type: "snapshot";
  data: {
    lendOrders: LendOrder[];
    borrowOrders: BorrowOrder[];
  };
}

export interface WsUpdate {
  type: "update";
  data: {
    newOrders: Order[];
    updatedOrders: Order[];
  };
}

export type WsMessage = WsSnapshot | WsUpdate;

// ── Contract pair type ────────────────────────────────────────────────────────

export interface WinningPair {
  lendOrderId: bigint;
  borrowOrderId: bigint;
  amount: bigint;
}
