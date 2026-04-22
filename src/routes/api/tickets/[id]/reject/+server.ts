import { json, type RequestEvent } from '@sveltejs/kit';
import { getOrCreateDatabase } from '$lib/server/db';
import { assertHubToken } from '$lib/server/auth';
import { error } from '@sveltejs/kit';
import { publish } from '$lib/server/bus';

export const POST = (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	const id = event.params.id;
	if (!id) return error(400, 'id');
	const db = getOrCreateDatabase();
	const row = db
		.prepare('SELECT title, state FROM ticket_drafts WHERE id = ?')
		.get(id) as { title: string; state: string } | undefined;
	if (!row) return error(404, 'not found');
	db.prepare('UPDATE ticket_drafts SET state = ? WHERE id = ?').run('rejected', id);
	publish({ type: 'draft', id, title: row.title, state: 'rejected' });
	return json({ ok: true });
};
