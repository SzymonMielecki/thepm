import type { AppDatabase } from './db';

type SessionSpeakerRow = {
	session_id: string;
	speaker_id: string;
	display_name: string | null;
	linear_user_id: string | null;
	linear_name: string | null;
};

export type SessionSpeakerProfile = {
	sessionId: string;
	speakerId: string;
	displayName: string | null;
	linearUserId: string | null;
	linearName: string | null;
};

export async function getSessionSpeakerProfile(
	db: AppDatabase,
	sessionId: string,
	speakerId: string | null
): Promise<SessionSpeakerProfile | null> {
	if (!speakerId) return null;
	const { data: row } = await db
		.from('session_speakers')
		.select('session_id, speaker_id, display_name, linear_user_id, linear_name')
		.eq('session_id', sessionId)
		.eq('speaker_id', speakerId)
		.maybeSingle<SessionSpeakerRow>();
	if (!row) return null;
	return {
		sessionId: row.session_id,
		speakerId: row.speaker_id,
		displayName: row.display_name,
		linearUserId: row.linear_user_id,
		linearName: row.linear_name
	};
}

function normalize(value: string): string {
	return value.trim().toLowerCase();
}

/**
 * Prefer explicit non-speaker assignee from LLM. Otherwise default to mapped speaker Linear identity.
 */
export function resolveDraftAssigneeFromSpeaker(input: {
	draftAssigneeHint: string | undefined;
	profile: SessionSpeakerProfile | null;
}): { assigneeHint: string | undefined; assigneeUserId: string | undefined } {
	const { draftAssigneeHint, profile } = input;
	const hint = draftAssigneeHint?.trim();
	if (!profile?.linearUserId) {
		return { assigneeHint: hint || undefined, assigneeUserId: undefined };
	}
	if (!hint) {
		return {
			assigneeHint: profile.linearName || profile.displayName || undefined,
			assigneeUserId: profile.linearUserId
		};
	}
	const names = [profile.displayName, profile.linearName]
		.filter((x): x is string => !!x?.trim())
		.map(normalize);
	if (!names.length) {
		return { assigneeHint: hint, assigneeUserId: undefined };
	}
	const samePerson = names.some((n) => n.includes(normalize(hint)) || normalize(hint).includes(n));
	if (samePerson) {
		return {
			assigneeHint: profile.linearName || profile.displayName || hint,
			assigneeUserId: profile.linearUserId
		};
	}
	return { assigneeHint: hint, assigneeUserId: undefined };
}
