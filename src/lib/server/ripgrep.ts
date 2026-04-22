import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { getProjectPaths } from './config';

const pExec = promisify(execFile);

export type RipgrepResult = { path: string; line: number; text: string };

let warnedMissing = false;

export async function ensureRipgrep(): Promise<void> {
	try {
		await pExec('rg', ['--version'], { env: process.env, maxBuffer: 1024 * 1024 });
	} catch {
		if (!warnedMissing) {
			console.error(
				'[ripgrep] `rg` not found in PATH. Install: https://github.com/BurntSushi/ripgrep#installation'
			);
			warnedMissing = true;
		}
		throw new Error('`rg` (ripgrep) is not installed or not in PATH');
	}
}

/**
 * Returns JSON line matches. Limited to `max` results.
 * Exit code 1 = no matches (per ripgrep).
 */
export async function runRipgrep(
	pattern: string,
	options?: { max?: number; path?: string }
): Promise<RipgrepResult[]> {
	await ensureRipgrep();
	const { projectRoot } = getProjectPaths();
	const max = options?.max ?? 40;
	const target = options?.path ?? '.';
	const args = [
		'--json',
		'--line-number',
		'--no-heading',
		'--max-count',
		String(max),
		pattern,
		target
	];
	let stdout: string;
	try {
		const r = await pExec('rg', args, {
			cwd: projectRoot,
			maxBuffer: 8 * 1024 * 1024,
			env: process.env
		});
		stdout = r.stdout.toString();
	} catch (e: unknown) {
		const err = e as { code?: number; stdout?: string | Buffer };
		if (err.code === 1) return [];
		if (err.stdout) stdout = err.stdout.toString();
		else throw e;
	}
	const lines: RipgrepResult[] = [];
	for (const line of stdout.split('\n')) {
		if (!line.trim()) continue;
		try {
			const j = JSON.parse(line) as {
				type: string;
				data?: {
					path?: { text: string };
					line_number: number;
					lines?: { text: string };
				};
			};
			if (j.type === 'match' && j.data?.path?.text) {
				lines.push({
					path: j.data.path.text,
					line: j.data.line_number,
					text: (j.data.lines?.text ?? '').replace(/^\n?/, '')
				});
			}
		} catch {
			// ignore
		}
	}
	return lines;
}

export function spawnRipgrep(pattern: string, subpath = '.'): ChildProcess {
	return spawn('rg', ['--json', '-C', '1', pattern, subpath], {
		cwd: getProjectPaths().projectRoot
	});
}
