import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

export function createDb(file: string): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL'); // lets the transcription worker read/write concurrently
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.exec(schema.BOOTSTRAP_SQL);
  for (const [table, column, ddl] of schema.MIGRATIONS) {
    const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) sqlite.exec(ddl);
  }
  return drizzle(sqlite, { schema });
}

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? 'data');

const globalForDb = globalThis as unknown as { __moradokDb?: Db };

/** process-wide singleton (survives Next.js dev hot reloads) */
export function getDb(): Db {
  globalForDb.__moradokDb ??= createDb(path.join(DATA_DIR, 'app.db'));
  return globalForDb.__moradokDb;
}
