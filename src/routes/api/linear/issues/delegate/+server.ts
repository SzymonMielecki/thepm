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
		const msg = (e as Error).message ?? String(e);
		const isMux = e instanceof MuxNotAvailableError;
		const isLinearTeam =
			msg.includes('not in the team configured') || msg.includes('LINEAR_TEAM_ID');
		// #region agent log
		void fetch('http://127.0.0.1:7428/ingest/65f24272-8316-4d58-a12d-8cd0e27b957f', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '3983a4' },
			body: JSON.stringify({
				sessionId: '3983a4',
				location: 'api/linear/issues/delegate/+server.ts:catch',
				message: 'delegate_linear_issue_error',
				data: {
					hypothesisId: isMux ? 'H1' : isLinearTeam ? 'H2' : 'H3_or_H4_or_other',
					isMux,
					statusHint: isMux ? 412 : msg.includes('not in the team configured') ? 403 : '5xx',
					msgPrefix: msg.slice(0, 160)
				},
				timestamp: Date.now(),
				runId: 'delegation-debug'
			})
		}).catch(() => {});
		// #endregion
		if (e instanceof MuxNotAvailableError) {
			return error(412, e.message);
		}
		if (msg.includes('not in the team configured')) return error(403, msg);
		if (msg.includes('LINEAR_TEAM_ID')) return error(503, msg);
		return error(500, msg);
	}
};
