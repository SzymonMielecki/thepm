import { getEnv } from '../config';
import { getProjectPaths } from '../config';
import type { RipgrepResult } from '../ripgrep';
import { callBridge, isBridgeConnected } from './bridge-registry';
import { executeCodeOp, type CodeBridgeContext } from './execute-op';
import { isPrdPatchBridgeResult, type PrdPatchBridgeResult } from './protocol';
import type { CodeOpName } from './protocol';

let cached: CodeBackend | null = null;

export type CodeBackendMode = 'local' | 'bridge';

export type CodeBackend = {
	mode: CodeBackendMode;
	workspaceId: string;
	/** In-process: project root on this machine. In bridge: placeholder for display only. */
	projectRoot: string;
	prdPath: string;
	readFile(relPath: string): Promise<string>;
	listDir(relPath: string): Promise<{ name: string; isDir: boolean }[]>;
	ripgrep(
		pattern: string,
		options?: { subpath?: string; max?: number }
	): Promise<RipgrepResult[]>;
	readPrd(): Promise<string>;
	prdPatch(section: string, newBody: string): Promise<PrdPatchBridgeResult | { ok: false; error: string }>;
	prdWriteFull(content: string): Promise<{ before: string; after: string; skipped?: boolean }>;
};

function ctxForLocal(): CodeBridgeContext {
	const { projectRoot, prdPath } = getProjectPaths();
	return { projectRoot, prdPath };
}

function createLocal(): CodeBackend {
	const { projectRoot, prdPath } = getProjectPaths();
	const ctx = () => ctxForLocal();
	return {
		mode: 'local',
		workspaceId: 'local',
		projectRoot,
		prdPath,
		readFile: (rel) => executeCodeOp(ctx(), 'read_file', { path: rel }) as Promise<string>,
		listDir: (rel) => executeCodeOp(ctx(), 'list_dir', { path: rel ?? '' }) as Promise<
			{ name: string; isDir: boolean }[]
		>,
		ripgrep: async (pattern, options) => {
			const r = (await executeCodeOp(ctx(), 'ripgrep', {
				pattern,
				subpath: options?.subpath,
				max: options?.max
			})) as { hits: RipgrepResult[] };
			return r.hits;
		},
		readPrd: () => executeCodeOp(ctx(), 'prd_read', {}) as Promise<string>,
		prdPatch: async (section, newBody) => {
			const r = (await executeCodeOp(ctx(), 'prd_patch', { section, newBody })) as unknown;
			if (isPrdPatchBridgeResult(r)) {
				return r;
			}
			if (r && typeof r === 'object' && 'ok' in r && (r as { ok: boolean }).ok === false) {
				return { ok: false, error: String((r as { error?: string }).error ?? 'prd_patch failed') };
			}
			return { ok: false, error: 'Invalid prd_patch result' };
		},
		prdWriteFull: (content) =>
			executeCodeOp(ctx(), 'prd_write_full', { content }) as Promise<{
				before: string;
				after: string;
				skipped?: boolean;
			}>
	};
}

function createBridge(workspaceId: string): CodeBackend {
	const { projectRoot, prdPath } = getProjectPaths();
	return {
		mode: 'bridge',
		workspaceId,
		projectRoot,
		prdPath,
		readFile: (rel) => callFor('read_file', { path: rel }, workspaceId) as Promise<string>,
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
	if (env.codeBackend === 'bridge') {
		cached = createBridge(env.codeBridgeWorkspaceId);
	} else {
		cached = createLocal();
	}
	return cached;
}

/** @internal tests */
export function _resetCodeBackendForTests() {
	cached = null;
}

export function isCodeBackendBridge(): boolean {
	return getEnv().codeBackend === 'bridge';
}

export function getCodeBackendWorkspaceId(): string {
	return getEnv().codeBridgeWorkspaceId;
}

export function isBridgeReady(): boolean {
	const env = getEnv();
	if (env.codeBackend !== 'bridge') {
		return true;
	}
	return isBridgeConnected(env.codeBridgeWorkspaceId);
}
