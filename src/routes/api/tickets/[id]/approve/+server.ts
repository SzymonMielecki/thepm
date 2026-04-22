import { json, type RequestEvent } from '@sveltejs/kit';
import { getOrCreateDatabase } from '$lib/server/db';
import { assertHubToken } from '$lib/server/auth';
import { error } from '@sveltejs/kit';
import { findUserIdByNameHint, createIssueFromDraft } from '$lib/server/linear';
import { getEnv } from '$lib/server/config';
import { publish } from '$lib/server/bus';
export const POST = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	if (!getEnv().linearApiKey) {
		return error(503, 'LINEAR_API_KEY is not configured');
	}
	const id = event.params.id;
	if (!id) return error(400, 'id');
	const db = getOrCreateDatabase();
	const row = db
		.prepare('SELECT * FROM ticket_drafts WHERE id = ?')
		.get(id) as
		| {
				id: string;
				title: string;
				description: string;
				assignee_hint: string | null;
				state: string;
		  }
		| undefined;
	if (!row) return error(404, 'draft not found');
	if (row.state !== 'pending') {
		return json({ ok: true, already: true });
	}
	const assignee = await findUserIdByNameHint(row.assignee_hint);
	const created = await createIssueFromDraft({
		title: row.title,
		description: row.description,
		assigneeUserId: assignee
	});
	db.prepare('UPDATE ticket_drafts SET state = ? WHERE id = ?').run('approved', id);
	db
		.prepare('INSERT OR REPLACE INTO linear_tickets (id, draft_id, linear_identifier, url) VALUES (?,?,?,?)')
		.run(created.id, id, created.identifier ?? '', created.url ?? '');
	publish({ type: 'draft', id, title: row.title, state: 'approved' });
	return json({ ok: true, linear: created });
};
