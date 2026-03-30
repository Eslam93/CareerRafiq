import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { runMigrations, ensureDatabaseDirectory } from './migrate.js';
import * as schema from './schema.js';

export interface DatabaseClient {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
}

export function getDefaultDatabaseFilePath(): string {
  return process.env['CAREERRAFIQ_DB_FILE']
    ? resolve(process.env['CAREERRAFIQ_DB_FILE'])
    : resolve(process.cwd(), 'apps', 'api', 'data', 'career-rafiq.db');
}

export function createDatabaseClient(filePath = getDefaultDatabaseFilePath()): DatabaseClient {
  const sqlite = new Database(ensureDatabaseDirectory(filePath));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  runMigrations(sqlite);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}
