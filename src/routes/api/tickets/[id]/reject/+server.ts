import { json, type RequestEvent } from '@sveltejs/kit';
import { getOrCreateDatabase } from '$lib/server/db';
import { assertHubToken } from '$lib/server/auth';
import { error } from '@sveltejs/kit';
import { publish } from '$lib/server/bus';

export const POST = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	const id = event.params.id;
	if (!id) return error(400, 'id');
	const db = getOrCreateDatabase();
	const { data: row, error: qErr } = await db
		.from('ticket_drafts')
		.select('title, state')
		.eq('id', id)
		.maybeSingle();
	if (qErr) return error(500, qErr.message);
	if (!row) return error(404, 'not found');
	const { error: upErr } = await db.from('ticket_drafts').update({ state: 'rejected' }).eq('id', id);
	if (upErr) return error(500, upErr.message);
	publish({ type: 'draft', id, title: row.title, state: 'rejected' });
	return json({ ok: true });
};
