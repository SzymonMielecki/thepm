import type { AppDatabase } from '../db';
import {
	DEFAULT_DELEGATION_TEAM_NAME,
	DEFAULT_TEAM_MEMBER_NAMES,
	defaultAgentMarkdown,
	defaultTeamPromptTemplate
} from './delegation-defaults';
import {
	extractMultilineBlock,
	parseAgentsList,
	parseFrontmatterLines,
	splitFrontmatter
} from './parse-md';
import { listCatalogAgents, type CatalogAgentRow } from './agent-catalog-db';
import { getAdhocTeamByName, listAdhocTeams, type AdhocTeamRow } from './teams-adhoc';

export type AgentSource = 'builtin' | 'db';
export type TeamSource = 'builtin' | 'db';

export type MergedAgent = {
	source: AgentSource;
	name: string;
	description: string;
	tools: string;
	model: string;
	body: string;
	path: string;
	shadowed: boolean;
};

export type MergedTeam = {
	source: TeamSource;
	name: string;
	description: string;
	dispatch: 'parallel' | 'sequential';
	agents: string[];
	promptTemplate: string;
	body: string;
	path: string;
	shadowed: boolean;
};

const BUILTIN_AGENT_NAMES = new Set<string>(DEFAULT_TEAM_MEMBER_NAMES);

function parseAgentFile(path: string, content: string, source: AgentSource): MergedAgent {
	const { front, body } = splitFrontmatter(content);
	const kv = parseFrontmatterLines(front);
	const name = (kv.name || path.split('/').pop()?.replace(/\.md$/i, '') || 'agent').trim();
	return {
		source,
		name,
		description: kv.description ?? '',
		tools: kv.tools ?? '',
		model: kv.model ?? '',
		body,
		path,
		shadowed: false
	};
}

function parseTeamFile(path: string, content: string, source: TeamSource): MergedTeam {
	const { front, body } = splitFrontmatter(content);
	const kv = parseFrontmatterLines(front);
	const name = (kv.name || path.split('/').pop()?.replace(/\.md$/i, '') || 'team').trim();
	const dispatch = kv.dispatch === 'sequential' ? 'sequential' : 'parallel';
	const agents = parseAgentsList(kv.agents);
	const promptTemplate =
		extractMultilineBlock(front, 'prompt_template') ||
		(kv.prompt_template ?? '').trim() ||
		body.trim();
	return {
		source,
		name,
		description: kv.description ?? '',
		dispatch,
		agents,
		promptTemplate,
		body,
		path,
		shadowed: false
	};
}

function hardcodedAgents(): MergedAgent[] {
	return DEFAULT_TEAM_MEMBER_NAMES.map((name) => {
		const raw = defaultAgentMarkdown(name);
		return parseAgentFile(`builtin:${name}.md`, raw, 'builtin');
	});
}

function hardcodedTeam(): MergedTeam {
	const members = [...DEFAULT_TEAM_MEMBER_NAMES];
	const teamFront = [
		'---',
		`name: ${DEFAULT_DELEGATION_TEAM_NAME}`,
		'description: Agent team: researcher, coder, reviewer (lead + teammates)',
		'dispatch: sequential',
		`agents: [${members.join(', ')}]`,
		'prompt_template: |',
		...defaultTeamPromptTemplate.split('\n').map((line) => (line.length ? `  ${line}` : '')),
		'---',
		''
	].join('\n');
	return parseTeamFile('builtin:default-team.md', teamFront, 'builtin');
}

function dbRowToMergedAgent(r: CatalogAgentRow): MergedAgent {
	return {
		source: 'db',
		name: r.name,
		description: r.description,
		tools: r.tools,
		model: r.model,
		body: r.body,
		path: `db:delegation_catalog_agents:${r.name}`,
		shadowed: false
	};
}

export function rowToMergedTeam(r: AdhocTeamRow): MergedTeam {
	let members: string[] = [];
	try {
		members = JSON.parse(r.members_json) as string[];
		if (!Array.isArray(members)) members = [];
	} catch {
		members = [];
	}
	return {
		source: 'db',
		name: r.name,
		description: r.description ?? '',
		dispatch: r.dispatch_mode === 'sequential' ? 'sequential' : 'parallel',
		agents: members.map(String),
		promptTemplate: r.prompt_template ?? '',
		body: '',
		path: `db:agent_teams_adhoc:${r.id}`,
		shadowed: false
	};
}

export async function listMergedAgents(db: AppDatabase, _workspaceId: string): Promise<MergedAgent[]> {
	const dbRows = await listCatalogAgents(db);
	const byName = new Map(dbRows.map((r) => [r.name, r]));
	const out: MergedAgent[] = [];
	for (const base of hardcodedAgents()) {
		const o = byName.get(base.name);
		out.push(
			o
				? {
						...base,
						description: o.description,
						tools: o.tools,
						model: o.model,
						body: o.body
					}
				: base
		);
	}
	for (const r of dbRows) {
		if (!BUILTIN_AGENT_NAMES.has(r.name)) {
			out.push(dbRowToMergedAgent(r));
		}
	}
	return out;
}

export async function listMergedTeams(
	db: AppDatabase,
	_workspaceId: string
): Promise<MergedTeam[]> {
	const teams: MergedTeam[] = [];
	const defaultOverride = await getAdhocTeamByName(db, DEFAULT_DELEGATION_TEAM_NAME);
	if (defaultOverride) {
		teams.push(rowToMergedTeam(defaultOverride));
	} else {
		teams.push(hardcodedTeam());
	}
	const adhoc = await listAdhocTeams(db);
	for (const row of adhoc) {
		if (row.name === DEFAULT_DELEGATION_TEAM_NAME) continue;
		teams.push(rowToMergedTeam(row));
	}
	return teams;
}

export function getAgentMarkdownForDispatch(agents: MergedAgent[], name: string): string {
	const hit = agents.find((a) => a.name === name);
	if (!hit) return '';
	return `---\nname: ${hit.name}\ndescription: ${hit.description}\ntools: ${hit.tools}\nmodel: ${hit.model}\n---\n${hit.body}`;
}

export function renderPromptTemplate(
	template: string,
	draft: { title: string; description: string },
	fileRefs: string
): string {
	return template
		.replace(/\{\{title\}\}/g, draft.title)
		.replace(/\{\{description\}\}/g, draft.description)
		.replace(/\{\{fileRefs\}\}/g, fileRefs);
}

export async function resolveDelegationTarget(
	db: AppDatabase,
	workspaceId: string,
	target: { kind: 'team'; name: string }
): Promise<{
	dispatch: 'parallel' | 'sequential';
	agentNames: string[];
	promptTemplate: string;
}> {
	const teams = await listMergedTeams(db, workspaceId);
	const team =
		teams.find((x) => x.name === target.name && !x.shadowed) ?? teams.find((x) => x.name === target.name);
	if (!team) throw new Error(`Unknown team: ${target.name}`);
	if (!team.agents.length) throw new Error(`Team "${target.name}" has no members`);
	return {
		dispatch: team.dispatch,
		agentNames: team.agents,
		promptTemplate: team.promptTemplate
	};
}

export function getAgentBodyByName(agents: MergedAgent[], name: string): string {
	const hit = agents.find((a) => a.name === name);
	return hit?.body ?? '';
}
