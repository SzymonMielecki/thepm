import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { openLocalHubDatabase } from './local-sqlite-db';

/**
 * When `SUPABASE_*` is unset, `getOrCreateDatabase()` returns a `better-sqlite3`–backed
 * client with the same `.from()…` call patterns the hub uses. Typed as `SupabaseClient` so
 * existing code stays a single type path.
 */
export type AppDatabase = SupabaseClient;

let client: SupabaseClient | null = null;

function getSupabaseEnv():
	| { kind: 'supabase'; url: string; supabaseKey: string }
	| { kind: 'empty' } {
	const url = (process.env.SUPABASE_URL ?? '').trim();
	const supabaseKey = (
		process.env.SUPABASE_SERVICE_ROLE_KEY ??
		process.env.SUPABASE_ANON_KEY ??
		process.env.SUPABASE_PUBLISHABLE_KEY ??
		''
	).trim();
	if (url && supabaseKey) return { kind: 'supabase', url, supabaseKey };
	return { kind: 'empty' };
}

function createDatabase(): AppDatabase {
	const s = getSupabaseEnv();
	if (s.kind === 'supabase') {
		return createClient(s.url, s.supabaseKey, {
			auth: { persistSession: false, autoRefreshToken: false }
		});
	}
	// `LocalHubDatabase` is duck-typed to the few Postgrest-style calls we use
	return openLocalHubDatabase() as unknown as AppDatabase;
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
