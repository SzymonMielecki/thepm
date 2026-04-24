#!/usr/bin/env node
/**
 * Local code bridge: connects to the hub over WebSocket. Hub URL, project root,
 * and PRD path default for local dev; override with flags (no ~/.config, no env for hub/repo).
 */
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { z } from 'zod';
import { executeCodeOp, type CodeBridgeContext } from './lib/server/code-bridge/execute-op';
import type { CodeReqMessage } from './lib/server/code-bridge/protocol';

const DEFAULT_HUB_URL = 'http://127.0.0.1:5173';
const DEFAULT_PROJECT_ROOT = '.';
const DEFAULT_PRD = 'PRD.md';

const USAGE = `Usage: thepm bridge \\
  [--hub-url <url>]      (default: ${DEFAULT_HUB_URL}) \\
  [--project-root <path>]  (default: ${DEFAULT_PROJECT_ROOT}) \\
  [--prd <path-to-PRD.md>] (default: ${DEFAULT_PRD}) \\
  [--token <BRIDGE_TOKEN>] \\
  [--workspace <id>]     (default: default; must match hub CODE_BRIDGE_WORKSPACE_ID) \\
  [--linear-api-key <key>] [--linear-team-id <uuid>]  (override hub LINEAR_* for this connection; \\
                          alias: --lin-team-id)

Example (local hub on Vite’s default port — flags optional):
  thepm bridge

Example (remote or non-default paths):
  thepm bridge \\
  --hub-url https://pm.example.com \\
  --project-root . \\
  --prd PRD.md \\
  --workspace default

(Older installs may still invoke \`thepm-bridge\` with the same flags.)

Options:
  -h, --help    Show this message

Requires: ripgrep (\`rg\`) on PATH. If \`--token\` is omitted, a UUID token is generated for this connection.
After a successful connect, the hub may auto-generate PRD.md from this repo (see hub env \`BRIDGE_PRD_BOOTSTRAP\`; requires an LLM configured on the hub).

Troubleshooting: If you see ECONNREFUSED, the hub is not listening on that URL/port — start the app from
this repo (e.g. pnpm dev) and use the exact origin Vite prints (port may not be 5173 if the port is busy).
`;

