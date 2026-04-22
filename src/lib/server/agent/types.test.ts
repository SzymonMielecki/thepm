import { describe, it, expect } from 'vitest';
import { IntentOutputSchema } from './types';

describe('IntentOutputSchema', () => {
	it('parses a minimal valid payload', () => {
		const r = IntentOutputSchema.safeParse({
			category: 'ticket',
			fileHints: ['LoginPage'],
			ticket: { title: 'Fix auth', acceptance: [] }
		});
		expect(r.success).toBe(true);
	});

	it('rejects bad category', () => {
		const r = IntentOutputSchema.safeParse({ category: 'nope' });
		expect(r.success).toBe(false);
	});
});
