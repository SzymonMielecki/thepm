import { json, error, type RequestEvent } from '@sveltejs/kit';
import { assertHubToken } from '$lib/server/auth';
import { getEnv } from '$lib/server/config';
import { callBridge } from '$lib/server/code-bridge/bridge-registry';

export const POST = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	const runId = event.params.runId;
	if (!runId) return error(400, 'runId');
	try {
		const r = (await callBridge(getEnv().codeBridgeWorkspaceId, 'mux_focus', { runId })) as {
			ok: boolean;
		};
		return json({ ok: r.ok });
	} catch (e) {
		return error(500, (e as Error).message);
	}
};
