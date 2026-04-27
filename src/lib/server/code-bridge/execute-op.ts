import { writeFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { readScopedFile, listScopedDir } from '../fs-scoped';
import { runRipgrep } from '../ripgrep';
import { getPrdContent, patchSection } from '../prd/store';
import type { CodeOpName } from './protocol';
import { detectMuxCapabilities } from './mux/detect';
import {
	handleMuxCancel,
	handleMuxDispatch,
	handleMuxFocus,
	handleMuxNotify,
	handleMuxRemoveWorktree,
	handleMuxStatus
} from './mux-runner';

function readMdFilesInDir(projectRoot: string, relDir: string): { path: string; content: string }[] {
	const abs = join(projectRoot, relDir);
	if (!existsSync(abs)) return [];
	const out: { path: string; content: string }[] = [];
	for (const ent of readdirSync(abs, { withFileTypes: true })) {
		if (!ent.isFile() || !ent.name.endsWith('.md')) continue;
		const fp = join(abs, ent.name);
		const rel = relative(projectRoot, fp).split(sep).join('/');
		out.push({ path: rel, content: readFileSync(fp, 'utf-8') });
	}
	return out;
}

export type CodeBridgeContext = {
	projectRoot: string;
	prdPath: string;
};

/**
 * Runs filesystem/PRD operations on a single machine. Used by `LocalCodeBackend` and
 * the `thepm-bridge` process (must receive the same context from config).
 */
export async function executeCodeOp(
	ctx: CodeBridgeContext,
	op: CodeOpName,
	args: Record<string, unknown>
): Promise<unknown> {
	switch (op) {
		case 'read_file': {
			const rel = typeof args.path === 'string' ? args.path : '';
			if (!rel) throw new Error('read_file: path required');
			return readScopedFile(ctx.projectRoot, rel);
		}
		case 'list_dir': {
			const p = typeof args.path === 'string' ? args.path : '';
			return listScopedDir(ctx.projectRoot, p);
		}
		case 'ripgrep': {
			const pattern = typeof args.pattern === 'string' ? args.pattern : '';
			if (pattern.length < 1) throw new Error('ripgrep: pattern required');
			const subpath = typeof args.subpath === 'string' ? args.subpath : undefined;
			const max = typeof args.max === 'number' ? args.max : 40;
			const hits = await runRipgrep(pattern, { path: subpath, max, projectRoot: ctx.projectRoot });
			return { hits };
		}
		case 'prd_read': {
			return getPrdContent(ctx.prdPath);
		}
		case 'prd_patch': {
			const section = typeof args.section === 'string' ? args.section : '';
			const newBody = typeof args.newBody === 'string' ? args.newBody : '';
			if (!section) throw new Error('prd_patch: section required');
			const before = getPrdContent(ctx.prdPath);
			const r = patchSection(before, section, newBody);
			if (!r.ok) {
				return { ok: false as const, error: r.error };
			}
			const prdDir = dirname(ctx.prdPath);
			if (!existsSync(prdDir)) {
				mkdirSync(prdDir, { recursive: true });
			}
			writeFileSync(ctx.prdPath, r.out, 'utf-8');
			return { ok: true as const, before, after: r.out, content: r.out };
		}
		case 'prd_write_full': {
			const content = typeof args.content === 'string' ? args.content : '';
			const before = getPrdContent(ctx.prdPath);
			if (before === content) {
				return { before, after: content, skipped: true as const };
			}
			const prdDir = dirname(ctx.prdPath);
			if (!existsSync(prdDir)) {
				mkdirSync(prdDir, { recursive: true });
			}
			writeFileSync(ctx.prdPath, content, 'utf-8');
			return { before, after: content };
		}
		case 'mux_capabilities': {
			return detectMuxCapabilities();
		}
		case 'mux_dispatch': {
			return handleMuxDispatch(ctx, args);
		}
		case 'mux_status': {
			return handleMuxStatus(args);
		}
		case 'mux_cancel': {
			return handleMuxCancel(args);
		}
		case 'mux_remove_worktree': {
			return handleMuxRemoveWorktree(ctx.projectRoot, args);
		}
		case 'mux_focus': {
			return handleMuxFocus(args);
		}
		case 'mux_notify': {
			return handleMuxNotify(args);
		}
		case 'get_delegation_repo_files': {
			const claudeAgents = readMdFilesInDir(ctx.projectRoot, join('.claude', 'agents'));
			const claudeTeams = readMdFilesInDir(ctx.projectRoot, join('.claude', 'teams'));
			const teamsJsonPath = join(ctx.projectRoot, '.thepm', 'teams.json');
			let thepmTeamsJson: string | null = null;
			if (existsSync(teamsJsonPath)) {
				thepmTeamsJson = readFileSync(teamsJsonPath, 'utf-8');
			}
			return { claudeAgents, claudeTeams, thepmTeamsJson };
		}
		default: {
			const _x: never = op;
			throw new Error(`Unknown op: ${String(_x)}`);
		}
	}
}

export function getPrdContentAtPath(path: string): string {
	return getPrdContent(path);
}

/** Used by bridge when you already have a buffer (tests). */
export function readScopedFileEx(root: string, rel: string) {
	return readScopedFile(root, rel);
}
