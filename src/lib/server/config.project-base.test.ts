import { describe, it, expect, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { projectBaseDir, deriveHubTokenForProjectRoot, getEnv } from './config';

const keys = ['THEPM_INVOCATION_CWD', 'PROJECT_ROOT', 'CODE_BACKEND'] as const;

function clearEnv() {
	for (const k of keys) {
		delete process.env[k];
	}
}

afterEach(() => {
	clearEnv();
});

describe('projectBaseDir', () => {
	it('prefers THEPM_INVOCATION_CWD over PROJECT_ROOT', () => {
		const inv = resolve('/app/other-repo');
		const proj = resolve('/install/thepm');
		process.env.THEPM_INVOCATION_CWD = inv;
		process.env.PROJECT_ROOT = proj;
		expect(projectBaseDir()).toBe(inv);
	});

	it('uses PROJECT_ROOT when THEPM is unset', () => {
		const proj = resolve('/opt/myproject');
		process.env.PROJECT_ROOT = proj;
		expect(projectBaseDir()).toBe(proj);
	});

	it('derived token changes when THEPM path changes', () => {
		const a = resolve('/tmp/repo-a');
		const b = resolve('/tmp/repo-b');
		process.env.THEPM_INVOCATION_CWD = a;
		process.env.PROJECT_ROOT = resolve('/ignore-me');
		const tA = deriveHubTokenForProjectRoot(projectBaseDir());
		process.env.THEPM_INVOCATION_CWD = b;
		const tB = deriveHubTokenForProjectRoot(projectBaseDir());
		expect(tA).not.toBe(tB);
	});

	it('does not expose CODE_BACKEND in env config', () => {
		process.env.CODE_BACKEND = 'local';
		const env = getEnv() as Record<string, unknown>;
		expect('codeBackend' in env).toBe(false);
	});
});
