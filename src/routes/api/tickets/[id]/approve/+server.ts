import { json, type RequestEvent } from '@sveltejs/kit';
import { getOrCreateDatabase } from '$lib/server/db';
import { assertHubToken } from '$lib/server/auth';
import { error } from '@sveltejs/kit';
import { findUserIdByNameHint, createIssueFromDraft, isLinearApiConfigured } from '$lib/server/linear';
import { publish } from '$lib/server/bus';
import { applyPrdPatch } from '$lib/server/prd/store';

type ApproveDraftRow = {
	state: string;
	assignee_user_id: string | null;
	assignee_hint: string | null;
	title: string;
	description: string;
	prd_section: string | null;
	prd_body: string | null;
	session_id: string | null;
};

export const POST = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	if (!isLinearApiConfigured()) {
		return error(503, 'LINEAR_API_KEY is not configured (hub env or bridge --linear-api-key)');
	}
	const id = event.params.id;
	if (!id) return error(400, 'id');
	const db = getOrCreateDatabase();
	const { data: row, error: qErr } = await db
		.from('ticket_drafts')
		.select('*')
		.eq('id', id)
		.maybeSingle<ApproveDraftRow>();
	if (qErr) return error(500, qErr.message);
	if (!row) return error(404, 'draft not found');
	if (row.state !== 'pending') {
		return json({ ok: true, already: true });
	}
	const assignee = row.assignee_user_id ?? (await findUserIdByNameHint(row.assignee_hint));
	const created = await createIssueFromDraft({
		title: row.title,
		description: row.description,
		assigneeUserId: assignee
	});
	const { error: upDraftErr } = await db.from('ticket_drafts').update({ state: 'approved' }).eq('id', id);
	if (upDraftErr) return error(500, upDraftErr.message);
	const { error: upLinErr } = await db.from('linear_tickets').upsert(
		{
			id: created.id,
			draft_id: id,
			linear_identifier: created.identifier ?? '',
			url: created.url ?? ''
		},
		{ onConflict: 'id' }
	);
	if (upLinErr) return error(500, upLinErr.message);
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
				sessionId: row.session_id ?? undefined
			});
		}
	}
	return json({ ok: true, linear: created, prdApplied, prdError });
};
