import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { getSessionSpeakerProfile, resolveDraftAssigneeFromSpeaker } from './speakers';

describe('resolveDraftAssigneeFromSpeaker', () => {
	it('defaults to mapped speaker when no explicit assignee hint exists', () => {
		const out = resolveDraftAssigneeFromSpeaker({
			draftAssigneeHint: undefined,
			profile: {
				sessionId: 's1',
				speakerId: 'spk_1',
				displayName: 'Simon',
				linearUserId: 'lin_1',
				linearName: 'Simon M'
			}
		});
		expect(out).toEqual({ assigneeHint: 'Simon M', assigneeUserId: 'lin_1' });
	});

	it('keeps explicit non-speaker assignee from the model', () => {
		const out = resolveDraftAssigneeFromSpeaker({
			draftAssigneeHint: 'Alex',
			profile: {
				sessionId: 's1',
				speakerId: 'spk_1',
				displayName: 'Simon',
				linearUserId: 'lin_1',
				linearName: 'Simon M'
			}
		});
		expect(out).toEqual({ assigneeHint: 'Alex', assigneeUserId: undefined });
	});

	it('resolves to speaker when hint names the same person', () => {
		const out = resolveDraftAssigneeFromSpeaker({
			draftAssigneeHint: 'Simon',
			profile: {
				sessionId: 's1',
				speakerId: 'spk_1',
				displayName: 'Simon',
				linearUserId: 'lin_1',
				linearName: 'Simon M'
			}
		});
		expect(out).toEqual({ assigneeHint: 'Simon M', assigneeUserId: 'lin_1' });
	});
});

describe('getSessionSpeakerProfile', () => {
	it('loads mapped speaker for a session', () => {
		const db = new Database(':memory:');
		db.exec(`CREATE TABLE session_speakers (
			session_id TEXT NOT NULL,
			speaker_id TEXT NOT NULL,
			display_name TEXT,
			linear_user_id TEXT,
			linear_name TEXT
		)`);
		db.prepare(
			'INSERT INTO session_speakers (session_id, speaker_id, display_name, linear_user_id, linear_name) VALUES (?,?,?,?,?)'
		).run('s1', 'spk_1', 'Simon', 'lin_1', 'Simon M');
		const row = getSessionSpeakerProfile(db as any, 's1', 'spk_1');
		expect(row).toEqual({
			sessionId: 's1',
			speakerId: 'spk_1',
			displayName: 'Simon',
			linearUserId: 'lin_1',
			linearName: 'Simon M'
		});
	});
});
