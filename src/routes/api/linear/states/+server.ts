import { json, error, type RequestEvent } from '@sveltejs/kit';
import { assertHubToken } from '$lib/server/auth';
import { isLinearApiConfigured, listTeamWorkflowStates } from '$lib/server/linear';
import { getEnv } from '$lib/server/config';

export const GET = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	if (!isLinearApiConfigured()) {
		return error(503, 'LINEAR_API_KEY is not configured (hub env or bridge --linear-api-key)');
	}
	try {
		const states = await listTeamWorkflowStates(getEnv().codeBridgeWorkspaceId);
		return json({ states });
	} catch (e) {
		return error(503, (e as Error).message);
	}
};
