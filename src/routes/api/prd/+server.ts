import { json, type RequestEvent } from '@sveltejs/kit';
import { assertHubToken } from '$lib/server/auth';
import { error } from '@sveltejs/kit';
import { readPrd, applyPrdPatch, writeFullPrd } from '$lib/server/prd/store';
import { getOrCreateSessionId } from '$lib/server/session';
import { getOrCreateDatabase } from '$lib/server/db';

export const GET = (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	return json({ content: readPrd() });
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
		const r = writeFullPrd(db, sid, b.fullContent);
		return json({ content: r.content });
	}
	if (!b.section || b.body == null) return error(400, 'section and body');
	const sid = getOrCreateSessionId(db, b.sessionId);
	const r = applyPrdPatch(db, sid, b.section, b.body);
	if (!r || !('ok' in r) || !r.ok) {
		return error(400, 'patch failed');
	}
	return json({ content: r.content });
};
