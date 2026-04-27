import { json, error, type RequestEvent } from '@sveltejs/kit';
import { assertHubToken } from '$lib/server/auth';
import { isLinearApiConfigured, listTeamIssuesPage } from '$lib/server/linear';
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
	const firstRaw = event.url.searchParams.get('first');
	const parsed = firstRaw != null && firstRaw !== '' ? Number.parseInt(firstRaw, 10) : Number.NaN;
	const first = Number.isFinite(parsed) ? parsed : undefined;
	const after = event.url.searchParams.get('after')?.trim() || null;
	const stateId = event.url.searchParams.get('stateId')?.trim() || null;
	const assigneeId = event.url.searchParams.get('assigneeId')?.trim() || null;
	const priorityRaw = event.url.searchParams.get('priority');
	const pNum =
		priorityRaw != null && priorityRaw !== '' ? Number.parseInt(priorityRaw, 10) : Number.NaN;
	const priority = Number.isFinite(pNum) ? pNum : null;
	const titleContains = event.url.searchParams.get('q')?.trim() || null;
	try {
		const out = await listTeamIssuesPage({
			workspaceId: getEnv().codeBridgeWorkspaceId,
			first,
			after,
			stateId: stateId || null,
			assigneeId: assigneeId || null,
			priority,
			titleContains: titleContains || null
		});
		return json(out);
	} catch (e) {
		return error(503, (e as Error).message);
	}
};
