import { Hono } from 'hono';
import { ASSETS } from '../../config/assets';

const app = new Hono();

app.get('/', (c) => c.json(ASSETS));

export default app;
