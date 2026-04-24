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
			`SELECT d.id, d.session_id, d.title, d.description, d.assignee_hint, d.assignee_user_id, d.state, d.created_at,
				lt.linear_identifier AS linear_identifier, lt.url AS linear_url
			FROM ticket_drafts d
			LEFT JOIN linear_tickets lt ON lt.draft_id = d.id
			ORDER BY d.created_at DESC`
		)
		.all() as {
			id: string;
			session_id: string;
			title: string;
			description: string;
			assignee_hint: string | null;
			assignee_user_id: string | null;
			state: string;
			created_at: string;
			linear_identifier: string | null;
			linear_url: string | null;
		}[];
	return json({ drafts: rows });
};
