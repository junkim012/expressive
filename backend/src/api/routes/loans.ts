import { Hono } from 'hono';
import { db } from '../../db/client';

const app = new Hono();

app.get('/', (c) => {
  const { lender, borrower, status } = c.req.query();

  let sql = 'SELECT * FROM loans WHERE 1=1';
  const params: string[] = [];

  if (lender) {
    sql += ' AND LOWER(lender) = LOWER(?)';
    params.push(lender);
  }

  if (borrower) {
    sql += ' AND LOWER(borrower) = LOWER(?)';
    params.push(borrower);
  }

  if (status && ['active', 'repaid', 'liquidated', 'defaulted'].includes(status)) {
    sql += ' AND status = ?';
    params.push(status);
  }

  sql += ' ORDER BY origination_date DESC';

  const rows = db.prepare(sql).all(...params);
  return c.json({ loans: rows.map(transformLoan) });
});

app.get('/:loanId', (c) => {
  const { loanId } = c.req.param();

  const loan = db.prepare('SELECT * FROM loans WHERE loan_id = ?').get(loanId) as any;
  if (!loan) return c.json({ error: 'Loan not found' }, 404);

  const events = db
    .prepare('SELECT * FROM loan_events WHERE loan_id = ? ORDER BY block_number ASC')
    .all(loanId);

  return c.json({
    loan: transformLoan(loan),
    events: events.map(transformLoanEvent),
  });
});

export default app;

// ── Transforms ────────────────────────────────────────────────────────────────

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

function transformLoanEvent(row: any): object {
  return {
    eventType: row.event_type,
    liquidator: row.liquidator ?? undefined,
    blockNumber: row.block_number,
    blockTime: row.block_time,
    txHash: row.tx_hash,
  };
}
