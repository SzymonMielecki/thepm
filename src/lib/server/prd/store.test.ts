import { describe, it, expect } from 'vitest';
import { patchSection } from './store';

describe('patchSection', () => {
	it('replaces body under a matching heading', () => {
		const md = '# A\n\n## Goals\n\nold\n\n## Next\n\nx\n';
		const r = patchSection(md, 'Goals', 'new');
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.out).toContain('## Goals');
			expect(r.out).toContain('new');
			expect(r.out).not.toContain('old');
			expect(r.out).toContain('## Next');
		}
	});

	it('appends a new section if heading missing', () => {
		const md = '# Only\n\n';
		const r = patchSection(md, 'NewSec', 'body');
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.out).toContain('## NewSec');
			expect(r.out).toContain('body');
		}
	});
});
