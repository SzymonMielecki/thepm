import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleMuxRemoveWorktree } from './mux-runner';

describe('mux-runner worktree cleanup', () => {
	let main: string;
	let wt: string;

	beforeAll(() => {
		main = mkdtempSync(join(tmpdir(), 'thepm-main-'));
		execSync('git init', { cwd: main, stdio: 'pipe' });
		execSync('git config user.email "t@example.com"', { cwd: main, stdio: 'pipe' });
		execSync('git config user.name "t"', { cwd: main, stdio: 'pipe' });
		writeFileSync(join(main, 'f.txt'), 'x');
		execSync('git add f.txt && git commit -m init', { cwd: main, stdio: 'pipe' });
		wt = join(main, 'wt');
		execSync(`git worktree add -b b1 "${wt}" HEAD`, { cwd: main, stdio: 'pipe' });
	});

	afterAll(() => {
		if (existsSync(wt)) {
			try {
				execSync(`git worktree remove -f "${wt}"`, { cwd: main, stdio: 'pipe' });
			} catch {
				/* ignore */
			}
		}
	});

	it('mux_remove_worktree removes path', async () => {
		await handleMuxRemoveWorktree(main, { path: wt });
		expect(existsSync(wt)).toBe(false);
	});
});
