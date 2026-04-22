import { LinearClient } from '@linear/sdk';
import { getEnv } from './config';

export function getLinearClient() {
	const env = getEnv();
	if (!env.linearApiKey) {
		throw new Error('LINEAR_API_KEY is required for Linear integration');
	}
	return new LinearClient({ apiKey: env.linearApiKey });
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

export async function createIssueFromDraft(input: {
	title: string;
	description: string;
	assigneeUserId: string | null;
}): Promise<{ id: string; identifier?: string; url?: string }> {
	const env = getEnv();
	if (!env.linearTeamId) {
		throw new Error('LINEAR_TEAM_ID is required');
	}
	const client = getLinearClient();
	const r = await client.createIssue({
		teamId: env.linearTeamId,
		title: input.title,
		description: input.description,
		assigneeId: input.assigneeUserId ?? undefined
	});
	const issue = (await r).issue;
	if (!issue) {
		throw new Error('Linear did not return an issue');
	}
	return { id: issue.id, identifier: issue.identifier, url: issue.url };
}
