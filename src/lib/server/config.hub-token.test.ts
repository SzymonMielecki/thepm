import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { deriveHubTokenForProjectRoot } from './config';

describe('deriveHubTokenForProjectRoot', () => {
	it('is stable for the same path', () => {
		const p = resolve('/tmp/foo/bar');
		expect(deriveHubTokenForProjectRoot(p)).toBe(deriveHubTokenForProjectRoot(p));
	});

	it('normalizes to absolute path', () => {
		const a = resolve('/a/b');
		expect(deriveHubTokenForProjectRoot('/a/b')).toBe(deriveHubTokenForProjectRoot(a));
	});

	it('differs for different paths', () => {
		const x = deriveHubTokenForProjectRoot(resolve('/a'));
		const y = deriveHubTokenForProjectRoot(resolve('/b'));
		expect(x).not.toBe(y);
		expect(x.length).toBeGreaterThan(20);
	});
});
