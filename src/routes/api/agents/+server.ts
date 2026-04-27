import { json, error, type RequestEvent } from '@sveltejs/kit';
import { assertHubToken } from '$lib/server/auth';
import { getOrCreateDatabase } from '$lib/server/db';
import { getEnv } from '$lib/server/config';
import { listMergedAgents, listMergedTeams } from '$lib/server/agents/discovery';
import { fetchMuxCapabilities } from '$lib/server/agents/dispatch';

export const GET = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	const db = getOrCreateDatabase();
	const ws = getEnv().codeBridgeWorkspaceId;
	const [agents, teams, mux] = await Promise.all([
		listMergedAgents(db, ws),
		listMergedTeams(db, ws),
		fetchMuxCapabilities(ws).catch(() => ({ flavor: 'none' as const, session: undefined }))
	]);
	return json({ agents, teams, mux });
};
