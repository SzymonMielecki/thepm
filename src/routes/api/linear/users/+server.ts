import { json, error, type RequestEvent } from '@sveltejs/kit';
import { assertHubToken } from '$lib/server/auth';
import { listLinearUsers } from '$lib/server/linear';

export const GET = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	try {
		const q = event.url.searchParams.get('q') ?? undefined;
		const users = await listLinearUsers(q);
		return json({ users });
	} catch (e) {
		return error(503, (e as Error).message);
	}
};
