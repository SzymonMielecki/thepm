import { json, type RequestEvent } from '@sveltejs/kit';
import { assertHubToken } from '$lib/server/auth';
import { error } from '@sveltejs/kit';
import { readPrdForHub, applyPrdPatch, writeFullPrd } from '$lib/server/prd/store';
import { getOrCreateSessionId } from '$lib/server/session';
import { getOrCreateDatabase } from '$lib/server/db';
import { getEnv, getProjectPaths } from '$lib/server/config';
import { getBridgeClientPaths } from '$lib/server/code-bridge/bridge-registry';

export const GET = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	try {
		const content = await readPrdForHub();
		const env = getEnv();
		const bridge = getBridgeClientPaths(env.codeBridgeWorkspaceId);
		const prdFilePath = bridge ? bridge.prdPath : getProjectPaths().prdPath;
		return json({ content, source: 'bridge', prdFilePath });
	} catch (e) {
		const msg = (e as Error).message;
		return new Response(
			JSON.stringify({
				error: 'prd_unavailable',
				detail: msg
			}),
			{
				status: 503,
				headers: { 'content-type': 'application/json' }
			}
		);
	}
};

export const POST = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	const b = (await event.request.json()) as {
		section?: string;
		body?: string;
		sessionId?: string;
		fullContent?: string;
	};
	const db = getOrCreateDatabase();
	if (typeof b.fullContent === 'string') {
		const sid = getOrCreateSessionId(db, b.sessionId);
		const r = await writeFullPrd(db, sid, b.fullContent);
		return json({ content: r.content });
	}
	if (!b.section || b.body == null) return error(400, 'section and body');
	const sid = getOrCreateSessionId(db, b.sessionId);
	const r = await applyPrdPatch(db, sid, b.section, b.body);
	if (!r || !('ok' in r) || !r.ok) {
		return error(400, 'patch failed');
	}
	return json({ content: r.content });
};
