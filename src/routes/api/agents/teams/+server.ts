import { json, error, type RequestEvent } from '@sveltejs/kit';
import { assertHubToken } from '$lib/server/auth';
import { getOrCreateDatabase } from '$lib/server/db';
import { getEnv } from '$lib/server/config';
import { listMergedTeams } from '$lib/server/agents/discovery';
import { insertAdhocTeam } from '$lib/server/agents/teams-adhoc';
import { z } from 'zod';

const postSchema = z.object({
	name: z.string().min(1),
	description: z.string().optional(),
	dispatch_mode: z.enum(['parallel', 'sequential']).default('parallel'),
	members: z.array(z.string()).min(1),
	prompt_template: z.string().optional()
});

export const GET = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	const db = getOrCreateDatabase();
	const ws = getEnv().codeBridgeWorkspaceId;
	const teams = await listMergedTeams(db, ws);
	return json({ teams });
};

export const POST = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	const raw = await event.request.json().catch(() => null);
	const parsed = postSchema.safeParse(raw);
	if (!parsed.success) return error(400, parsed.error.message);
	const db = getOrCreateDatabase();
	try {
		const id = await insertAdhocTeam(db, {
			name: parsed.data.name.trim(),
			description: parsed.data.description?.trim() ?? null,
			dispatch_mode: parsed.data.dispatch_mode,
			members: parsed.data.members.map((m) => m.trim()).filter(Boolean),
			prompt_template: parsed.data.prompt_template?.trim() ?? null
		});
		return json({ ok: true, id });
	} catch (e) {
		return error(409, (e as Error).message);
	}
};
