import { json, error, type RequestEvent } from '@sveltejs/kit';
import { assertHubToken } from '$lib/server/auth';
import { getOrCreateDatabase } from '$lib/server/db';
import type { AppDatabase } from '$lib/server/db';

type SpeakerRow = {
	session_id: string;
	speaker_id: string;
	display_name: string | null;
	linear_user_id: string | null;
	linear_name: string | null;
	updated_at: string;
};

async function resolveSessionId(db: AppDatabase, event: RequestEvent): Promise<string | null> {
	const explicit = event.url.searchParams.get('sessionId')?.trim();
	if (explicit) return explicit;
	const { data: latest } = await db
		.from('transcripts')
		.select('session_id')
		.order('id', { ascending: false })
		.limit(1)
		.maybeSingle();
	return latest?.session_id ?? null;
}

export const GET = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	const db = getOrCreateDatabase();
	const sessionId = await resolveSessionId(db, event);
	if (!sessionId) return json({ sessionId: null, speakers: [], observedSpeakerIds: [] as string[] });

	const { data: speakers, error: spErr } = await db
		.from('session_speakers')
		.select('session_id, speaker_id, display_name, linear_user_id, linear_name, updated_at')
		.eq('session_id', sessionId)
		.order('updated_at', { ascending: false });
	if (spErr) return error(500, spErr.message);

	const { data: observedSpeakerIds, error: obErr } = await db
		.from('transcripts')
		.select('speaker_id')
		.eq('session_id', sessionId)
		.not('speaker_id', 'is', null);
	if (obErr) return error(500, obErr.message);
	const seen = new Set<string>();
	for (const r of observedSpeakerIds ?? []) {
		if (r.speaker_id) seen.add(r.speaker_id);
	}

	return json({
		sessionId,
		speakers: (speakers as SpeakerRow[]).map((s) => ({
			sessionId: s.session_id,
			speakerId: s.speaker_id,
			displayName: s.display_name,
			linearUserId: s.linear_user_id,
			linearName: s.linear_name,
			updatedAt: s.updated_at
		})),
		observedSpeakerIds: [...seen].sort()
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
	const now = new Date().toISOString();
	const { error: upErr } = await db.from('session_speakers').upsert(
		{
			session_id: sessionId,
			speaker_id: speakerId,
			display_name: displayName,
			linear_user_id: linearUserId,
			linear_name: linearName,
			updated_at: now
		},
		{ onConflict: 'session_id,speaker_id' }
	);
	if (upErr) return error(500, upErr.message);

	return json({ ok: true });
};

export const POST = PATCH;
