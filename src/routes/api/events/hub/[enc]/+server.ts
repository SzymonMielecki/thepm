import { createHubSseResponse } from '$lib/server/hub-sse';
import { assertHubToken } from '$lib/server/auth';
import { error, type RequestEvent } from '@sveltejs/kit';

/** Same as `/api/events` but with token in the path (EventSource has no `Authorization`; some proxies strip `?token=`). */
export const GET = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	return createHubSseResponse(event);
};
