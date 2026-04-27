import { LinearClient, LinearDocument } from '@linear/sdk';
import { getEnv } from './config';
import { getBridgeLinearOverrides } from './code-bridge/bridge-registry';
import {
	linearIssuesCacheKey,
	linearMetaCacheKey,
	withLinearResponseCache
} from './linear-request-cache';

export type LinearUserLite = { id: string; name: string; email: string };

export function resolveLinearAuth(workspaceId = getEnv().codeBridgeWorkspaceId) {
	const env = getEnv();
	const o = getBridgeLinearOverrides(workspaceId);
	const apiKey = (o.linearApiKey ?? env.linearApiKey)?.trim() || null;
	const teamId = (o.linearTeamId ?? env.linearTeamId)?.trim() || null;
	return { apiKey, teamId };
}

/** True when an API key is available from hub env or the connected bridge for this workspace. */
export function isLinearApiConfigured(workspaceId = getEnv().codeBridgeWorkspaceId): boolean {
	return !!resolveLinearAuth(workspaceId).apiKey;
}

export function getLinearClient(workspaceId = getEnv().codeBridgeWorkspaceId) {
	const { apiKey } = resolveLinearAuth(workspaceId);
	if (!apiKey) {
		throw new Error('LINEAR_API_KEY is required for Linear integration');
	}
	return new LinearClient({ apiKey });
}

export async function findUserIdByNameHint(hint: string | null | undefined): Promise<string | null> {
	if (!hint?.trim()) return null;
	const client = getLinearClient();
	const conn = await client.users();
	const h = hint.toLowerCase();
	for (const u of conn.nodes) {
		if (u.name.toLowerCase().includes(h) || u.email.toLowerCase().includes(h)) {
			return u.id;
		}
	}
	return null;
}

export async function listLinearUsers(search?: string): Promise<LinearUserLite[]> {
	const ws = getEnv().codeBridgeWorkspaceId;
	const q = search?.trim().toLowerCase() ?? '';
	const key = linearMetaCacheKey('users', ws, q);
	return withLinearResponseCache(key, 'meta', async () => {
		const client = getLinearClient(ws);
		const conn = await client.users();
		const users: LinearUserLite[] = [];
		for (const u of conn.nodes) {
			if (q && !u.name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) {
				continue;
			}
			users.push({ id: u.id, name: u.name, email: u.email });
		}
		return users;
	});
}

export async function createIssueFromDraft(input: {
	title: string;
	description: string;
	assigneeUserId: string | null;
}): Promise<{ id: string; identifier?: string; url?: string }> {
	const ws = getEnv().codeBridgeWorkspaceId;
	const { teamId } = resolveLinearAuth(ws);
	if (!teamId) {
		throw new Error('LINEAR_TEAM_ID is required');
	}
	const client = getLinearClient(ws);
	const payload = await client.createIssue({
		teamId,
		title: input.title,
		description: input.description,
		assigneeId: input.assigneeUserId ?? undefined
	});
	const issueFetch = payload.issue;
	const issue = issueFetch ? await issueFetch : null;
	if (!issue) {
		throw new Error('Linear did not return an issue');
	}
	return { id: issue.id, identifier: issue.identifier, url: issue.url };
}

export type LinearIssueTask = {
	id: string;
	identifier: string;
	title: string;
	description: string;
	url: string;
};

/**
 * Fetches an issue and ensures it belongs to the hub’s configured Linear team.
 */
export async function getLinearIssueInConfiguredTeam(
	issueId: string,
	workspaceId = getEnv().codeBridgeWorkspaceId
): Promise<LinearIssueTask> {
	const { teamId } = resolveLinearAuth(workspaceId);
	if (!teamId) {
		throw new Error('LINEAR_TEAM_ID is required');
	}
	const client = getLinearClient(workspaceId);
	const issue = await client.issue(issueId);
	const teamNode = await issue.team;
	const team = teamNode ? await teamNode : null;
	if (!team || team.id !== teamId) {
		throw new Error(
			'That issue is not in the team configured for this hub (LINEAR_TEAM_ID or bridge --linear-team-id).'
		);
	}
	return {
		id: issue.id,
		identifier: issue.identifier,
		title: issue.title,
		description: issue.description?.trim() ? issue.description : '(no description)',
		url: issue.url
	};
}

export type LinearIssueListItem = {
	id: string;
	identifier: string;
	title: string;
	url: string;
	priority: number;
	priorityLabel: string;
	assigneeId: string | null;
	assigneeName: string | null;
	stateId: string | null;
	stateName: string | null;
	stateType: string | null;
};

