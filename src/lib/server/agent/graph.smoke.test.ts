import { describe, it, expect } from 'vitest';
import { newSessionId, utteranceSuggestsTicketCue } from './graph';

describe('graph helpers', () => {
	it('newSessionId returns a uuid-like string', () => {
		const id = newSessionId();
		expect(id).toMatch(/^[0-9a-f-]{36}$/i);
	});

	it('utteranceSuggestsTicketCue detects informal problem reports', () => {
		expect(utteranceSuggestsTicketCue('The checkout button just spins forever')).toBe(true);
		expect(utteranceSuggestsTicketCue('Users keep complaining about the settings page')).toBe(true);
		expect(utteranceSuggestsTicketCue('Yeah no problem we can ship that')).toBe(false);
		expect(utteranceSuggestsTicketCue('Sounds good')).toBe(false);
	});
});
