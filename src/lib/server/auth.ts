import { getEnv } from './config';
import { error, type RequestEvent } from '@sveltejs/kit';

function tokenFromEvent(event: RequestEvent) {
	const header = event.request.headers.get('authorization');
	if (header?.startsWith('Bearer ')) return header.slice(7).trim();
	return event.url.searchParams.get('token')?.trim() || event.request.headers.get('x-hub-token');
}

export function assertHubToken(event: RequestEvent) {
	const { hubToken } = getEnv();
	if (!hubToken) return;
	const t = tokenFromEvent(event);
	if (t !== hubToken) {
		throw error(401, 'Invalid or missing HUB_TOKEN');
	}
}

export function isHubTokenValid(token: string | null | undefined): boolean {
	const { hubToken } = getEnv();
	if (!hubToken) return true;
	return token === hubToken;
}
