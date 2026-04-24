import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { getChatModel, invokeWithStructuredZod } from '../agent/llm';
import { callBridge } from '../code-bridge/bridge-registry';
import { getEnv } from '../config';
import { getOrCreateDatabase } from '../db';
import { publish } from '../bus';
import { isStubOrEmptyPrd } from '$lib/prd/is-stub-or-empty';
import { writePrdWithRevision } from './store';
import { z } from 'zod';

const PrdFromRepoSchema = z.object({
	/** Full markdown for PRD.md (H1, sections, etc.) */
	prd: z.string().min(1)
});

const MAX_FILE_SNIP = 8_000;
const MAX_CTX = 20_000;

const bootstrapPrompt = `You write a product requirements document (PRD) in GitHub-flavored Markdown, grounded in the evidence provided (file lists, manifests, README, search hits). Do not invent features not suggested by the repo; use an "Open questions" section for gaps. Standard sections: title (#), Vision, Goals, Technical overview, Features / scope (inferred from structure), Non-goals, Decisions, Risks, Open questions. Be concise.`;

const inFlight = new Set<string>();

export type PrdContextOps = {
	listDir: (path: string) => Promise<{ name: string; isDir: boolean }[]>;
	readFile: (path: string) => Promise<string>;
	ripgrep: (pattern: string, max: number) => Promise<{ path: string; line: number; text: string }[]>;
};

async function tryReadFile(ops: PrdContextOps, rel: string, max: number): Promise<string | null> {
	try {
		const raw = await ops.readFile(rel);
		if (raw.length > max) {
			return `${raw.slice(0, max)}\n\n[... truncated for PRD bootstrap …]`;
		}
		return raw;
	} catch {
		return null;
	}
}

/**
 * Scans the repo (list_dir, a few key files, ripgrep sample) for LLM context.
 * Shared by local hub startup and `thepm bridge` connect.
 */
export async function collectPrdContextForOps(ops: PrdContextOps): Promise<string> {
	const parts: string[] = [];
	try {
		const top = await ops.listDir('');
		parts.push('## Top-level entries\n' + top.map((e) => `- ${e.isDir ? '(dir) ' : ''}${e.name}`).join('\n'));
	} catch (e) {
		parts.push('## Top-level: (unavailable) ' + (e as Error).message);
	}

	const readFirst = [
		'package.json',
		'package-lock.json',
		'README.md',
		'Readme.md',
		'go.mod',
		'Cargo.toml',
		'pyproject.toml',
		'build.gradle',
		'pom.xml',
		'compose.yaml',
		'docker-compose.yml'
	];
	for (const rel of readFirst) {
		const c = await tryReadFile(ops, rel, MAX_FILE_SNIP);
		if (c) parts.push(`## File: ${rel}\n\`\`\`\n${c}\n\`\`\``);
	}

	for (const sub of ['src', 'lib', 'app', 'cmd', 'internal']) {
		try {
			const ch = await ops.listDir(sub);
			if (ch.length) {
				parts.push(
					`## ${sub}/ (sample)\n` + ch.slice(0, 40).map((e) => `- ${e.isDir ? '(dir) ' : ''}${e.name}`).join('\n')
				);
				break;
			}
		} catch {
			// skip
		}
	}

	try {
		const hits = await ops.ripgrep('function|class |def |func ', 12);
		if (hits?.length) {
			const lines = hits
				.slice(0, 12)
				.map((h) => `${h.path}:${h.line} ${h.text.slice(0, 200)}`)
				.join('\n');
			parts.push('## Code shape (ripgrep sample)\n```\n' + lines + '\n```');
		}
	} catch {
		// optional
	}

	const joined = parts.join('\n\n');
	if (joined.length > MAX_CTX) {
		return joined.slice(0, MAX_CTX) + '\n\n[… context truncated …]';
	}
	return joined;
}

function prdContextOpsFromBridge(workspaceId: string): PrdContextOps {
	return {
		listDir: (path) => callBridge(workspaceId, 'list_dir', { path }) as Promise<{ name: string; isDir: boolean }[]>,
		readFile: (path) => callBridge(workspaceId, 'read_file', { path }) as Promise<string>,
		ripgrep: async (pattern, max) => {
			const r = (await callBridge(workspaceId, 'ripgrep', { pattern, max })) as {
				hits: { path: string; line: number; text: string }[];
			};
			return r.hits;
		}
	};
}

