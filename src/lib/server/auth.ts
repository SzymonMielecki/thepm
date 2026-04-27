import { Buffer } from 'node:buffer';
import { error, type RequestEvent } from '@sveltejs/kit';
import { getBridgeCount, isBridgeAccessTokenValid } from './code-bridge/bridge-registry';

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
	const t = tokenFromEvent(event);
	const tokenValid = t ? isBridgeAccessTokenValid(t) : false;
	if (tokenValid) {
		return;
	}
	if (getBridgeCount() > 0) throw error(401, 'Invalid or missing bridge token');
	return;
}

export function isHubTokenValid(token: string | null | undefined): boolean {
	return isBridgeAccessTokenValid(token);
}
