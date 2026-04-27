import { json, error, type RequestEvent } from '@sveltejs/kit';
import { assertHubToken } from '$lib/server/auth';
import { getOrCreateDatabase } from '$lib/server/db';

export const GET = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	const db = getOrCreateDatabase();
	const { data: dels, error: qErr } = await db
		.from('delegations')
		.select('*')
		.order('created_at', { ascending: false })
		.limit(80);
	if (qErr) return error(500, qErr.message);
	const delegations = dels ?? [];
	const out = [];
	for (const d of delegations as Record<string, unknown>[]) {
		const id = String(d.id);
		const { data: runs } = await db.from('delegation_runs').select('*').eq('delegation_id', id);
		out.push({ ...d, runs: runs ?? [] });
	}
	return json({ delegations: out });
};
