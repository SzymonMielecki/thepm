import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import { isHubTokenValid } from '../auth';
import { getOrCreateSessionId } from '../session';
import { getOrCreateDatabase } from '../db';
import { handleElevenFinalLine } from '../stt/elevenlabs';
import { openUpstreamStt, type SttEvent } from '../stt/elevenlabs-ws-upstream';
import { publish } from '../bus';

const PATH = '/api/audio/stream';

/**
 * One browser WebSocket: optional upstream to ElevenLabs, or JSON `{type:'final', text}` from client.
 */
export function handleBrowserSocket(ws: WebSocket, req: IncomingMessage) {
	const token = new URL(req.url ?? '', 'http://x').searchParams.get('token') ?? (req.headers['authorization']?.replace(/^Bearer\s+/i, '') || '');
	if (!isHubTokenValid(token)) {
		ws.close(4001, 'HUB_TOKEN required');
		return;
	}
	const db = getOrCreateDatabase();
	let urlSession = new URL(req.url ?? '', 'http://x').searchParams.get('session') ?? '';
	let session = urlSession
		? getOrCreateSessionId(db, urlSession)
		: getOrCreateSessionId(db, null);

	ws.send(JSON.stringify({ type: 'session', sessionId: session }));

	let upstream: ReturnType<typeof openUpstreamStt> | null = null;

	const ensureUpstream = () => {
		if (upstream) return;
		try {
			upstream = openUpstreamStt({
				onEvent: async (e: SttEvent) => {
					if (e.type === 'final') {
						const sid = e.sessionId && e.sessionId !== 'default' ? e.sessionId : session;
						await handleElevenFinalLine({
							sessionId: getOrCreateSessionId(db, sid),
							text: e.text,
							speakerId: e.speakerId
						});
					} else if (e.type === 'error') {
						publish({ type: 'agent_trace', phase: 'stt', detail: e.message, sessionId: session });
					} else {
						publish({ type: 'agent_trace', phase: 'stt_partial', detail: e.text, sessionId: session });
					}
				}
			});
		} catch (e) {
			ws.send(
				JSON.stringify({
					type: 'stt_unavailable',
					error: (e as Error).message
				})
			);
		}
	};

	ws.on('message', async (raw, isBinary) => {
		if (isBinary) {
			ensureUpstream();
			if (upstream) {
				const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
				try {
					upstream.send(buf);
				} catch (e) {
					ws.send(JSON.stringify({ type: 'error', error: String(e) }));
				}
			}
			return;
		}
		const s = raw.toString();
		try {
			const j = JSON.parse(s) as { type: string; text?: string; sessionId?: string };
			if (j.type === 'final' && j.text) {
				await handleElevenFinalLine({
					sessionId: getOrCreateSessionId(db, j.sessionId ?? session),
					text: j.text,
					speakerId: null
				});
			} else if (j.type === 'config' && j.sessionId) {
				const ns = getOrCreateSessionId(db, j.sessionId);
				session = ns;
			}
		} catch {
			// ignore
		}
	});
	ws.on('close', () => {
		try {
			upstream?.close();
		} catch {
			// ignore
		}
	});
}

let attached = false;

export function attachAudioWssToHttpServer(httpServer: Server) {
	if (attached) return;
	attached = true;
	const wss = new WebSocketServer({ noServer: true });
	wss.on('connection', (ws, req) => {
		void handleBrowserSocket(ws, req as IncomingMessage);
	});
	httpServer.on('upgrade', (req, socket, head) => {
		const p = new URL(req.url ?? '', 'http://x').pathname;
		if (p !== PATH) return;
		wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
	});
}

export const AUDIO_STREAM_PATH = PATH;
