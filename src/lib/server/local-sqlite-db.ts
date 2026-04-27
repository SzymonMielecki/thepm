import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type Database from 'better-sqlite3';
import { projectBaseDir } from './config';

const MIGRATION_IDS_AFTER_INIT = [
	'002_agents',
	'003_catalog',
	'004_ticket_drafts_project_root',
	'005_delegations_linear'
] as const;

function loadInitMigrationSql(): string {
	if (typeof __THEPM_INIT_SQL__ === 'string' && __THEPM_INIT_SQL__.length > 0) {
		return __THEPM_INIT_SQL__;
	}
	return readFileSync(
		fileURLToPath(new URL('./migrations/001_init.sql', import.meta.url)),
		'utf-8'
	);
}

function defaultSqlitePath(): string {
	const override = (process.env.THEPM_SQLITE_PATH ?? '').trim();
	if (override) return override;
	return join(projectBaseDir(), '.thepm', 'hub.db');
}

function isDbEmpty(db: Database.Database): boolean {
	try {
		const row = db
			.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'")
			.get() as { name: string } | undefined;
		if (!row) return true;
		const c = db.prepare('SELECT COUNT(*) as c FROM _migrations').get() as { c: number };
		return (c?.c ?? 0) === 0;
	} catch {
		return true;
	}
}

function runInitialMigrationIfNeeded(db: Database.Database) {
	if (!isDbEmpty(db)) return;
	db.exec(loadInitMigrationSql());
}

function applyPendingMigrations(db: Database.Database) {
	try {
		const row = db
			.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'")
			.get() as { name: string } | undefined;
		if (!row) return;
		for (const id of MIGRATION_IDS_AFTER_INIT) {
			const applied = db.prepare('SELECT id FROM _migrations WHERE id = ?').get(id) as
				| { id: string }
				| undefined;
			if (applied) continue;
			const sql = readFileSync(
				fileURLToPath(new URL(`./migrations/${id}.sql`, import.meta.url)),
				'utf-8'
			);
			db.exec(sql);
		}
	} catch {
		/* ignore odd states */
	}
}

function ensureTicketDraftsSpeakerIdColumn(db: Database.Database) {
	try {
		const cols = db.prepare(`PRAGMA table_info("ticket_drafts")`).all() as { name: string }[];
		if (cols.some((c) => c.name === 'speaker_id')) return;
		db.exec(`ALTER TABLE "ticket_drafts" ADD COLUMN speaker_id TEXT`);
	} catch {
		// ignore: table missing in odd states
	}
}

export type LocalFromResult<T> = { data: T | null; error: { message: string } | null };

class LocalQuery {
	private _table: string;
	private _db: Database.Database;
	private _select = '*';
	private _order?: { col: string; asc: boolean };
	private _limit?: number;
	private _wheres: { col: string; op: 'eq' | 'not_null'; val?: unknown }[] = [];

	/** PostgREST-style builder is thenable for `.select()...` chains that end without `maybeSingle` */
	then<TResult1 = LocalFromResult<Record<string, unknown>[]>, TResult2 = never>(
		onfulfilled?:
			| ((
					value: LocalFromResult<Record<string, unknown>[]>
			  ) => TResult1 | PromiseLike<TResult1>)
			| null,
		onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
	): Promise<TResult1 | TResult2> {
		return this._runSelectMany<Record<string, unknown>>().then(onfulfilled, onrejected);
	}

	constructor(db: Database.Database, table: string) {
		this._db = db;
		this._table = table;
	}

	select(fields: string): this {
		this._select = fields.replace(/\s+/g, ' ').trim();
		return this;
	}

	order(col: string, opts?: { ascending?: boolean }): this {
		this._order = { col, asc: opts?.ascending !== false };
		return this;
	}

	limit(n: number): this {
		this._limit = n;
		return this;
	}

	eq(col: string, val: unknown): this {
		this._wheres.push({ col, op: 'eq', val });
		return this;
	}

