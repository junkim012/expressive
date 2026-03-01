import { db } from './client';
import { env } from '../config/env';

export function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id               TEXT NOT NULL UNIQUE,
      order_type             TEXT NOT NULL,
      owner                  TEXT NOT NULL,
      borrow_asset           TEXT NOT NULL,

      -- lend-only
      acceptable_collateral  TEXT,
      min_rate               INTEGER,
      max_ltv                INTEGER,
      max_duration           INTEGER,
      max_lltv               INTEGER,

      -- borrow-only
      collateral_assets      TEXT,
      collateral_amounts     TEXT,
      max_rate               INTEGER,
      min_ltv                INTEGER,
      min_duration           INTEGER,
      min_lltv               INTEGER,
      fill_or_kill           INTEGER,

      -- common
      amount                 TEXT NOT NULL,
      filled_amount          TEXT NOT NULL DEFAULT '0',
      status                 TEXT NOT NULL DEFAULT 'open',
      placed_at              INTEGER NOT NULL,
      block_number           INTEGER NOT NULL,
      tx_hash                TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS orders_owner ON orders(owner);
    CREATE INDEX IF NOT EXISTS orders_type_status ON orders(order_type, status);

    CREATE TABLE IF NOT EXISTS loans (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      loan_id          TEXT NOT NULL UNIQUE,
      lend_order_id    TEXT NOT NULL,
      borrow_order_id  TEXT NOT NULL,
      lender           TEXT NOT NULL,
      borrower         TEXT NOT NULL,
      borrow_asset     TEXT NOT NULL,
      principal        TEXT NOT NULL,
      rate             INTEGER NOT NULL,
      maturity_date    INTEGER NOT NULL,
      origination_date INTEGER NOT NULL,
      status           TEXT NOT NULL DEFAULT 'active',
      block_number     INTEGER NOT NULL,
      tx_hash          TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS loans_lender   ON loans(lender);
    CREATE INDEX IF NOT EXISTS loans_borrower ON loans(borrower);
    CREATE INDEX IF NOT EXISTS loans_tx_hash  ON loans(tx_hash);

    CREATE TABLE IF NOT EXISTS loan_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      loan_id      TEXT NOT NULL,
      event_type   TEXT NOT NULL,
      liquidator   TEXT,
      block_number INTEGER NOT NULL,
      block_time   INTEGER NOT NULL,
      tx_hash      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS loan_events_loan ON loan_events(loan_id);

    CREATE TABLE IF NOT EXISTS batches (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      window_id     TEXT NOT NULL UNIQUE,
      solver        TEXT,
      total_surplus TEXT NOT NULL,
      pair_count    INTEGER NOT NULL,
      executed_at   INTEGER NOT NULL,
      block_number  INTEGER NOT NULL,
      tx_hash       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS indexer_state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const existing = db
    .prepare('SELECT value FROM indexer_state WHERE key = ?')
    .get('last_indexed_block');

  if (!existing) {
    db.prepare('INSERT INTO indexer_state (key, value) VALUES (?, ?)').run(
      'last_indexed_block',
      String(env.START_BLOCK - 1n),
    );
  }

  console.log('[db] Migrations complete');
}
