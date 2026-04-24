import { json, type RequestEvent } from '@sveltejs/kit';
import { getOrCreateDatabase } from '$lib/server/db';
import { assertHubToken } from '$lib/server/auth';
import { error } from '@sveltejs/kit';

type DraftRow = {
	id: string;
	session_id: string;
	title: string;
	description: string;
	assignee_hint: string | null;
	assignee_user_id: string | null;
	state: string;
	created_at: string;
	linear_tickets: { linear_identifier: string | null; url: string | null }[] | null;
};

export const GET = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	const db = getOrCreateDatabase();
	const { data: raw, error: qErr } = await db
		.from('ticket_drafts')
		.select(
			`
			id,
			session_id,
			title,
			description,
			assignee_hint,
			assignee_user_id,
			state,
			created_at,
			linear_tickets ( linear_identifier, url )
		`
		)
		.order('created_at', { ascending: false });
	if (qErr) return error(500, qErr.message);
	const rows = (raw ?? []) as DraftRow[];
	const drafts = rows.map((d) => {
		const lt = Array.isArray(d.linear_tickets) ? d.linear_tickets[0] : d.linear_tickets;
		return {
			id: d.id,
			session_id: d.session_id,
			title: d.title,
			description: d.description,
			assignee_hint: d.assignee_hint,
			assignee_user_id: d.assignee_user_id,
			state: d.state,
			created_at: d.created_at,
			linear_identifier: lt?.linear_identifier ?? null,
			linear_url: lt?.url ?? null
		};
	});
	return json({ drafts });
};