	/** Supports `.not('speaker_id', 'is', null)` → `speaker_id IS NOT NULL` */
	not(col: string, op: string, val: unknown): this {
		if (op === 'is' && val === null) {
			this._wheres.push({ col, op: 'not_null' });
		}
		return this;
	}

	private buildWhereSql(): { sql: string; params: unknown[] } {
		const parts: string[] = [];
		const params: unknown[] = [];
		for (const w of this._wheres) {
			if (w.op === 'eq') {
				parts.push(`"${w.col}" = ?`);
				params.push(w.val);
			} else if (w.op === 'not_null') {
				parts.push(`"${w.col}" IS NOT NULL`);
			}
		}
		if (!parts.length) return { sql: '', params: [] };
		return { sql: ' WHERE ' + parts.join(' AND '), params };
	}

	async maybeSingle<T extends Record<string, unknown>>(): Promise<LocalFromResult<T>> {
		return this._execSingle<T>(true);
	}

	async single<T extends Record<string, unknown>>(): Promise<LocalFromResult<T>> {
		return this._execSingle<T>(false);
	}

	private async _execSingle<T>(optional: boolean): Promise<LocalFromResult<T>> {
		try {
			const lim = this._limit ?? 1;
			const list = await this._fetchRows<T>(lim);
			if (list.length === 0) return { data: null, error: null };
			if (list.length > 1 && !optional) {
				return { data: null, error: { message: 'multiple rows' } };
			}
			return { data: list[0] ?? null, error: null };
		} catch (e) {
			return { data: null, error: { message: (e as Error).message } };
		}
	}

	private async _fetchRows<T>(lim: number): Promise<T[]> {
		if (this._table === 'ticket_drafts' && this._select.includes('linear_tickets')) {
			const w = this.buildWhereSql();
			const order = this._order
				? ` ORDER BY d."${this._order.col}" ${this._order.asc ? 'ASC' : 'DESC'}`
				: ' ORDER BY d."created_at" DESC';
			const limSql = ` LIMIT ${Number(lim) || 200}`;
			const sql = `SELECT d.*, l.linear_identifier, l.url as linear_url FROM "ticket_drafts" d
				LEFT JOIN "linear_tickets" l ON l.draft_id = d.id${w.sql}${order}${limSql}`;
			const rows = this._db.prepare(sql).all(...w.params) as T[];
			return rows.map((row) => {
				const r = row as Record<string, unknown>;
				const { linear_identifier, linear_url, ...rest } = r;
				return {
					...rest,
					linear_tickets: [{ linear_identifier, url: linear_url }]
				} as T;
			});
		}
		const w = this.buildWhereSql();
		const order = this._order
			? ` ORDER BY "${this._order.col}" ${this._order.asc ? 'ASC' : 'DESC'}`
			: '';
		const limSql = lim > 0 ? ` LIMIT ${Number(lim) || 200}` : '';
		const sql = `SELECT ${this._select === '*' ? '*' : this._select} FROM "${this._table}"${w.sql}${order}${limSql}`;
		return this._db.prepare(sql).all(...w.params) as T[];
	}

	async _runSelectMany<T extends Record<string, unknown>>(): Promise<LocalFromResult<T[]>> {
		try {
			const lim = this._limit ?? 10_000;
			const rows = await this._fetchRows<T>(lim);
			return { data: rows, error: null };
		} catch (e) {
			return { data: null, error: { message: (e as Error).message } };
		}
	}
}

class LocalFromBuilder {
	constructor(
		private db: Database.Database,
		private table: string
	) {}

	select(fields: string): LocalQuery {
		return new LocalQuery(this.db, this.table).select(fields);
	}

	insert(
		row: Record<string, unknown> | Record<string, unknown>[],
		_opts?: unknown
	): Promise<{ error: { message: string } | null }> {
		const rows = Array.isArray(row) ? row : [row];
		try {
			if (!rows.length) return Promise.resolve({ error: null });
			for (const r of rows) {
				const keys = Object.keys(r);
				const ph = keys.map(() => '?').join(',');
				const cols = keys.map((k) => `"${k}"`).join(',');
				this.db
					.prepare(
						`INSERT INTO "${this.table}" (${cols}) VALUES (${ph})`
					)
					.run(...keys.map((k) => r[k]));
			}
			return Promise.resolve({ error: null });
		} catch (e) {
			return Promise.resolve({ error: { message: (e as Error).message } });
		}
	}

