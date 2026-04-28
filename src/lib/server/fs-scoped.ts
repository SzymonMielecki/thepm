import { mkdirSync, readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export function isPathInsideRoot(root: string, candidate: string): boolean {
	const r = resolve(root);
	const t = resolve(candidate);
	const rel = relative(r, t);
	if (rel === '' || rel === '.') return true;
	return !rel.startsWith('..') && !resolve(r, rel).startsWith('..');
}

export function readScopedFile(root: string, relPath: string): string {
	const abs = join(root, relPath);
	if (!isPathInsideRoot(root, abs)) throw new Error('Path escapes PROJECT_ROOT');
	if (!existsSync(abs) || !statSync(abs).isFile()) {
		throw new Error('File not found or not a file');
	}
	return readFileSync(abs, 'utf-8');
}

export function listScopedDir(
	root: string,
	relPath: string
): { name: string; isDir: boolean }[] {
	const abs = relPath ? join(root, relPath) : root;
	if (!isPathInsideRoot(root, abs)) throw new Error('Path escapes PROJECT_ROOT');
	if (!existsSync(abs) || !statSync(abs).isDirectory()) {
		return [];
	}
	return readdirSync(abs).map((name) => ({
		name,
		isDir: statSync(join(abs, name)).isDirectory()
	}));
}

export function resolveInRoot(root: string, p: string) {
	const abs = resolve(root, p);
	if (!isPathInsideRoot(root, abs)) throw new Error('Path escapes PROJECT_ROOT');
	return abs;
}

/** `__context/0/rel/path` addresses the Nth bridge `--context-root` (0-based). Otherwise paths are relative to primary project root. */
const CONTEXT_PATH = /^__context\/(\d+)\/(.*)$/;

export function resolveMultiRootRead(
	primary: string,
	contextRoots: string[],
	relPath: string
): { root: string; relInRoot: string } {
	const m = relPath.match(CONTEXT_PATH);
	if (!m) return { root: primary, relInRoot: relPath };
	const idx = Number(m[1]);
	const rest = m[2] ?? '';
	if (!Number.isInteger(idx) || idx < 0 || idx >= contextRoots.length) {
		throw new Error(
			`Invalid path: __context/${m[1]}/… — bridge reported ${contextRoots.length} extra context root(s) (use --context-root).`
		);
	}
	return { root: contextRoots[idx], relInRoot: rest };
}

/** Create parent dirs as needed; rejects directory paths and path traversal. */
export function writeScopedFile(root: string, relPath: string, content: string): void {
	const norm = relPath.replace(/^[/\\]+/, '');
	if (!norm || norm.endsWith('/') || norm.endsWith('\\')) {
		throw new Error('write_file: path must be a file path');
	}
	const abs = join(root, norm);
	if (!isPathInsideRoot(root, abs)) throw new Error('Path escapes PROJECT_ROOT');
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, content, 'utf-8');
}
