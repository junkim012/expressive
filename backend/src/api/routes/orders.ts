import { Hono } from 'hono';
import { db } from '../../db/client';

const app = new Hono();

app.get('/', (c) => {
  const { status, owner, type } = c.req.query();

  let sql = 'SELECT * FROM orders WHERE 1=1';
  const params: (string | number)[] = [];

  if (status === 'open' || status === 'filled') {
    sql += ' AND status = ?';
    params.push(status);
  }

  if (owner) {
    sql += ' AND LOWER(owner) = LOWER(?)';
    params.push(owner);
  }

  if (type === 'lend' || type === 'borrow') {
    sql += ' AND order_type = ?';
    params.push(type);
  }

  sql += ' ORDER BY placed_at DESC';

  const rows = db.prepare(sql).all(...params);
  return c.json({ orders: rows.map(transformOrder) });
});

export default app;

// ── Transform ─────────────────────────────────────────────────────────────────

export function transformOrder(row: any): object {
  const base = {
    orderId: row.order_id,
    orderType: row.order_type,
    owner: row.owner,
    borrowAsset: row.borrow_asset,
    amount: row.amount,
    filledAmount: row.filled_amount,
    status: row.status,
    placedAt: row.placed_at,
    blockNumber: row.block_number,
    txHash: row.tx_hash,
  };

  if (row.order_type === 'lend') {
    return {
      ...base,
      acceptableCollateral: JSON.parse(row.acceptable_collateral ?? '[]'),
      minRate: row.min_rate,
      maxLtv: row.max_ltv,
      maxDuration: row.max_duration,
      maxLltv: row.max_lltv,
    };
  }

  return {
    ...base,
    collateralAssets: JSON.parse(row.collateral_assets ?? '[]'),
    collateralAmounts: JSON.parse(row.collateral_amounts ?? '[]'),
    maxRate: row.max_rate,
    minLtv: row.min_ltv,
    minDuration: row.min_duration,
    minLltv: row.min_lltv,
    fillOrKill: row.fill_or_kill === 1,
  };
}
