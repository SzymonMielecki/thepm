import type { IncomingMessage } from 'node:http';
import { Buffer } from 'node:buffer';

/**
 * Token for browser WebSocket clients: query, `Authorization: Bearer`, or
 * `Sec-WebSocket-Protocol: xhub-<base64url(utf8 token)>` (Funnel may strip `?token=`).
 */
export function hubTokenFromBrowserUpgrade(req: IncomingMessage): string {
	const u = new URL(req.url ?? '', 'http://x');
	const fromQuery = u.searchParams.get('token')?.trim() ?? '';
	if (fromQuery) return fromQuery;
	const auth = req.headers['authorization'];
	if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
		return auth.slice(7).trim();
	}
	const swp = req.headers['sec-websocket-protocol'];
	if (typeof swp !== 'string') return '';
	for (const part of swp.split(',')) {
		const s = part.trim();
		if (s.startsWith('xhub-')) {
			const payload = s.slice('xhub-'.length);
			try {
				return Buffer.from(payload, 'base64url').toString('utf8');
			} catch {
				return '';
			}
		}
	}
	return '';
}