export type ListTeamIssuesParams = {
	workspaceId?: string;
	first?: number;
	after?: string | null;
	/** Linear workflow state id */
	stateId?: string | null;
	/** User id, or the literal `__unassigned__` */
	assigneeId?: string | null;
	/** 0 = none, 1–4 = urgency bands (Linear) */
	priority?: number | null;
	titleContains?: string | null;
};

function buildTeamIssuesFilter(
	teamId: string,
	p: Pick<
		ListTeamIssuesParams,
		'stateId' | 'assigneeId' | 'priority' | 'titleContains'
	>
): LinearDocument.IssueFilter {
	const filter: LinearDocument.IssueFilter = {
		team: { id: { eq: teamId } }
	};
	const sid = p.stateId?.trim();
	if (sid) {
		filter.state = { id: { eq: sid } };
	}
	if (p.assigneeId === '__unassigned__') {
		filter.assignee = { null: true };
	} else if (p.assigneeId?.trim()) {
		filter.assignee = { id: { eq: p.assigneeId.trim() } };
	}
	if (p.priority != null && p.priority >= 0 && p.priority <= 4) {
		filter.priority = { eq: p.priority };
	}
	const q = p.titleContains?.trim();
	if (q) {
		filter.title = { containsIgnoreCase: q };
	}
	return filter;
}

export async function listTeamWorkflowStates(
	workspaceId = getEnv().codeBridgeWorkspaceId
): Promise<{ id: string; name: string; type: string; position: number }[]> {
	const key = linearMetaCacheKey('states', workspaceId, '');
	return withLinearResponseCache(key, 'meta', async () => {
		const { teamId } = resolveLinearAuth(workspaceId);
		if (!teamId) {
			throw new Error('LINEAR_TEAM_ID is required');
		}
		const client = getLinearClient(workspaceId);
		const conn = await client.workflowStates({
			filter: { team: { id: { eq: teamId } } },
			first: 100
		});
		const rows = conn.nodes.map((s) => ({
			id: s.id,
			name: s.name,
			type: s.type,
			position: s.position
		}));
		rows.sort((a, b) => a.position - b.position);
		return rows;
	});
}

export async function listTeamIssuesPage(
	input: ListTeamIssuesParams
): Promise<{ issues: LinearIssueListItem[]; endCursor: string | null; hasNextPage: boolean }> {
	const ws = input.workspaceId ?? getEnv().codeBridgeWorkspaceId;
	const firstNorm = Math.min(Math.max(input.first ?? 50, 1), 100);
	const key = linearIssuesCacheKey(ws, {
		firstNorm,
		after: input.after,
		stateId: input.stateId,
		assigneeId: input.assigneeId,
		priority: input.priority,
		titleContains: input.titleContains
	});
	return withLinearResponseCache(key, 'issues', () => listTeamIssuesPageUncached(input, ws, firstNorm));
}

async function listTeamIssuesPageUncached(
	input: ListTeamIssuesParams,
	ws: string,
	first: number
): Promise<{ issues: LinearIssueListItem[]; endCursor: string | null; hasNextPage: boolean }> {
	const { teamId } = resolveLinearAuth(ws);
	if (!teamId) {
		throw new Error('LINEAR_TEAM_ID is required');
	}
	const client = getLinearClient(ws);
	const filter = buildTeamIssuesFilter(teamId, {
		stateId: input.stateId,
		assigneeId: input.assigneeId,
		priority: input.priority,
		titleContains: input.titleContains
	});
	const conn = await client.issues({
		filter,
		first,
		after: input.after?.trim() ? input.after : undefined,
		includeArchived: false,
		orderBy: LinearDocument.PaginationOrderBy.UpdatedAt
	});
	const nodes = conn.nodes;
	const issues: LinearIssueListItem[] = await Promise.all(
		nodes.map(async (n) => {
			let assigneeId: string | null = null;
			let assigneeName: string | null = null;
			const af = n.assignee;
			if (af) {
				const u = await af;
				if (u) {
					assigneeId = u.id;
					assigneeName = u.name;
				}
			}
			let stateId: string | null = null;
			let stateName: string | null = null;
			let stateType: string | null = null;
			const sf = n.state;
			if (sf) {
				const s = await sf;
				if (s) {
					stateId = s.id;
					stateName = s.name;
					stateType = s.type;
				}
			}
			return {
				id: n.id,
				identifier: n.identifier,
				title: n.title,
				url: n.url,
				priority: n.priority,
				priorityLabel: n.priorityLabel,
				assigneeId,
				assigneeName,
				stateId,
				stateName,
				stateType
			};
		})
	);
	return {
		issues,
		endCursor: conn.pageInfo?.endCursor ?? null,
		hasNextPage: conn.pageInfo?.hasNextPage ?? false
	};
}
