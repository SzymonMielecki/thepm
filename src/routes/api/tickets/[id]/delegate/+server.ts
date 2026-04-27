import { json, error, type RequestEvent } from '@sveltejs/kit';
import { assertHubToken } from '$lib/server/auth';
import { getOrCreateDatabase } from '$lib/server/db';
import { getEnv } from '$lib/server/config';
import { delegateDraft, MuxNotAvailableError } from '$lib/server/agents/dispatch';
import { z } from 'zod';

const bodySchema = z.object({
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
	const id = event.params.id;
	if (!id) return error(400, 'id');
	const raw = await event.request.json().catch(() => null);
	const parsed = bodySchema.safeParse(raw);
	if (!parsed.success) return error(400, parsed.error.message);
	const db = getOrCreateDatabase();
	try {
		const out = await delegateDraft({
			db,
			draftId: id,
			target: parsed.data.target,
			workspaceId: getEnv().codeBridgeWorkspaceId
		});
		return json({ ok: true, delegationId: out.delegationId, runIds: out.runIds });
	} catch (e) {
		if (e instanceof MuxNotAvailableError) {
			return error(412, e.message);
		}
		const msg = (e as Error).message;
		if (msg.includes('draft not found')) return error(404, msg);
		return error(500, msg);
	}
};
