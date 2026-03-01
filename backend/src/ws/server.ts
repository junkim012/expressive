import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { db } from '../db/client';

const clients = new Set<WebSocket>();

export function createWsServer(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));

    // Send full open-orderbook snapshot on connect
    try {
      const lendOrders = db
        .prepare("SELECT * FROM orders WHERE order_type = 'lend' AND status = 'open' ORDER BY placed_at DESC")
        .all();
      const borrowOrders = db
        .prepare("SELECT * FROM orders WHERE order_type = 'borrow' AND status = 'open' ORDER BY placed_at DESC")
        .all();

      ws.send(
        JSON.stringify({
          type: 'snapshot',
          data: {
            lendOrders: lendOrders.map(transformOrder),
            borrowOrders: borrowOrders.map(transformOrder),
          },
        }),
      );
    } catch {
      // client may have disconnected before we could send
    }
  });

  return wss;
}

export function handleUpgrade(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: import('stream').Duplex,
  head: Buffer,
): void {
  const url = req.url ?? '';
  if (url === '/ws/orderbook') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
}

export function broadcastUpdate(newOrderIds: string[], updatedOrderIds: string[]): void {
  if (clients.size === 0) return;

  const allIds = [...new Set([...newOrderIds, ...updatedOrderIds])];
  if (allIds.length === 0) return;

  const placeholders = allIds.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT * FROM orders WHERE order_id IN (${placeholders})`)
    .all(...allIds);

  const newIdSet = new Set(newOrderIds);
  const newOrders = rows.filter((r: any) => newIdSet.has(r.order_id)).map(transformOrder);
  const updatedOrders = rows.filter((r: any) => !newIdSet.has(r.order_id)).map(transformOrder);

  const msg = JSON.stringify({ type: 'update', data: { newOrders, updatedOrders } });

  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

// ── Transform SQLite row → API shape ──────────────────────────────────────────

function transformOrder(row: any): object {
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
