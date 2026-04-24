import { json, error, type RequestEvent } from '@sveltejs/kit';
import { assertHubToken } from '$lib/server/auth';
import { getOrCreateDatabase, type AppDatabase } from '$lib/server/db';
import { getOrCreateSessionId } from '$lib/server/session';
import { runPmGraph } from '$lib/server/agent/graph';
import { getEnv } from '$lib/server/config';

async function resolveHubSessionId(db: AppDatabase): Promise<string> {
	const { data: fromTx } = await db
		.from('transcripts')
		.select('session_id')
		.order('id', { ascending: false })
		.limit(1)
		.maybeSingle<{ session_id: string }>();
	if (fromTx) return fromTx.session_id;
	const { data: fromDraft } = await db
		.from('ticket_drafts')
		.select('session_id')
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle<{ session_id: string }>();
	if (fromDraft) return fromDraft.session_id;
	return getOrCreateSessionId(db, undefined);
}

export const POST = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}

	let body: { prompt?: string };
	try {
		body = (await event.request.json()) as { prompt?: string };
	} catch {
		return error(400, 'Invalid JSON');
	}
	const prompt = (body.prompt ?? '').trim();
	if (!prompt) return error(400, 'prompt is required');

	try {
		getEnv();
	} catch (e) {
		return error(503, (e as Error).message);
	}

	const db = getOrCreateDatabase();
	const sessionId = await resolveHubSessionId(db);

	try {
		const out = await runPmGraph({
			db,
			sessionId,
			utterance: prompt,
			speakerId: null,
			intentMode: 'hub_manual'
		});
		if (!out.draftId) {
			return error(
				422,
				'Could not produce a draft. Try naming files, components, or the behavior more concretely.'
			);
		}
		return json({ draftId: out.draftId });
	} catch (e) {
		return error(500, (e as Error).message);
	}
};
