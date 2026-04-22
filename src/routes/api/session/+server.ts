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
	const id = j?.id ? getOrCreateSessionId(db, j.id) : getOrCreateSessionId(db, null);
	if (j?.name) {
		db.prepare('UPDATE sessions SET name = ?, updated_at = datetime("now") WHERE id = ?').run(
			j.name,
			id
		);
	}
	return json({ id });
};
