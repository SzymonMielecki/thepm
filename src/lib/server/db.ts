import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getEnv } from './config';

export type AppDatabase = Database.Database;

let dbInstance: AppDatabase | null = null;

function readMigration001Sql(): string {
	/** Hub runs with install root as `process.cwd()` (`bin/thepm.mjs`); bundled chunks break `import.meta.url` relatives. */
	const p = join(process.cwd(), 'src', 'lib', 'server', 'migrations', '001_init.sql');
	return readFileSync(p, 'utf-8');
}

function runMigrations(db: AppDatabase) {
	const sql = readMigration001Sql();
	db.exec('BEGIN');
	try {
		db.exec(sql);
		db.exec('COMMIT');
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
}

export function getOrCreateDatabase(): AppDatabase {
	if (dbInstance) return dbInstance;
	const { databasePath } = getEnv();
	const dir = dirname(databasePath);
	mkdirSync(dir, { recursive: true });
	const db = new Database(databasePath);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	const row = db
		.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'sessions'")
		.get() as { ok: number } | undefined;
	if (!row) {
		runMigrations(db);
	}
	dbInstance = db;
	return db;
}

export function resetDatabaseInstanceForTest() {
	if (dbInstance) {
		try {
			dbInstance.close();
		} catch {
			// ignore
		}
	}
	dbInstance = null;
}
