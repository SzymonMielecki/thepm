import { Buffer } from 'node:buffer';
import { error, type RequestEvent } from '@sveltejs/kit';
import {
	isBridgeUiSessionTokenValid,
	getBridgeCount,
	isBridgeAccessTokenValid
} from './code-bridge/bridge-registry';

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

function bridgeSessionFromEvent(event: RequestEvent): string {
	const cookie = event.cookies.get('thepm_bridge_session')?.trim();
	if (cookie) return cookie;
	const header = event.request.headers.get('x-bridge-session')?.trim();
	if (header) return header;
	const q = event.url.searchParams.get('bridge_session')?.trim();
	if (q) return q;
	return '';
}

export function assertHubToken(event: RequestEvent) {
	const bridgeSession = bridgeSessionFromEvent(event);
	const t = tokenFromEvent(event);
	const sessionValid = bridgeSession ? isBridgeUiSessionTokenValid(bridgeSession) : false;
	const tokenValid = t ? isBridgeAccessTokenValid(t) : false;
	if (sessionValid) {
		return;
	}
	if (tokenValid) {
		return;
	}
	if (getBridgeCount() > 0) throw error(401, 'Invalid or missing bridge token');
	return;
}

export function isHubTokenValid(token: string | null | undefined): boolean {
	return isBridgeAccessTokenValid(token);
}
