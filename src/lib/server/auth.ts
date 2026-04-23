import { Buffer } from 'node:buffer';
import { getEnv } from './config';
import { error, type RequestEvent } from '@sveltejs/kit';

function tokenFromEvent(event: RequestEvent) {
	const header = event.request.headers.get('authorization');
	if (header?.startsWith('Bearer ')) return header.slice(7).trim();
	const q = event.url.searchParams.get('token')?.trim();
	if (q) return q;
	const xh = event.request.headers.get('x-hub-token')?.trim();
	if (xh) return xh;
	// `EventSource` cannot set Authorization; `?token=` may be stripped (e.g. some proxies). See `/api/events/hub/[enc]`.
	const path = event.url.pathname;
	if (path.startsWith('/api/events/hub/')) {
		const seg = path.replace(/\/$/, '').slice('/api/events/hub/'.length);
		if (seg) {
			try {
				return Buffer.from(seg, 'base64url').toString('utf8');
			} catch {
				return '';
			}
		}
	}
	return '';
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
