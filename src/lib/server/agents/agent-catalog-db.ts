import type { AppDatabase } from '../db';

export type CatalogAgentRow = {
	name: string;
	description: string;
	tools: string;
	model: string;
	body: string;
	updated_at: string;
};

export async function listCatalogAgents(db: AppDatabase): Promise<CatalogAgentRow[]> {
	const { data, error } = await db.from('delegation_catalog_agents').select('*').order('name', {
		ascending: true
	});
	if (error) throw new Error(error.message);
	return (data ?? []) as CatalogAgentRow[];
}

export async function getCatalogAgent(
	db: AppDatabase,
	name: string
): Promise<CatalogAgentRow | null> {
	const { data, error } = await db
		.from('delegation_catalog_agents')
		.select('*')
		.eq('name', name)
		.maybeSingle();
	if (error) throw new Error(error.message);
	return (data as CatalogAgentRow) ?? null;
}

export async function upsertCatalogAgent(
	db: AppDatabase,
	input: {
		name: string;
		description?: string;
		tools?: string;
		model?: string;
		body: string;
	}
): Promise<void> {
	const now = new Date().toISOString();
	const name = input.name.trim();
	if (!name) throw new Error('name required');
	const row = await getCatalogAgent(db, name);
	if (row) {
		const { error } = await db
			.from('delegation_catalog_agents')
			.update({
				description: input.description ?? row.description,
				tools: input.tools ?? row.tools,
				model: input.model ?? row.model,
				body: input.body,
				updated_at: now
			})
			.eq('name', name);
		if (error) throw new Error(error.message);
		return;
	}
	const { error } = await db.from('delegation_catalog_agents').insert({
		name,
		description: input.description ?? '',
		tools: input.tools ?? '',
		model: input.model ?? '',
		body: input.body,
		updated_at: now
	});
	if (error) throw new Error(error.message);
}

export async function deleteCatalogAgent(db: AppDatabase, name: string): Promise<void> {
	const { error } = await db.from('delegation_catalog_agents').delete().eq('name', name.trim());
	if (error) throw new Error(error.message);
}
