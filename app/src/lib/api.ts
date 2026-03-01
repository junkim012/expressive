import type {
  LendOrder,
  BorrowOrder,
  Order,
  Loan,
  LoanWithEvents,
  Batch,
  AssetsResponse,
} from "@/types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}/api/v1${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v) url.searchParams.set(k, v);
    });
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

// Orders
export async function fetchOrders(params?: {
  status?: "open" | "filled";
  owner?: string;
  type?: "lend" | "borrow";
}): Promise<Order[]> {
  const p: Record<string, string> = {};
  if (params?.status) p.status = params.status;
  if (params?.owner) p.owner = params.owner;
  if (params?.type) p.type = params.type;
  const res = await get<{ orders: Order[] }>("/orders", p);
  return res.orders;
}

export async function fetchLendOrders(params?: {
  status?: "open" | "filled";
  owner?: string;
}): Promise<LendOrder[]> {
  const orders = await fetchOrders({ ...params, type: "lend" });
  return orders as LendOrder[];
}

export async function fetchBorrowOrders(params?: {
  status?: "open" | "filled";
  owner?: string;
}): Promise<BorrowOrder[]> {
  const orders = await fetchOrders({ ...params, type: "borrow" });
  return orders as BorrowOrder[];
}

// Loans
export async function fetchLoans(params?: {
  lender?: string;
  borrower?: string;
  status?: "active" | "repaid" | "liquidated" | "defaulted";
}): Promise<Loan[]> {
  const p: Record<string, string> = {};
  if (params?.lender) p.lender = params.lender;
  if (params?.borrower) p.borrower = params.borrower;
  if (params?.status) p.status = params.status;
  const res = await get<{ loans: Loan[] }>("/loans", p);
  return res.loans;
}

export async function fetchLoan(loanId: string): Promise<LoanWithEvents> {
  return get<LoanWithEvents>(`/loans/${loanId}`);
}

// Batches
export async function fetchBatches(params?: {
  page?: number;
  limit?: number;
}): Promise<{ batches: Batch[]; total: number; page: number; limit: number }> {
  const p: Record<string, string> = {};
  if (params?.page) p.page = String(params.page);
  if (params?.limit) p.limit = String(params.limit);
  return get("/batches", p);
}

// Batch loans
export async function fetchBatchLoans(windowId: string): Promise<Loan[]> {
  const res = await get<{ loans: Loan[] }>(`/batches/${windowId}/loans`);
  return res.loans;
}

// Assets
export async function fetchAssets(): Promise<AssetsResponse> {
  return get<AssetsResponse>("/assets");
}
