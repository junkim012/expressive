import 'dotenv/config';
import { serve } from '@hono/node-server';
import { runMigrations } from './db/migrations';
import { createApp } from './api/server';
import { createWsServer, handleUpgrade } from './ws/server';
import { startPoller } from './indexer/poller';
import { env } from './config/env';

async function main(): Promise<void> {
  // 1. Validate env (throws on missing required vars)
  console.log('[boot] Environment validated');

  // 2. Run DB migrations and seed indexer_state if needed
  runMigrations();

  // 3. Start HTTP server
  const app = createApp();
  const httpServer = serve({ fetch: app.fetch, port: env.PORT }, () => {
    console.log(`[api] Listening on http://0.0.0.0:${env.PORT}`);
  });

  // 4. Attach WebSocket server on the same HTTP server
  const wss = createWsServer();
  httpServer.on('upgrade', (req, socket, head) => {
    handleUpgrade(wss, req, socket as any, head as any);
  });
  console.log(`[ws] WebSocket endpoint: ws://0.0.0.0:${env.PORT}/ws/orderbook`);

  // 5. Start event poller (async — runs independently)
  startPoller().catch((err) => {
    console.error('[indexer] Fatal error:', err);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('[boot] Fatal:', err);
  process.exit(1);
});
