import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getEnv } from './config';

export type AppDatabase = Database.Database;

let dbInstance: AppDatabase | null = null;

function runMigrations(db: AppDatabase) {
	const sql = readFileSync(new URL('./migrations/001_init.sql', import.meta.url), 'utf-8');
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
