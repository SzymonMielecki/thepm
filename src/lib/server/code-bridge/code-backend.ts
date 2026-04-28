import { getEnv } from '../config';
import { getProjectPaths } from '../config';
import type { RipgrepResult } from '../ripgrep';
import { callBridge, isBridgeConnected } from './bridge-registry';
import { isPrdPatchBridgeResult, type PrdPatchBridgeResult } from './protocol';
import type { CodeOpName } from './protocol';

let cached: CodeBackend | null = null;

export type CodeBackend = {
	mode: 'bridge';
	workspaceId: string;
	/** Hub-side default path metadata; file ops are executed by the connected bridge. */
	projectRoot: string;
	prdPath: string;
	readFile(relPath: string): Promise<string>;
	writeFile(relPath: string, content: string): Promise<{ ok: true }>;
	listDir(relPath: string): Promise<{ name: string; isDir: boolean }[]>;
	ripgrep(
		pattern: string,
		options?: { subpath?: string; max?: number }
	): Promise<RipgrepResult[]>;
	readPrd(): Promise<string>;
	prdPatch(section: string, newBody: string): Promise<PrdPatchBridgeResult | { ok: false; error: string }>;
	prdWriteFull(content: string): Promise<{ before: string; after: string; skipped?: boolean }>;
};

function createBridge(workspaceId: string): CodeBackend {
	const { projectRoot, prdPath } = getProjectPaths();
	return {
		mode: 'bridge',
		workspaceId,
		projectRoot,
		prdPath,
		readFile: (rel) => callFor('read_file', { path: rel }, workspaceId) as Promise<string>,
		writeFile: (rel, content) =>
			callFor('write_file', { path: rel, content }, workspaceId) as Promise<{ ok: true }>,
		listDir: (rel) => callFor('list_dir', { path: rel ?? '' }, workspaceId) as Promise<
			{ name: string; isDir: boolean }[]
		>,
		ripgrep: async (pattern, options) => {
			const r = (await callFor(
				'ripgrep',
				{ pattern, subpath: options?.subpath, max: options?.max ?? 40 },
				workspaceId
			)) as { hits: RipgrepResult[] };
			return r.hits;
		},
		readPrd: () => callFor('prd_read', {}, workspaceId) as Promise<string>,
		prdPatch: async (section, newBody) => {
			const r = (await callFor('prd_patch', { section, newBody }, workspaceId)) as
				| { ok: true; before: string; after: string; content: string }
				| { ok: false; error: string };
			if (r && 'ok' in r && r.ok) {
				return { ok: true, before: r.before, after: r.after, content: r.content };
			}
			if (r && 'ok' in r && r.ok === false) {
				return { ok: false, error: String((r as { error?: string }).error ?? 'unknown') };
			}
			return { ok: false, error: 'Invalid prd_patch response' };
		},
		prdWriteFull: (content) =>
			callFor('prd_write_full', { content }, workspaceId) as Promise<{
				before: string;
				after: string;
				skipped?: boolean;
			}>
	};
}

async function callFor(
	op: CodeOpName,
	args: Record<string, unknown>,
	workspace: string
): Promise<unknown> {
	return callBridge(workspace, op, args);
}

export function getCodeBackend(): CodeBackend {
	if (cached) return cached;
	const env = getEnv();
	cached = createBridge(env.codeBridgeWorkspaceId);
	return cached;
}

/** @internal tests */
export function _resetCodeBackendForTests() {
	cached = null;
}

export function getCodeBackendWorkspaceId(): string {
	return getEnv().codeBridgeWorkspaceId;
}

export function isBridgeReady(): boolean {
	return isBridgeConnected(getEnv().codeBridgeWorkspaceId);
}
