import { describe, expect, it } from 'vitest';
import { resolveDraftAssigneeFromSpeaker } from './speakers';

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
