import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type AppDatabase = SupabaseClient;

let client: SupabaseClient | null = null;

function requireSupabaseEnv(): { url: string; supabaseKey: string } {
	const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').trim();
	const supabaseKey = (
		process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
		process.env.SUPABASE_SERVICE_ROLE_KEY ??
		process.env.SUPABASE_ANON_KEY ??
		''
	).trim();
	if (!url || !supabaseKey) {
		throw new Error(
			'Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). Apply src/lib/server/migrations/001_supabase.sql in the Supabase SQL editor first.'
		);
	}
	return { url, supabaseKey };
}

export function getOrCreateDatabase(): AppDatabase {
	if (client) return client;
	const { url, supabaseKey } = requireSupabaseEnv();
	client = createClient(url, supabaseKey, {
		auth: { persistSession: false, autoRefreshToken: false }
	});
	return client;
}

export function resetDatabaseInstanceForTest() {
	client = null;
}