/** @deprecated use collectPrdContextForOps(prdContextOpsFromBridge(id)) */
export async function collectRepoContextForPrdBootstrap(workspaceId: string): Promise<string> {
	return collectPrdContextForOps(prdContextOpsFromBridge(workspaceId));
}

type PrdReadWrite = {
	readPrd: () => Promise<string>;
	prdWriteFull: (content: string) => Promise<{ before: string; after: string; skipped?: boolean }>;
};

async function runPrdAutoBootstrap(
	ctxOps: PrdContextOps,
	rw: PrdReadWrite,
	traceSession: string,
	summary: string
): Promise<void> {
	const env = getEnv();
	const mode = env.bridgePrdBootstrap;
	if (mode === 'off') return;

	publish({ type: 'agent_trace', phase: 'prd_bootstrap', detail: `start ${traceSession}`, sessionId: traceSession });

	let current: string;
	try {
		current = await rw.readPrd();
	} catch (e) {
		publish({
			type: 'agent_trace',
			phase: 'prd_bootstrap',
			detail: `prd_read failed: ${(e as Error).message}`,
			sessionId: traceSession
		});
		return;
	}

	if (mode === 'if_empty' && !isStubOrEmptyPrd(current)) {
		publish({ type: 'agent_trace', phase: 'prd_bootstrap', detail: 'skip: PRD already has content', sessionId: traceSession });
		return;
	}

	let ctx: string;
	try {
		ctx = await collectPrdContextForOps(ctxOps);
	} catch (e) {
		publish({
			type: 'agent_trace',
			phase: 'prd_bootstrap',
			detail: `context: ${(e as Error).message}`,
			sessionId: traceSession
		});
		return;
	}

	let markdown: string;
	try {
		const model = getChatModel();
		const out = await invokeWithStructuredZod(model, PrdFromRepoSchema, [
			new SystemMessage(bootstrapPrompt),
			new HumanMessage(
				`Repository evidence for the product:\n\n${ctx || '(no files collected — produce a minimal template PRD)'}`
			)
		]);
		markdown = out.prd.trim();
	} catch (e) {
		publish({
			type: 'agent_trace',
			phase: 'prd_bootstrap',
			detail: `LLM failed: ${(e as Error).message}`,
			sessionId: traceSession
		});
		return;
	}

	if (!markdown.length) {
		publish({
			type: 'agent_trace',
			phase: 'prd_bootstrap',
			detail: 'LLM returned empty PRD',
			sessionId: traceSession
		});
		return;
	}

	try {
		const w = await rw.prdWriteFull(markdown);
		if (w.skipped) {
			publish({ type: 'agent_trace', phase: 'prd_bootstrap', detail: 'unchanged (identical content)', sessionId: traceSession });
			return;
		}
		const db = getOrCreateDatabase();
		await writePrdWithRevision(db, null, summary, w.before, w.after, { skipFileWrite: true });
		publish({ type: 'agent_trace', phase: 'prd_bootstrap', detail: 'wrote PRD from repo context', sessionId: traceSession });
	} catch (e) {
		publish({
			type: 'agent_trace',
			phase: 'prd_bootstrap',
			detail: `write failed: ${(e as Error).message}`,
			sessionId: traceSession
		});
	}
}

/**
 * When `thepm-bridge` connects, optionally generate initial PRD.md from repo + LLM.
 * Uses `callBridge` for this `workspaceId` (not `getCodeBackend()`), so it matches the connected socket.
 */
export async function runBridgePrdBootstrap(workspaceId: string): Promise<void> {
	const ctxOps = prdContextOpsFromBridge(workspaceId);
	const rw: PrdReadWrite = {
		readPrd: () => callBridge(workspaceId, 'prd_read', {}) as Promise<string>,
		prdWriteFull: (content) =>
			callBridge(workspaceId, 'prd_write_full', { content }) as Promise<{
				before: string;
				after: string;
				skipped?: boolean;
			}>
	};
	await runPrdAutoBootstrap(
		ctxOps,
		rw,
		`bridge workspace=${workspaceId}`,
		'PRD auto-generated from repository on bridge connect'
	);
}

export function scheduleBridgePrdBootstrap(workspaceId: string): void {
	if (inFlight.has(workspaceId)) return;
	inFlight.add(workspaceId);
	setImmediate(() => {
		void runBridgePrdBootstrap(workspaceId)
			.catch((e) => {
				publish({
					type: 'agent_trace',
					phase: 'prd_bootstrap',
					detail: `unhandled: ${(e as Error).message}`,
					sessionId: 'bridge'
				});
			})
			.finally(() => {
				inFlight.delete(workspaceId);
			});
	});
}
