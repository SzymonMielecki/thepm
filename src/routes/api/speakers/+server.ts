import { json, error, type RequestEvent } from '@sveltejs/kit';
import { assertHubToken } from '$lib/server/auth';
import { getOrCreateDatabase } from '$lib/server/db';

type SpeakerRow = {
	session_id: string;
	speaker_id: string;
	display_name: string | null;
	linear_user_id: string | null;
	linear_name: string | null;
	updated_at: string;
};

function resolveSessionId(db: ReturnType<typeof getOrCreateDatabase>, event: RequestEvent): string | null {
	const explicit = event.url.searchParams.get('sessionId')?.trim();
	if (explicit) return explicit;
	const latest = db
		.prepare(
			`SELECT session_id AS sessionId
			 FROM transcripts
			 ORDER BY id DESC
			 LIMIT 1`
		)
		.get() as { sessionId: string } | undefined;
	return latest?.sessionId ?? null;
}

export const GET = (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	const db = getOrCreateDatabase();
	const sessionId = resolveSessionId(db, event);
	if (!sessionId) return json({ sessionId: null, speakers: [], observedSpeakerIds: [] as string[] });

	const speakers = db
		.prepare(
			`SELECT session_id, speaker_id, display_name, linear_user_id, linear_name, updated_at
			 FROM session_speakers
			 WHERE session_id = ?
			 ORDER BY updated_at DESC`
		)
		.all(sessionId) as SpeakerRow[];

	const observedSpeakerIds = db
		.prepare(
			`SELECT DISTINCT speaker_id AS speakerId
			 FROM transcripts
			 WHERE session_id = ? AND speaker_id IS NOT NULL
			 ORDER BY speaker_id`
		)
		.all(sessionId) as { speakerId: string }[];

	return json({
		sessionId,
		speakers: speakers.map((s) => ({
			sessionId: s.session_id,
			speakerId: s.speaker_id,
			displayName: s.display_name,
			linearUserId: s.linear_user_id,
			linearName: s.linear_name,
			updatedAt: s.updated_at
		})),
		observedSpeakerIds: observedSpeakerIds.map((x) => x.speakerId)
	});
};

export const PATCH = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	const body = (await event.request.json()) as {
		sessionId?: string;
		speakerId?: string;
		displayName?: string | null;
		linearUserId?: string | null;
		linearName?: string | null;
	};
	const sessionId = body.sessionId?.trim();
	const speakerId = body.speakerId?.trim();
	if (!sessionId || !speakerId) return error(400, 'sessionId and speakerId are required');
	const displayName = body.displayName?.trim() || null;
	const linearUserId = body.linearUserId?.trim() || null;
	const linearName = body.linearName?.trim() || null;

	const db = getOrCreateDatabase();
	db.prepare(
		`INSERT INTO session_speakers (session_id, speaker_id, display_name, linear_user_id, linear_name, updated_at)
		 VALUES (?,?,?,?,?, datetime('now'))
		 ON CONFLICT(session_id, speaker_id) DO UPDATE SET
			display_name = excluded.display_name,
			linear_user_id = excluded.linear_user_id,
			linear_name = excluded.linear_name,
			updated_at = datetime('now')`
	).run(sessionId, speakerId, displayName, linearUserId, linearName);

	return json({ ok: true });
};

export const POST = PATCH;
