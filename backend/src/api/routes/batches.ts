import { Hono } from 'hono';
import { db } from '../../db/client';

const app = new Hono();

app.get('/', (c) => {
  const page = Math.max(1, Number(c.req.query('page') ?? '1'));
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? '20')));
  const offset = (page - 1) * limit;

  const total = (
    db.prepare('SELECT COUNT(*) as n FROM batches').get() as { n: number }
  ).n;

  const rows = db
    .prepare('SELECT * FROM batches ORDER BY block_number DESC LIMIT ? OFFSET ?')
    .all(limit, offset);

  return c.json({
    batches: rows.map(transformBatch),
    total,
    page,
    limit,
  });
});

app.get('/:windowId/loans', (c) => {
  const { windowId } = c.req.param();

  const batch = db
    .prepare('SELECT tx_hash FROM batches WHERE window_id = ?')
    .get(windowId) as { tx_hash: string } | undefined;

  if (!batch) return c.json({ error: 'Batch not found' }, 404);

  const rows = db
    .prepare('SELECT * FROM loans WHERE tx_hash = ? ORDER BY loan_id ASC')
    .all(batch.tx_hash);

  return c.json({ loans: rows.map(transformLoan) });
});

export default app;

// ── Transforms ────────────────────────────────────────────────────────────────

function transformBatch(row: any): object {
  return {
    windowId: row.window_id,
    solver: row.solver ?? null,
    totalSurplus: row.total_surplus,
    pairCount: row.pair_count,
    executedAt: row.executed_at,
    blockNumber: row.block_number,
    txHash: row.tx_hash,
  };
}

function transformLoan(row: any): object {
  return {
    loanId: row.loan_id,
    lendOrderId: row.lend_order_id,
    borrowOrderId: row.borrow_order_id,
    lender: row.lender,
    borrower: row.borrower,
    borrowAsset: row.borrow_asset,
    principal: row.principal,
    rate: row.rate,
    maturityDate: row.maturity_date,
    originationDate: row.origination_date,
    status: row.status,
    blockNumber: row.block_number,
    txHash: row.tx_hash,
  };
}
