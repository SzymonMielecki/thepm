import { json, error, type RequestEvent } from '@sveltejs/kit';
import { assertHubToken } from '$lib/server/auth';
import { getOrCreateDatabase } from '$lib/server/db';
import { getEnv } from '$lib/server/config';
import { delegateLinearIssue, MuxNotAvailableError } from '$lib/server/agents/dispatch';
import { isLinearApiConfigured } from '$lib/server/linear';
import { z } from 'zod';

const bodySchema = z.object({
	issueId: z.string().min(1),
	target: z.object({
		kind: z.literal('team'),
		name: z.string().min(1)
	})
});

export const POST = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	if (!isLinearApiConfigured()) {
		return error(503, 'LINEAR_API_KEY is not configured (hub env or bridge --linear-api-key)');
	}
	const raw = await event.request.json().catch(() => null);
	const parsed = bodySchema.safeParse(raw);
	if (!parsed.success) return error(400, parsed.error.message);
	const db = getOrCreateDatabase();
	try {
		const out = await delegateLinearIssue({
			db,
			issueId: parsed.data.issueId.trim(),
			target: parsed.data.target,
			workspaceId: getEnv().codeBridgeWorkspaceId
		});
		return json({ ok: true, delegationId: out.delegationId, runIds: out.runIds });
	} catch (e) {
		if (e instanceof MuxNotAvailableError) {
			return error(412, e.message);
		}
		const msg = (e as Error).message;
		if (msg.includes('not in the team configured')) return error(403, msg);
		if (msg.includes('LINEAR_TEAM_ID')) return error(503, msg);
		return error(500, msg);
	}
};
