import { openLocalHubDatabase, type LocalHubDatabase } from './local-sqlite-db';

/**
 * Hub persistence is `better-sqlite3` at `.thepm/hub.db` (or `THEPM_SQLITE_PATH`).
 * The client exposes PostgREST-style `.from()…` chains used across the app.
 */
export type AppDatabase = LocalHubDatabase;

let client: LocalHubDatabase | null = null;

function createDatabase(): AppDatabase {
	return openLocalHubDatabase();
}

export function getOrCreateDatabase(): AppDatabase {
	if (!client) {
		client = createDatabase();
	}
	return client;
}

export function resetDatabaseInstanceForTest() {
	client = null;
}
