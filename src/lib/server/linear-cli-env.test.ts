import { describe, it, expect, afterEach } from 'vitest';
import { applyLinearCliEnvFromArgv } from './linear-cli-env';

afterEach(() => {
	delete process.env.LINEAR_API_KEY;
	delete process.env.LINEAR_TEAM_ID;
});

describe('applyLinearCliEnvFromArgv', () => {
	it('parses space-separated values', () => {
		applyLinearCliEnvFromArgv([
			'node',
			'server.ts',
			'--linear-api-key',
			'k1',
			'--linear-team-id',
			't1'
		]);
		expect(process.env.LINEAR_API_KEY).toBe('k1');
		expect(process.env.LINEAR_TEAM_ID).toBe('t1');
	});

	it('ignores flags with missing or flag-like next token', () => {
		applyLinearCliEnvFromArgv(['x', '--linear-api-key', '--linear-team-id']);
		expect(process.env.LINEAR_API_KEY).toBeUndefined();
		expect(process.env.LINEAR_TEAM_ID).toBeUndefined();
	});
});
