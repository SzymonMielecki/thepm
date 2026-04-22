import { json, type RequestEvent } from '@sveltejs/kit';
import { getOrCreateDatabase } from '$lib/server/db';
import { assertHubToken } from '$lib/server/auth';
import { error } from '@sveltejs/kit';

export const GET = (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	const db = getOrCreateDatabase();
	const rows = db
		.prepare(
			'SELECT id, session_id, title, description, assignee_hint, state, created_at FROM ticket_drafts ORDER BY created_at DESC'
		)
		.all() as {
			id: string;
			session_id: string;
			title: string;
			description: string;
			assignee_hint: string | null;
			state: string;
			created_at: string;
		}[];
	return json({ drafts: rows });
};
