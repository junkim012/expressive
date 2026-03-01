import { getAddress } from 'viem';
import { db } from '../db/client';

export type HandlerContext = {
  blockNumber: number;
  blockTime: number;
  txHash: string;
};

// Returned by the transaction wrapper so the WS layer knows what changed.
export type TickResult = {
  newOrderIds: string[];
  updatedOrderIds: string[];
  hasEvents: boolean;
};

// ── Per-event handlers ────────────────────────────────────────────────────────

export function handleLendOrderPlaced(
  args: {
    orderId: bigint;
    owner: string;
    borrowAsset: string;
    acceptableCollateral: readonly string[];
    minRate: bigint;
    maxLTV: bigint;
    maxDuration: bigint;
    maxLLTV: bigint;
    amount: bigint;
    timestamp: bigint;
  },
  ctx: HandlerContext,
  newOrderIds: string[],
): void {
  const orderId = args.orderId.toString();

  const result = db
    .prepare(
      `INSERT OR IGNORE INTO orders (
        order_id, order_type, owner, borrow_asset,
        acceptable_collateral, min_rate, max_ltv, max_duration, max_lltv,
        amount, filled_amount, status, placed_at, block_number, tx_hash
      ) VALUES (?, 'lend', ?, ?, ?, ?, ?, ?, ?, ?, '0', 'open', ?, ?, ?)`,
    )
    .run(
      orderId,
      getAddress(args.owner),
      getAddress(args.borrowAsset),
      JSON.stringify(args.acceptableCollateral.map((a) => getAddress(a))),
      Number(args.minRate),
      Number(args.maxLTV),
      Number(args.maxDuration),
      Number(args.maxLLTV),
      args.amount.toString(),
      Number(args.timestamp),
      ctx.blockNumber,
      ctx.txHash,
    );

  if (result.changes > 0) newOrderIds.push(orderId);
}

export function handleBorrowOrderPlaced(
  args: {
    orderId: bigint;
    owner: string;
    borrowAsset: string;
    collateralAssets: readonly string[];
    collateralAmounts: readonly bigint[];
    maxRate: bigint;
    minLTV: bigint;
    minDuration: bigint;
    minLLTV: bigint;
    amount: bigint;
    fillOrKill: boolean;
    timestamp: bigint;
  },
  ctx: HandlerContext,
  newOrderIds: string[],
): void {
  const orderId = args.orderId.toString();

  const result = db
    .prepare(
      `INSERT OR IGNORE INTO orders (
        order_id, order_type, owner, borrow_asset,
        collateral_assets, collateral_amounts, max_rate, min_ltv, min_duration, min_lltv, fill_or_kill,
        amount, filled_amount, status, placed_at, block_number, tx_hash
      ) VALUES (?, 'borrow', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '0', 'open', ?, ?, ?)`,
    )
    .run(
      orderId,
      getAddress(args.owner),
      getAddress(args.borrowAsset),
      JSON.stringify(args.collateralAssets.map((a) => getAddress(a))),
      JSON.stringify(args.collateralAmounts.map((a) => a.toString())),
      Number(args.maxRate),
      Number(args.minLTV),
      Number(args.minDuration),
      Number(args.minLLTV),
      args.fillOrKill ? 1 : 0,
      args.amount.toString(),
      Number(args.timestamp),
      ctx.blockNumber,
      ctx.txHash,
    );

  if (result.changes > 0) newOrderIds.push(orderId);
}

