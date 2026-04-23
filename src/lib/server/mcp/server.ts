import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { getCodeBackend } from '../code-bridge/code-backend';
import { applyPrdPatch, readPrdForHub } from '../prd/store';
import { getOrCreateDatabase } from '../db';
import { z } from 'zod';
import { getOrCreateSessionId } from '../session';

/**
 * Fresh MCP server per HTTP request (stateless), same as SDK Hono example.
 * Code tools use `CodeBackend` (local disk or thepm-bridge to the dev machine when CODE_BACKEND=bridge).
 */
export function createMcpServer() {
	const server = new McpServer({ name: 'always-on-pm', version: '0.1.0' });

	server.registerTool(
		'read_file',
		{
			description: 'Read a UTF-8 file under PROJECT_ROOT (relative path).',
			inputSchema: { path: z.string().describe('Relative path from project root') }
		},
		async ({ path: rel }) => {
			const b = getCodeBackend();
			const content = await b.readFile(rel);
			return { content: [{ type: 'text' as const, text: content }] };
		}
	);

	server.registerTool(
		'list_dir',
		{
			description: 'List files in a directory under PROJECT_ROOT.',
			inputSchema: { path: z.string().optional().describe('Relative path, default root') }
		},
		async ({ path: p }) => {
			const b = getCodeBackend();
			const list = await b.listDir(p ?? '');
			return { content: [{ type: 'text' as const, text: JSON.stringify(list, null, 2) }] };
		}
	);

	server.registerTool(
		'ripgrep',
		{
			description: 'Search the codebase with ripgrep (live).',
			inputSchema: {
				pattern: z.string(),
				subpath: z.string().optional()
			}
		},
		async ({ pattern, subpath }) => {
			const b = getCodeBackend();
			const hits = await b.ripgrep(pattern, { subpath, max: 30 });
			return { content: [{ type: 'text' as const, text: JSON.stringify(hits, null, 2) }] };
		}
	);

	server.registerTool(
		'prd_read',
		{
			description: 'Read the current Root Document (PRD.md).',
			inputSchema: z.object({})
		},
		async () => {
			const t = await readPrdForHub();
			return { content: [{ type: 'text' as const, text: t }] };
		}
	);

	server.registerTool(
		'prd_patch',
		{
			description: 'Update a section in PRD.md by heading title.',
			inputSchema: {
				section: z.string().describe('Section heading text'),
				newBody: z.string().describe('New markdown body for that section'),
				session: z.string().optional().describe('Session id for revision log')
			}
		},
		async ({ section, newBody, session }) => {
			const db = getOrCreateDatabase();
			const sid = getOrCreateSessionId(db, session);
			const r = await applyPrdPatch(db, sid, section, newBody);
			if (r && 'ok' in r && r.ok) {
				return { content: [{ type: 'text' as const, text: r.content }] };
			}
			return {
				content: [
					{
						type: 'text' as const,
						text: (r as { error?: string })?.error ?? 'PRD patch failed'
					}
				]
			};
		}
	);

	server.registerTool(
		'list_tickets',
		{
			description: 'List recent ticket drafts (pending/approved states).',
			inputSchema: z.object({})
		},
		async () => {
			const db = getOrCreateDatabase();
			const rows = db
				.prepare('SELECT id, title, state, created_at FROM ticket_drafts ORDER BY created_at DESC LIMIT 50')
				.all() as { id: string; title: string; state: string; created_at: string }[];
			return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] };
		}
	);

	return server;
}

export async function handleMcpRequest(request: Request) {
	const transport = new WebStandardStreamableHTTPServerTransport();
	const mcp = createMcpServer();
	await mcp.connect(transport);
	return transport.handleRequest(request);
}
