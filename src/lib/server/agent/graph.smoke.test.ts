import { describe, it, expect } from 'vitest';
import { newSessionId } from './graph';

describe('graph helpers', () => {
	it('newSessionId returns a uuid-like string', () => {
		const id = newSessionId();
		expect(id).toMatch(/^[0-9a-f-]{36}$/i);
	});
});
