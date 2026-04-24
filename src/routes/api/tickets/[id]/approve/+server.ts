import { json, type RequestEvent } from '@sveltejs/kit';
import { getOrCreateDatabase } from '$lib/server/db';
import { assertHubToken } from '$lib/server/auth';
import { error } from '@sveltejs/kit';
import { findUserIdByNameHint, createIssueFromDraft } from '$lib/server/linear';
import { getEnv } from '$lib/server/config';
import { publish } from '$lib/server/bus';
import { applyPrdPatch } from '$lib/server/prd/store';
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
				session_id: string;
				title: string;
				description: string;
				assignee_hint: string | null;
				prd_section: string | null;
				prd_body: string | null;
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
	let prdApplied = false;
	let prdError: string | null = null;
	if (row.prd_section && row.prd_body != null) {
		const prd = await applyPrdPatch(db, row.session_id ?? null, row.prd_section, row.prd_body);
		if (prd.ok) {
			prdApplied = true;
		} else {
			prdError = prd.error;
			publish({
				type: 'agent_trace',
				phase: 'prd_apply',
				detail: `Approved draft PRD patch failed: ${prd.error}`,
				sessionId: row.session_id
			});
		}
	}
	return json({ ok: true, linear: created, prdApplied, prdError });
};
