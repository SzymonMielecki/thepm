import { json, error, type RequestEvent } from '@sveltejs/kit';
import { assertHubToken } from '$lib/server/auth';
import { getOrCreateDatabase } from '$lib/server/db';
import { DEFAULT_TEAM_MEMBER_NAMES } from '$lib/delegation-constants';
import { upsertCatalogAgent } from '$lib/server/agents/agent-catalog-db';
import { z } from 'zod';

const builtinNames = new Set<string>(DEFAULT_TEAM_MEMBER_NAMES);

const postSchema = z.object({
	name: z.string().min(1),
	description: z.string().optional().default(''),
	tools: z.string().optional().default(''),
	model: z.string().optional().default(''),
	body: z.string().min(1)
});

export const POST = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	const raw = await event.request.json().catch(() => null);
	const parsed = postSchema.safeParse(raw);
	if (!parsed.success) return error(400, parsed.error.message);
	const name = parsed.data.name.trim();
	if (builtinNames.has(name)) {
		return error(409, 'Built-in roles are edited with PATCH /api/agents/agents/{name}, not POST.');
	}
	const db = getOrCreateDatabase();
	try {
		await upsertCatalogAgent(db, parsed.data);
		return json({ ok: true });
	} catch (e) {
		return error(500, (e as Error).message);
	}
};