export function handleLoanCreated(
  args: {
    loanId: bigint;
    lendOrderId: bigint;
    borrowOrderId: bigint;
    lender: string;
    borrower: string;
    matchAmount: bigint;
    principal: bigint;
    rate: bigint;
    ltv: bigint;
    lltv: bigint;
    maturityDate: bigint;
    originationDate: bigint;
  },
  ctx: HandlerContext,
  updatedOrderIds: string[],
): void {
  const loanId = args.loanId.toString();
  const lendOrderId = args.lendOrderId.toString();
  const borrowOrderId = args.borrowOrderId.toString();

  // Derive borrow_asset from the already-indexed lend order
  const lendRow = db
    .prepare('SELECT borrow_asset FROM orders WHERE order_id = ?')
    .get(lendOrderId) as { borrow_asset: string } | undefined;
  const borrowAsset = lendRow?.borrow_asset ?? '';

  const result = db
    .prepare(
      `INSERT OR IGNORE INTO loans (
        loan_id, lend_order_id, borrow_order_id, lender, borrower, borrow_asset,
        principal, rate, maturity_date, origination_date, status, block_number, tx_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    )
    .run(
      loanId,
      lendOrderId,
      borrowOrderId,
      getAddress(args.lender),
      getAddress(args.borrower),
      borrowAsset,
      args.principal.toString(),
      Number(args.rate),
      Number(args.maturityDate),
      Number(args.originationDate),  // emitted directly by the contract
      ctx.blockNumber,
      ctx.txHash,
    );

  // Only update fill amounts if this loan row was newly inserted (idempotency guard)
  if (result.changes > 0) {
    // matchAmount is emitted directly — no reverse-computation needed
    const matchAmount = args.matchAmount;

    for (const orderId of [lendOrderId, borrowOrderId]) {
      const orderRow = db
        .prepare('SELECT amount, filled_amount FROM orders WHERE order_id = ?')
        .get(orderId) as { amount: string; filled_amount: string } | undefined;

      if (!orderRow) continue;

      const newFilled = BigInt(orderRow.filled_amount) + matchAmount;
      db.prepare('UPDATE orders SET filled_amount = ? WHERE order_id = ?').run(
        newFilled.toString(),
        orderId,
      );

      if (newFilled >= BigInt(orderRow.amount)) {
        db.prepare("UPDATE orders SET status = 'filled' WHERE order_id = ?").run(orderId);
      }

      updatedOrderIds.push(orderId);
    }
  }
}

export function handleBatchExecuted(
  args: {
    windowId: bigint;
    solver: string;
    totalSurplus: bigint;
    pairCount: bigint;
  },
  ctx: HandlerContext,
): void {
  const solver = args.solver === '0x0000000000000000000000000000000000000000'
    ? null
    : getAddress(args.solver);

  db.prepare(
    `INSERT OR IGNORE INTO batches (
      window_id, solver, total_surplus, pair_count, executed_at, block_number, tx_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    args.windowId.toString(),
    solver,
    args.totalSurplus.toString(),
    Number(args.pairCount),
    ctx.blockTime,
    ctx.blockNumber,
    ctx.txHash,
  );
}

export function handleLoanRepaid(
  args: { loanId: bigint },
  ctx: HandlerContext,
): void {
  const loanId = args.loanId.toString();
  db.prepare("UPDATE loans SET status = 'repaid' WHERE loan_id = ?").run(loanId);
  db.prepare(
    `INSERT INTO loan_events (loan_id, event_type, block_number, block_time, tx_hash)
     VALUES (?, 'repaid', ?, ?, ?)`,
  ).run(loanId, ctx.blockNumber, ctx.blockTime, ctx.txHash);
}

export function handleLoanLiquidated(
  args: { loanId: bigint; liquidator: string },
  ctx: HandlerContext,
): void {
  const loanId = args.loanId.toString();
  db.prepare("UPDATE loans SET status = 'liquidated' WHERE loan_id = ?").run(loanId);
  db.prepare(
    `INSERT INTO loan_events (loan_id, event_type, liquidator, block_number, block_time, tx_hash)
     VALUES (?, 'liquidated', ?, ?, ?, ?)`,
  ).run(loanId, getAddress(args.liquidator), ctx.blockNumber, ctx.blockTime, ctx.txHash);
}

export function handleLoanDefaulted(
  args: { loanId: bigint },
  ctx: HandlerContext,
): void {
  const loanId = args.loanId.toString();
  db.prepare("UPDATE loans SET status = 'defaulted' WHERE loan_id = ?").run(loanId);
  db.prepare(
    `INSERT INTO loan_events (loan_id, event_type, block_number, block_time, tx_hash)
     VALUES (?, 'defaulted', ?, ?, ?)`,
  ).run(loanId, ctx.blockNumber, ctx.blockTime, ctx.txHash);
}
