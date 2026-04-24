import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import { isHubTokenValid } from '../auth';
import { hubTokenFromBrowserUpgrade } from './hub-ws-auth';
import { getOrCreateSessionId } from '../session';
import { getOrCreateDatabase } from '../db';
import { handleElevenFinalLine } from '../stt/elevenlabs';
import { openUpstreamStt, type SttEvent } from '../stt/elevenlabs-ws-upstream';
import { publish } from '../bus';
import {
	registerCaptureClient,
	unregisterCaptureClient,
	updateCaptureClientSession
} from './capture-registry';

const PATH = '/api/audio/stream';

/**
 * One browser WebSocket: optional upstream to ElevenLabs, or JSON `{type:'final', text}` from client.
 */
export async function handleBrowserSocket(ws: WebSocket, req: IncomingMessage) {
	const token = hubTokenFromBrowserUpgrade(req);
	if (!isHubTokenValid(token)) {
		ws.close(4001, 'Bridge access code required');
		return;
	}
	const db = getOrCreateDatabase();
	let urlSession = new URL(req.url ?? '', 'http://x').searchParams.get('session') ?? '';
	let session = urlSession
		? await getOrCreateSessionId(db, urlSession)
		: await getOrCreateSessionId(db, null);

	ws.send(JSON.stringify({ type: 'session', sessionId: session }));

	const clientId = registerCaptureClient({
		sessionId: session,
		userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
		remoteAddress: req.socket?.remoteAddress ?? null
	});

	let upstream: ReturnType<typeof openUpstreamStt> | null = null;
	let upstreamInitFailed = false;

	const ensureUpstream = () => {
		if (upstream || upstreamInitFailed) return;
		try {
			upstream = openUpstreamStt({
				onEvent: async (e: SttEvent) => {
					if (e.type === 'final') {
						const sid = e.sessionId && e.sessionId !== 'default' ? e.sessionId : session;
						const speakerId = e.speakerId ?? `capture:${clientId}`;
						await handleElevenFinalLine({
							sessionId: await getOrCreateSessionId(db, sid),
							text: e.text,
							speakerId
						});
					} else if (e.type === 'error') {
						publish({ type: 'agent_trace', phase: 'stt', detail: e.message, sessionId: session });
						try {
							ws.send(JSON.stringify({ type: 'stt_upstream_error', error: e.message }));
						} catch {
							// ignore
						}
					} else {
						publish({ type: 'agent_trace', phase: 'stt_partial', detail: e.text, sessionId: session });
					}
				}
			});
		} catch (e) {
			upstreamInitFailed = true;
			ws.send(
				JSON.stringify({
					type: 'stt_unavailable',
					error: (e as Error).message
				})
			);
		}
	};

	ws.on('message', async (raw, isBinary) => {
		// Upstream accepts JSON `input_audio_chunk` (base64 PCM), not raw WebM from MediaRecorder.
		if (isBinary) {
			ensureUpstream();
			if (upstream) {
				const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
				try {
					const b64 = buf.toString('base64');
					// ElevenLabs Realtime requires `commit` + `sample_rate` on each chunk (see API schema).
					const line = JSON.stringify({
						message_type: 'input_audio_chunk',
						audio_base_64: b64,
						commit: false,
						sample_rate: 16000
					});
					upstream.sendClientJson(line);
				} catch (e) {
					ws.send(JSON.stringify({ type: 'error', error: String(e) }));
				}
			}
			return;
		}
		const s = raw.toString();
		try {
			const j = JSON.parse(s) as {
				type?: string;
				text?: string;
				sessionId?: string;
				message_type?: string;
			};
			if (j.type === 'final' && typeof j.text === 'string') {
				if (!j.text.trim()) {
					// no-op; do not send random JSON to ElevenLabs
					return;
				}
				try {
					await handleElevenFinalLine({
						sessionId: await getOrCreateSessionId(db, j.sessionId ?? session),
						text: j.text,
						speakerId: `capture:${clientId}`
					});
					ws.send(JSON.stringify({ type: 'final_acked' }));
				} catch (e) {
					const msg = (e as Error).message;
					ws.send(JSON.stringify({ type: 'final_failed', error: msg }));
				}
			} else if (j.type === 'config' && j.sessionId) {
				const ns = await getOrCreateSessionId(db, j.sessionId);
				session = ns;
				updateCaptureClientSession(clientId, session);
				ws.send(JSON.stringify({ type: 'config_acked' }));
			} else if (j.type === 'waveform') {
				const raw = (j as { levels?: unknown }).levels;
				if (!Array.isArray(raw) || raw.length === 0) {
					return;
				}
				const levels: number[] = [];
				for (const n of raw) {
					if (typeof n !== 'number' || !Number.isFinite(n)) continue;
					levels.push(Math.max(0, Math.min(1, n)));
					if (levels.length >= 32) break;
				}
				if (levels.length) {
					publish({
						type: 'capture_waveform',
						clientId,
						sessionId: session,
						levels
					});
				}
			} else if (j.message_type) {
				// ElevenLabs realtime JSON (e.g. `input_audio_chunk` from a PCM client)
				ensureUpstream();
				if (upstream) {
					try {
						upstream.sendClientJson(s);
					} catch (e) {
						ws.send(JSON.stringify({ type: 'error', error: String(e) }));
					}
				}
			}
		} catch {
			// ignore
		}
	});
	ws.on('close', () => {
		unregisterCaptureClient(clientId);
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
		void handleBrowserSocket(ws, req as IncomingMessage).catch(() => {
			try {
				ws.close(1011, 'internal error');
			} catch {
				// ignore
			}
		});
	});
	httpServer.on('upgrade', (req, socket, head) => {
		const p = new URL(req.url ?? '', 'http://x').pathname;
		if (p !== PATH) return;
		wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
	});
}

export const AUDIO_STREAM_PATH = PATH;