	update(
		patch: Record<string, unknown>
	): {
		eq: (col: string, val: unknown) => Promise<LocalFromResult<null>>;
	} {
		const t = this.table;
		const db = this.db;
		return {
			eq: async (col: string, val: unknown) => {
				const keys = Object.keys(patch);
				if (!keys.length) return { data: null, error: null };
				const sets = keys.map((k) => `"${k}" = ?`).join(', ');
				const values = keys.map((k) => patch[k]) as unknown[];
				try {
					const stmt = db.prepare(
						`UPDATE "${t}" SET ${sets} WHERE "${col}" = ?`
					);
					stmt.run(...values, val);
					return { data: null, error: null };
				} catch (e) {
					return { data: null, error: { message: (e as Error).message } };
				}
			}
		};
	}

	upsert(
		row: Record<string, unknown>,
		opts: { onConflict: string }
	): Promise<LocalFromResult<null>> {
		const c = (opts.onConflict || '').split(',').map((s) => s.trim());
		try {
			if (this.table === 'linear_tickets' && c.includes('id') && c.length === 1) {
				this.db
					.prepare(
						`INSERT OR REPLACE INTO "linear_tickets" (id, draft_id, linear_identifier, url) VALUES (?,?,?,?)`
					)
					.run(row.id, row.draft_id, row.linear_identifier, row.url);
				return Promise.resolve({ data: null, error: null });
			}
			if (this.table === 'session_speakers' && c.length === 2) {
				this.db
					.prepare(
						`INSERT INTO "session_speakers" (session_id, speaker_id, display_name, linear_user_id, linear_name, updated_at)
					 VALUES (?,?,?,?,?,?)
					 ON CONFLICT (session_id, speaker_id) DO UPDATE SET
					 display_name=excluded.display_name,
					 linear_user_id=excluded.linear_user_id,
					 linear_name=excluded.linear_name,
					 updated_at=excluded.updated_at`
					)
					.run(
						row.session_id,
						row.speaker_id,
						row.display_name,
						row.linear_user_id,
						row.linear_name,
						row.updated_at
					);
				return Promise.resolve({ data: null, error: null });
			}
			return Promise.resolve({
				data: null,
				error: { message: `Local SQLite upsert not supported for this table: ${this.table}` }
			});
		} catch (e) {
			return Promise.resolve({ data: null, error: { message: (e as Error).message } });
		}
	}

	delete(): {
		eq: (col: string, val: unknown) => Promise<LocalFromResult<null>>;
	} {
		const t = this.table;
		const db = this.db;
		return {
			eq: async (col: string, val: unknown) => {
				try {
					db.prepare(`DELETE FROM "${t}" WHERE "${col}" = ?`).run(val);
					return { data: null, error: null };
				} catch (e) {
					return { data: null, error: { message: (e as Error).message } };
				}
			}
		};
	}
}

export type LocalHubDatabase = { from: (t: string) => LocalFromBuilder; __isLocal: true };

export function openLocalHubDatabase(): LocalHubDatabase {
	const require = createRequire(import.meta.url);
	const BetterSqlite = require('better-sqlite3') as typeof import('better-sqlite3');
	const path = defaultSqlitePath();
	mkdirSync(dirname(path), { recursive: true });
	const existed = existsSync(path);
	const db: Database.Database = new BetterSqlite(path);
	db.pragma('foreign_keys = ON');
	if (!existed || isDbEmpty(db)) {
		runInitialMigrationIfNeeded(db);
	}
	ensureTicketDraftsSpeakerIdColumn(db);
	applyPendingMigrations(db);
	return {
		__isLocal: true,
		from: (t: string) => new LocalFromBuilder(db, t)
	};
}
