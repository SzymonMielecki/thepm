import { json, error, type RequestEvent } from '@sveltejs/kit';
import { assertHubToken } from '$lib/server/auth';
import { getOrCreateDatabase } from '$lib/server/db';
import { getEnv } from '$lib/server/config';
import { DEFAULT_DELEGATION_TEAM_NAME, DEFAULT_TEAM_MEMBER_NAMES } from '$lib/delegation-constants';
import { listMergedTeams } from '$lib/server/agents/discovery';
import {
	deleteAdhocTeam,
	getAdhocTeamByName,
	insertAdhocTeam,
	updateAdhocTeam
} from '$lib/server/agents/teams-adhoc';
import { defaultTeamPromptTemplate } from '$lib/server/agents/delegation-defaults';
import { z } from 'zod';

const patchSchema = z.object({
	description: z.string().nullable().optional(),
	dispatch_mode: z.enum(['parallel', 'sequential']).optional(),
	members: z.array(z.string()).optional(),
	prompt_template: z.string().nullable().optional()
});

export const GET = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	const name = decodeURIComponent(event.params.name ?? '');
	if (!name) return error(400, 'name');
	const db = getOrCreateDatabase();
	const ws = getEnv().codeBridgeWorkspaceId;
	const teams = await listMergedTeams(db, ws);
	const team = teams.find((t) => t.name === name);
	if (!team) return error(404, 'team not found');
	return json({ team });
};

export const PATCH = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
	const name = decodeURIComponent(event.params.name ?? '');
	if (!name) return error(400, 'name');
	const raw = await event.request.json().catch(() => null);
	const parsed = patchSchema.safeParse(raw);
	if (!parsed.success) return error(400, parsed.error.message);
	const db = getOrCreateDatabase();
	const row = await getAdhocTeamByName(db, name);
	if (!row) {
		if (name !== DEFAULT_DELEGATION_TEAM_NAME) {
			return error(404, 'team not found');
		}
		const members =
			parsed.data.members?.map((m) => m.trim()).filter(Boolean) ??
			[...DEFAULT_TEAM_MEMBER_NAMES];
		try {
			await insertAdhocTeam(db, {
				name: DEFAULT_DELEGATION_TEAM_NAME,
				description: parsed.data.description ?? '',
				dispatch_mode: parsed.data.dispatch_mode ?? 'parallel',
				members,
				prompt_template:
					parsed.data.prompt_template !== undefined && parsed.data.prompt_template !== null
						? parsed.data.prompt_template
						: defaultTeamPromptTemplate
			});
			return json({ ok: true });
		} catch (e) {
			return error(500, (e as Error).message);
		}
	}
	try {
		await updateAdhocTeam(db, name, {
			description: parsed.data.description,
			dispatch_mode: parsed.data.dispatch_mode,
			members: parsed.data.members?.map((m) => m.trim()).filter(Boolean),
			prompt_template: parsed.data.prompt_template
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
	const name = decodeURIComponent(event.params.name ?? '');
	if (!name) return error(400, 'name');
	const db = getOrCreateDatabase();
	try {
		await deleteAdhocTeam(db, name);
		return json({ ok: true });
	} catch (e) {
		const msg = (e as Error).message;
		if (msg.includes('not found')) return error(404, msg);
		return error(409, msg);
	}
};
