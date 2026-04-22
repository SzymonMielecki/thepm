import { handleMcpRequest } from '$lib/server/mcp/server';
import { assertHubToken } from '$lib/server/auth';
import { error, type RequestEvent } from '@sveltejs/kit';

export const GET = (event: RequestEvent) => mcpHandler(event);
export const POST = (event: RequestEvent) => mcpHandler(event);
export const DELETE = (event: RequestEvent) => mcpHandler(event);
export const OPTIONS = (event: RequestEvent) => mcpHandler(event);

async function mcpHandler(event: RequestEvent) {
	if (event.request.method === 'OPTIONS') {
		return new Response(null, { status: 204, headers: new Headers(corsHeaders()) });
	}
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	const withCors = await handleMcpRequest(event.request);
	const headers = new Headers(withCors.headers);
	for (const [k, v] of Object.entries(corsHeaders())) {
		headers.set(k, v);
	}
	return new Response(withCors.body, { status: withCors.status, headers });
}

function corsHeaders() {
	return {
		'access-control-allow-origin': '*',
		'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
		'access-control-allow-headers': 'Content-Type, Authorization, mcp-session-id, mcp-protocol-version, Last-Event-ID',
		'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version'
	};
}