const flagsSchema = z.object({
	'hub-url': z.string().url(),
	token: z.string().min(1, 'token must not be empty').optional(),
	'project-root': z.string().min(1, 'project-root must not be empty'),
	prd: z.string().min(1, 'prd must not be empty'),
	workspace: z.string().min(1).default('default'),
	'linear-api-key': z.string().optional(),
	'linear-team-id': z.string().optional()
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
			'linear-api-key': { type: 'string' },
			'linear-team-id': { type: 'string' },
			'lin-team-id': { type: 'string' },
			help: { type: 'boolean', short: 'h' }
		},
		allowPositionals: false,
		strict: true
	});
	if (values.help) {
		printUsage();
		process.exit(0);
	}
	const teamFromBridge =
		values['linear-team-id']?.trim() || values['lin-team-id']?.trim();
	const raw = {
		'hub-url': values['hub-url']?.trim() || DEFAULT_HUB_URL,
		token: values.token?.trim(),
		'project-root': values['project-root']?.trim() || DEFAULT_PROJECT_ROOT,
		prd: values.prd?.trim() || DEFAULT_PRD,
		workspace: (values.workspace ?? 'default').trim() || 'default',
		'linear-api-key': values['linear-api-key']?.trim(),
		'linear-team-id': teamFromBridge
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

function uiUrlWithSession(
	hubUrl: string,
	routePath: string,
	sessionToken: string,
	token?: string
): string {
	const u = new URL(routePath, hubUrl);
	u.searchParams.set('bridge_session', sessionToken);
	if (token) u.searchParams.set('token', token);
	return u.toString();
}

function uiUrlWithToken(hubUrl: string, routePath: string, token: string): string {
	const u = new URL(routePath, hubUrl);
	u.searchParams.set('token', token);
	return u.toString();
}

async function main() {
	const f = parseBridgeCli();
	const hubUrl = f['hub-url'].replace(/\/$/, '');
	const projectRoot = resolve(process.cwd(), f['project-root']);
	const prdPath = resolve(process.cwd(), f.prd);
	const workspace = f.workspace;
	const hubToken = f.token?.trim() || randomUUID();

	const ctx: CodeBridgeContext = { projectRoot, prdPath };
	const u = new URL(hubUrl);
	const protocol = u.protocol === 'https:' ? 'wss:' : u.protocol === 'http:' ? 'ws:' : u.protocol;
	const qp: Record<string, string> = { workspace };
	if (hubToken) qp.token = hubToken;
	const qs = new URLSearchParams(qp).toString();
	const url = `${protocol}//${u.host}/api/bridge?${qs}`;
	// eslint-disable-next-line no-console
	console.log(`[thepm-bridge] connecting to ${u.host}/api/bridge (workspace=${workspace})`);
	if (!f.token) {
		// eslint-disable-next-line no-console
		console.log(`[thepm-bridge] Generated bridge token: ${hubToken}`);
	}
	let reportedConnRefused = false;
	const ws = new WebSocket(url);
	ws.on('unexpected-response', (_req, res) => {
		const c = res.statusCode ?? 0;
		if (c === 404) {
			// eslint-disable-next-line no-console
			console.error(
				'[thepm-bridge] The hub at this URL has no /api/bridge WebSocket (HTTP 404 on upgrade). ' +
					'Vercel and similar serverless deploys do not run the Node hub that attaches the bridge. ' +
					'Build and start the hub from this same repo: `pnpm build && thepm` (or `pnpm dev`); use the printed origin in `--hub-url`, or use a long-lived host that runs `server.ts`.\n' +
					'  (If you are sure the hub is the Node process, the site may be the wrong app or a stale deployment.)'
			);
		} else {
			// eslint-disable-next-line no-console
			console.error(
				`[thepm-bridge] WebSocket upgrade failed: HTTP ${c} ${res.statusMessage || ''}`.trim()
			);
		}
	});
	const send = (o: object) => {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify(o));
		}
	};
	ws.on('open', () => {
		const hello: Record<string, unknown> = {
			type: 'bridge_hello',
			workspaceId: workspace,
			projectRoot,
			prdPath
		};
		const lk = f['linear-api-key']?.trim();
		const lt = f['linear-team-id']?.trim();
		if (lk) hello.linearApiKey = lk;
		if (lt) hello.linearTeamId = lt;
		send(hello);
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
				const sessionToken = (j as { uiSessionToken?: string }).uiSessionToken;
				const sessionExpiresAt = (j as { uiSessionExpiresAt?: number }).uiSessionExpiresAt;
				// eslint-disable-next-line no-console
				console.log('[thepm-bridge] ready');
				if (sessionToken) {
					// eslint-disable-next-line no-console
					console.log(
						`[thepm-bridge] Open dashboard: ${uiUrlWithSession(hubUrl, '/', sessionToken, hubToken)}`
					);
					// eslint-disable-next-line no-console
					console.log(
						`[thepm-bridge] Open mobile:    ${uiUrlWithSession(hubUrl, '/mobile', sessionToken, hubToken)}`
					);
					if (typeof sessionExpiresAt === 'number' && Number.isFinite(sessionExpiresAt)) {
						// eslint-disable-next-line no-console
						console.log(
							`[thepm-bridge] Session expires: ${new Date(sessionExpiresAt).toISOString()}`
						);
					}
				}
				// eslint-disable-next-line no-console
				console.log(
					`[thepm-bridge] Open dashboard (token): ${uiUrlWithToken(hubUrl, '/', hubToken)}`
				);
				// eslint-disable-next-line no-console
				console.log(
					`[thepm-bridge] Open mobile (token):    ${uiUrlWithToken(hubUrl, '/mobile', hubToken)}`
				);
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
