import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { logger } from '../logger.js';
import { MIGRATIONS } from './migrations.js';

export type Db = Database.Database;

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  // WAL keeps the poll cycle's writes from blocking bot command reads.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);
  return db;
}

function runMigrations(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');

  const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
    | { version: number }
    | undefined;
  let current = row?.version ?? 0;

  if (row === undefined) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();

  for (let index = current; index < MIGRATIONS.length; index++) {
    const sql = MIGRATIONS[index];
    if (!sql) continue;

    db.transaction(() => {
      db.exec(sql);
      db.prepare('UPDATE schema_version SET version = ?').run(index + 1);
    })();

    current = index + 1;
    logger.info({ version: current }, 'applied database migration');
  }
}
