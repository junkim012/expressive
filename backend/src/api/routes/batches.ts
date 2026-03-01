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

export default app;

// ── Transform ─────────────────────────────────────────────────────────────────

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
