import { json, type RequestEvent } from '@sveltejs/kit';
import { getOrCreateDatabase } from '$lib/server/db';
import { getOrCreateSessionId } from '$lib/server/session';
import { assertHubToken } from '$lib/server/auth';
import { error } from '@sveltejs/kit';

export const POST = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	const db = getOrCreateDatabase();
	let j: { name?: string; id?: string } = {};
	try {
		j = (await event.request.json()) as typeof j;
	} catch {
		// empty body
	}
	const id = j?.id ? await getOrCreateSessionId(db, j.id) : await getOrCreateSessionId(db, null);
	if (j?.name) {
		const { error: upErr } = await db
			.from('sessions')
			.update({ name: j.name, updated_at: new Date().toISOString() })
			.eq('id', id);
		if (upErr) return error(500, upErr.message);
	}
	return json({ id });
};
