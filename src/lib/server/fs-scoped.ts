import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

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
