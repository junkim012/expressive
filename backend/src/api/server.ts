import { Hono } from 'hono';
import { cors } from 'hono/cors';
import ordersRoute from './routes/orders';
import loansRoute from './routes/loans';
import batchesRoute from './routes/batches';
import assetsRoute from './routes/assets';

export function createApp(): Hono {
  const app = new Hono();

  app.use('*', cors());

  app.route('/api/v1/orders', ordersRoute);
  app.route('/api/v1/loans', loansRoute);
  app.route('/api/v1/batches', batchesRoute);
  app.route('/api/v1/assets', assetsRoute);

  app.get('/health', (c) => c.json({ ok: true }));

  app.onError((err, c) => {
    console.error('[api] Error:', err);
    return c.json({ error: err.message }, 500);
  });

  return app;
}
