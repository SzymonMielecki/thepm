import { json, error, type RequestEvent } from '@sveltejs/kit';
import { assertHubToken } from '$lib/server/auth';
import { getOrCreateDatabase } from '$lib/server/db';

const DEFAULT_LIMIT = 200;

/**
 * Last N transcript lines (newest first in DB, returned chronological).
 */
export const GET = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	const limit = Math.min(
		500,
		Math.max(1, Number(event.url.searchParams.get('limit')) || DEFAULT_LIMIT)
	);
	const db = getOrCreateDatabase();
	const { data: rows, error: qErr } = await db
		.from('transcripts')
		.select('speaker_id, text, created_at')
		.order('id', { ascending: false })
		.limit(limit);
	if (qErr) return error(500, qErr.message);
	const lines = (rows ?? []).reverse().map((r) => ({
		speakerId: r.speaker_id,
		text: r.text,
		t: Date.parse(r.created_at as string) || Date.now()
	}));
	return json({ lines });
};
