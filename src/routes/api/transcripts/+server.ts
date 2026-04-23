import { json, error, type RequestEvent } from '@sveltejs/kit';
import { assertHubToken } from '$lib/server/auth';
import { getOrCreateDatabase } from '$lib/server/db';

const DEFAULT_LIMIT = 200;

/**
 * Last N transcript lines (newest first in DB, returned chronological).
 */
export const GET = (event: RequestEvent) => {
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
	const rows = db
		.prepare(
			`SELECT speaker_id AS speakerId, text, created_at AS createdAt
			 FROM transcripts
			 ORDER BY id DESC
			 LIMIT ?`
		)
		.all(limit) as { speakerId: string | null; text: string; createdAt: string }[];
	const lines = rows.reverse().map((r) => ({
		speakerId: r.speakerId,
		text: r.text,
		t: Date.parse(r.createdAt) || Date.now()
	}));
	return json({ lines });
};
