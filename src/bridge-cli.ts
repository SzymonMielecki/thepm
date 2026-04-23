#!/usr/bin/env node
/**
 * Local code bridge: connects to the hub over WebSocket. All per-repo / per-run
 * settings are required on the command line (no ~/.config, no env for hub/repo).
 */
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';
import { z } from 'zod';
import { executeCodeOp, type CodeBridgeContext } from './lib/server/code-bridge/execute-op';
import type { CodeReqMessage } from './lib/server/code-bridge/protocol';

const USAGE = `Usage: thepm-bridge \\
  --hub-url <https://your-hub.example.com> \\
  --token <HUB_TOKEN> \\
  --project-root <path> \\
  --prd <path-to-PRD.md> \\
  [--workspace <id>]     (default: default; must match hub CODE_BRIDGE_WORKSPACE_ID)

Example (run from the repo you are exposing):
  thepm-bridge \\
    --hub-url https://pm.example.com \\
    --token "$HUB_TOKEN" \\
    --project-root . \\
    --prd PRD.md \\
    --workspace default

Options:
  -h, --help    Show this message

Requires: ripgrep (\`rg\`) on PATH. The hub must use CODE_BACKEND=bridge and the same HUB_TOKEN.

Troubleshooting: If you see ECONNREFUSED, the hub is not listening on that URL/port — start the app from
this repo (e.g. pnpm dev) and use the exact origin Vite prints (port may not be 5173 if the port is busy).
`;

const flagsSchema = z.object({
	'hub-url': z.string().url(),
	token: z.string().min(1, 'token must not be empty'),
	'project-root': z.string().min(1, 'project-root must not be empty'),
	prd: z.string().min(1, 'prd must not be empty'),
	workspace: z.string().min(1).default('default')
});

function printUsage() {
	// eslint-disable-next-line no-console
	console.log(USAGE);
}

function parseBridgeCli() {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			'hub-url': { type: 'string' },
			token: { type: 'string' },
			'project-root': { type: 'string' },
			prd: { type: 'string' },
			workspace: { type: 'string' },
			help: { type: 'boolean', short: 'h' }
		},
		allowPositionals: false,
		strict: true
	});
	if (values.help) {
		printUsage();
		process.exit(0);
	}
	const errors: string[] = [];
	if (!values['hub-url']) errors.push('--hub-url is required');
	if (!values.token) errors.push('--token is required');
	if (!values['project-root']) errors.push('--project-root is required');
	if (!values.prd) errors.push('--prd is required');
	if (errors.length) {
		// eslint-disable-next-line no-console
		console.error(errors.join('\n') + '\n');
		printUsage();
		process.exit(1);
	}
	const raw = {
		'hub-url': values['hub-url']!.trim(),
		token: values.token!.trim(),
		'project-root': values['project-root']!.trim(),
		prd: values.prd!.trim(),
		workspace: (values.workspace ?? 'default').trim() || 'default'
	};
	const f = flagsSchema.safeParse(raw);
	if (!f.success) {
		// eslint-disable-next-line no-console
		console.error('Invalid flags:', f.error.format());
		process.exit(1);
	}
	return f.data;
}

function isConnRefused(e: unknown): boolean {
	if (!e) return false;
	const err = e as { code?: string; message?: string; errors?: unknown[] };
	if (err.code === 'ECONNREFUSED') return true;
	if (typeof err.message === 'string' && err.message.includes('ECONNREFUSED')) return true;
	if (Array.isArray(err.errors)) {
		return err.errors.some((x) => isConnRefused(x));
	}
	return false;
}

function printConnRefusedHint(dialUrl: string) {
	// eslint-disable-next-line no-console
	console.error(
		'[thepm-bridge] Nothing accepted the WebSocket (TCP connection refused). Check:\n' +
			'  1) The hub is running in this project: `pnpm dev` (or `pnpm start` after `pnpm build`).\n' +
			"  2) `--hub-url` matches the origin Vite prints (e.g. http://127.0.0.1:5173) — if the port is taken, the port in the log changes.\n" +
			'  3) You are not pointing at another repo or a stopped process.\n' +
			`  Attempted: ${dialUrl}\n`
	);
}

async function main() {
	const f = parseBridgeCli();
	const hubUrl = f['hub-url'].replace(/\/$/, '');
	const projectRoot = resolve(process.cwd(), f['project-root']);
	const prdPath = resolve(process.cwd(), f.prd);
	const workspace = f.workspace;
	const hubToken = f.token;

	const ctx: CodeBridgeContext = { projectRoot, prdPath };
	const u = new URL(hubUrl);
	const protocol = u.protocol === 'https:' ? 'wss:' : u.protocol === 'http:' ? 'ws:' : u.protocol;
	const qs = new URLSearchParams({ token: hubToken, workspace }).toString();
	const url = `${protocol}//${u.host}/api/bridge?${qs}`;
	// eslint-disable-next-line no-console
	console.log(`[thepm-bridge] connecting to ${u.host}/api/bridge (workspace=${workspace})`);
	let reportedConnRefused = false;
	const ws = new WebSocket(url);
	const send = (o: object) => {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify(o));
		}
	};
	ws.on('open', () => {
		send({
			type: 'bridge_hello',
			workspaceId: workspace,
			projectRoot,
			prdPath
		});
	});
	ws.on('message', async (data) => {
		let j: unknown;
		try {
			j = JSON.parse(data.toString());
		} catch {
			return;
		}
		if (!j || typeof j !== 'object') return;
		const t = (j as { type?: string }).type;
		if (t === 'bridge_ack') {
			if ((j as { ok?: boolean }).ok) {
				// eslint-disable-next-line no-console
				console.log('[thepm-bridge] ready');
			} else {
				// eslint-disable-next-line no-console
				console.error('[thepm-bridge] refused:', (j as { error?: string }).error);
				process.exit(1);
			}
			return;
		}
		if (t === 'code_req') {
			const req = j as CodeReqMessage;
			try {
				const result = await executeCodeOp(ctx, req.op, req.args);
				send({ type: 'code_res', id: req.id, ok: true, result });
			} catch (e) {
				const msg = (e as Error).message;
				send({ type: 'code_res', id: req.id, ok: false, error: msg });
			}
		}
	});
	ws.on('close', (c, r) => {
		if (reportedConnRefused) {
			process.exit(1);
			return;
		}
		// eslint-disable-next-line no-console
		console.log('[thepm-bridge] closed', c, r?.toString());
		process.exit(c === 1000 ? 0 : 1);
	});
	ws.on('error', (e) => {
		if (isConnRefused(e)) {
			reportedConnRefused = true;
			printConnRefusedHint(url);
		} else {
			// eslint-disable-next-line no-console
			console.error('[thepm-bridge]', e);
		}
	});
}

void main().catch((e) => {
	// eslint-disable-next-line no-console
	console.error(e);
	process.exit(1);
});
