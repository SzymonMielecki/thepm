import { json, error, type RequestEvent } from '@sveltejs/kit';
import { assertHubToken } from '$lib/server/auth';
import { getOrCreateDatabase } from '$lib/server/db';
import { getEnv } from '$lib/server/config';
import { cancelDelegation } from '$lib/server/agents/dispatch';

export const GET = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	const id = event.params.id;
	if (!id) return error(400, 'id');
	const db = getOrCreateDatabase();
	const { data: del, error: qErr } = await db.from('delegations').select('*').eq('id', id).maybeSingle();
	if (qErr) return error(500, qErr.message);
	if (!del) return error(404, 'not found');
	const { data: runs } = await db.from('delegation_runs').select('*').eq('delegation_id', id);
	const { data: events } = await db
		.from('delegation_events')
		.select('*')
		.eq('delegation_id', id)
		.order('created_at', { ascending: true });
	return json({ delegation: del, runs: runs ?? [], events: events ?? [] });
};

export const DELETE = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	const id = event.params.id;
	if (!id) return error(400, 'id');
	const db = getOrCreateDatabase();
	const { data: del } = await db
		.from('delegations')
		.select('id,status')
		.eq('id', id)
		.maybeSingle();
	if (!del) return error(404, 'not found');
	const status = (del as { status?: string }).status;
	const terminal = status === 'succeeded' || status === 'failed' || status === 'cancelled';
	try {
		if (terminal) {
			const { error: dErr } = await db.from('delegations').delete().eq('id', id);
			if (dErr) return error(500, dErr.message);
			return json({ ok: true, dismissed: true });
		}
		await cancelDelegation(db, getEnv().codeBridgeWorkspaceId, id);
		return json({ ok: true, cancelled: true });
	} catch (e) {
		return error(500, (e as Error).message);
	}
};
