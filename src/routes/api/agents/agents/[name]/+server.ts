import { json, error, type RequestEvent } from '@sveltejs/kit';
import { assertHubToken } from '$lib/server/auth';
import { getOrCreateDatabase } from '$lib/server/db';
import { listMergedAgents } from '$lib/server/agents/discovery';
import { getEnv } from '$lib/server/config';
import {
	deleteCatalogAgent,
	getCatalogAgent,
	upsertCatalogAgent
} from '$lib/server/agents/agent-catalog-db';
import { z } from 'zod';

const patchSchema = z.object({
	description: z.string().optional(),
	tools: z.string().optional(),
	model: z.string().optional(),
	body: z.string().min(1)
});

export const GET = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	const name = decodeURIComponent(event.params.name ?? '').trim();
	if (!name) return error(400, 'name');
	const db = getOrCreateDatabase();
	const ws = getEnv().codeBridgeWorkspaceId;
	const agents = await listMergedAgents(db, ws);
	const agent = agents.find((a) => a.name === name);
	if (!agent) return error(404, 'agent not found');
	const stored = await getCatalogAgent(db, name);
	return json({
		agent: {
			name: agent.name,
			description: agent.description,
			tools: agent.tools,
			model: agent.model,
			body: agent.body,
			source: agent.source,
			hasStoredOverride: !!stored
		}
	});
};

export const PATCH = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	const name = decodeURIComponent(event.params.name ?? '').trim();
	if (!name) return error(400, 'name');
	const raw = await event.request.json().catch(() => null);
	const parsed = patchSchema.safeParse(raw);
	if (!parsed.success) return error(400, parsed.error.message);
	const db = getOrCreateDatabase();
	try {
		const existing = await getCatalogAgent(db, name);
		const ws = getEnv().codeBridgeWorkspaceId;
		const merged = await listMergedAgents(db, ws);
		const base = merged.find((a) => a.name === name);
		if (!base) return error(404, 'agent not found');
		await upsertCatalogAgent(db, {
			name,
			description: parsed.data.description ?? existing?.description ?? base.description,
			tools: parsed.data.tools ?? existing?.tools ?? base.tools,
			model: parsed.data.model ?? existing?.model ?? base.model,
			body: parsed.data.body
		});
		return json({ ok: true });
	} catch (e) {
		return error(500, (e as Error).message);
	}
};

export const DELETE = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	const name = decodeURIComponent(event.params.name ?? '').trim();
	if (!name) return error(400, 'name');
	const db = getOrCreateDatabase();
	const row = await getCatalogAgent(db, name);
	if (!row) return error(404, 'no stored override or custom agent');
	try {
		await deleteCatalogAgent(db, name);
		return json({ ok: true });
	} catch (e) {
		return error(500, (e as Error).message);
	}
};
