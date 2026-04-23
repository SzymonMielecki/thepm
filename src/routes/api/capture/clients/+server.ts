import { json, error, type RequestEvent } from '@sveltejs/kit';
import { assertHubToken } from '$lib/server/auth';
import { listCaptureClients } from '$lib/server/ws/capture-registry';

export const GET = (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	return json({ devices: listCaptureClients() });
};
