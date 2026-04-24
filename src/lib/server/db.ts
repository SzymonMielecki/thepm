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

function ensureTicketDraftColumns(db: AppDatabase) {
	const cols = db.prepare("PRAGMA table_info('ticket_drafts')").all() as { name: string }[];
	const names = new Set(cols.map((c) => c.name));
	if (!names.has('prd_section')) {
		db.exec('ALTER TABLE ticket_drafts ADD COLUMN prd_section TEXT');
	}
	if (!names.has('prd_body')) {
		db.exec('ALTER TABLE ticket_drafts ADD COLUMN prd_body TEXT');
	}
	if (!names.has('assignee_user_id')) {
		db.exec('ALTER TABLE ticket_drafts ADD COLUMN assignee_user_id TEXT');
	}
}

function ensureSessionSpeakerTable(db: AppDatabase) {
	db.exec(`
		CREATE TABLE IF NOT EXISTS session_speakers (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
			speaker_id TEXT NOT NULL,
			display_name TEXT,
			linear_user_id TEXT,
			linear_name TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now')),
			UNIQUE (session_id, speaker_id)
		);
		CREATE INDEX IF NOT EXISTS idx_session_speakers_session ON session_speakers (session_id);
	`);
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
	ensureTicketDraftColumns(db);
	ensureSessionSpeakerTable(db);
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
