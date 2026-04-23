import { describe, it, expect } from 'vitest';
import { IntentOutputSchema, PrdSectionPatchSchema } from './types';

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

	it('maps prd.body to newBody', () => {
		const r = IntentOutputSchema.safeParse({
			category: 'prd_update',
			prd: { section: 'Goals', body: 'Do the thing' }
		});
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.prd?.newBody).toBe('Do the thing');
			expect(r.data.alsoCreateTicket).toBe(false);
		}
	});

	it('accepts alsoCreateTicket on prd_update', () => {
		const r = IntentOutputSchema.safeParse({
			category: 'prd_update',
			alsoCreateTicket: true,
			fileHints: ['api'],
			prd: { section: 'Goals', newBody: 'Ship feature' }
		});
		expect(r.success).toBe(true);
		if (r.success) expect(r.data.alsoCreateTicket).toBe(true);
	});
});

describe('PrdSectionPatchSchema', () => {
	it('accepts body as alias for newBody', () => {
		const r = PrdSectionPatchSchema.safeParse({ section: 'Vision', body: 'x' });
		expect(r.success).toBe(true);
		if (r.success) expect(r.data.newBody).toBe('x');
	});
});
