import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env';

const dir = path.dirname(path.resolve(env.DB_PATH));
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

export const db = new Database(env.DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
