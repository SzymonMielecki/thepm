import { LinearClient } from '@linear/sdk';
import { getEnv } from './config';
import { getBridgeLinearOverrides } from './code-bridge/bridge-registry';

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
	const client = getLinearClient();
	const conn = await client.users();
	const q = search?.trim().toLowerCase();
	const users: LinearUserLite[] = [];
	for (const u of conn.nodes) {
		if (q && !u.name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) {
			continue;
		}
		users.push({ id: u.id, name: u.name, email: u.email });
	}
	return users;
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
