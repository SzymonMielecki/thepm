import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db';

export type AdhocTeamRow = {
	id: string;
	name: string;
	description: string | null;
	dispatch_mode: string;
	members_json: string;
	prompt_template: string | null;
	created_at: string;
	updated_at: string;
};

export async function listAdhocTeams(db: AppDatabase): Promise<AdhocTeamRow[]> {
	const { data, error } = await db.from('agent_teams_adhoc').select('*').order('created_at', {
		ascending: false
	});
	if (error) throw new Error(error.message);
	return (data ?? []) as AdhocTeamRow[];
}

export async function getAdhocTeamByName(
	db: AppDatabase,
	name: string
): Promise<AdhocTeamRow | null> {
	const { data, error } = await db.from('agent_teams_adhoc').select('*').eq('name', name).maybeSingle();
	if (error) throw new Error(error.message);
	return (data as AdhocTeamRow) ?? null;
}

export async function insertAdhocTeam(
	db: AppDatabase,
	input: {
		name: string;
		description?: string | null;
		dispatch_mode: 'parallel' | 'sequential';
		members: string[];
		prompt_template?: string | null;
	}
): Promise<string> {
	const existing = await getAdhocTeamByName(db, input.name.trim());
	if (existing) {
		await updateAdhocTeam(db, input.name.trim(), {
			description: input.description,
			dispatch_mode: input.dispatch_mode,
			members: input.members,
			prompt_template: input.prompt_template
		});
		return existing.id;
	}
	const id = randomUUID();
	const now = new Date().toISOString();
	const { error } = await db.from('agent_teams_adhoc').insert({
		id,
		name: input.name.trim(),
		description: input.description?.trim() ?? null,
		dispatch_mode: input.dispatch_mode,
		members_json: JSON.stringify(input.members),
		prompt_template: input.prompt_template?.trim() ?? null,
		created_at: now,
		updated_at: now
	});
	if (error) throw new Error(error.message);
	return id;
}

export async function updateAdhocTeam(
	db: AppDatabase,
	name: string,
	patch: Partial<{
		description: string | null;
		dispatch_mode: 'parallel' | 'sequential';
		members: string[];
		prompt_template: string | null;
	}>
): Promise<void> {
	const row = await getAdhocTeamByName(db, name);
	if (!row) throw new Error('team not found');
	const now = new Date().toISOString();
	const update: Record<string, unknown> = { updated_at: now };
	if (patch.description !== undefined) update.description = patch.description;
	if (patch.dispatch_mode !== undefined) update.dispatch_mode = patch.dispatch_mode;
	if (patch.members !== undefined) update.members_json = JSON.stringify(patch.members);
	if (patch.prompt_template !== undefined) update.prompt_template = patch.prompt_template;
	const { error } = await db.from('agent_teams_adhoc').update(update).eq('id', row.id);
	if (error) throw new Error(error.message);
}

export async function deleteAdhocTeam(db: AppDatabase, name: string): Promise<void> {
	const row = await getAdhocTeamByName(db, name);
	if (!row) throw new Error('team not found');
	const { error } = await db.from('agent_teams_adhoc').delete().eq('id', row.id);
	if (error) throw new Error(error.message);
}
