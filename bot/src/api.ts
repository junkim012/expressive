import type { Order, LendOrder, BorrowOrder } from './types';
import { isLendOrder, isBorrowOrder } from './types';

interface OrdersResponse {
  orders: Order[];
}

export async function fetchOpenOrders(
  apiUrl: string,
): Promise<{ lends: LendOrder[]; borrows: BorrowOrder[] }> {
  const res = await fetch(`${apiUrl}/api/v1/orders?status=open`);
  if (!res.ok) {
    throw new Error(`Failed to fetch orders: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as OrdersResponse;

  const lends: LendOrder[] = [];
  const borrows: BorrowOrder[] = [];

  for (const order of data.orders) {
    // API returns orderId as string (TEXT in SQLite) — coerce to number
    // so Map<number, bigint> lookups in strategies work correctly
    order.orderId = Number(order.orderId);

    if (isLendOrder(order)) lends.push(order);
    else if (isBorrowOrder(order)) borrows.push(order);
  }

  return { lends, borrows };
}
