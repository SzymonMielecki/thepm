import WebSocket from 'ws';
import { getEnv } from '../config';
import { buildScribeUrl, realtimeSttQuery } from './elevenlabs';

export type SttEvent =
	| { type: 'final'; text: string; speakerId: string | null; sessionId: string; raw: unknown }
	| { type: 'partial'; text: string; sessionId: string; raw: unknown }
	| { type: 'error'; message: string; sessionId: string };

/**
 * Upstream to ElevenLabs `wss://.../v1/speech-to-text/realtime` (Scribe v2).
 * - Auth: `xi-api-key` header (not `api_key` in query)
 * - Client → EL: JSON `input_audio_chunk` with base64 PCM (forwarded as text)
 * - EL → us: `session_started`, `partial_transcript`, `committed_transcript`, `error`, …
 */
export function openUpstreamStt(options: {
	onEvent: (e: SttEvent) => void;
}): { sendClientJson: (line: string) => void; close: () => void } {
	const key = getEnv().elevenlabsApiKey;
	if (!key) {
		throw new Error('ELEVENLABS_API_KEY is required for speech-to-text');
	}
	const base = buildScribeUrl();
	const u = new URL(base);
	for (const [k, v] of realtimeSttQuery()) {
		u.searchParams.set(k, v);
	}
	const url = u.toString();

	const pending: string[] = [];
	const MAX_QUEUED = 400;
	let sessionReady = false;

	const tryFlush = () => {
		if (!sessionReady || ws.readyState !== WebSocket.OPEN) return;
		while (pending.length) {
			const s = pending.shift();
			if (s) ws.send(s);
		}
	};

	const ws = new WebSocket(url, {
		headers: { 'xi-api-key': key }
	});

	ws.on('message', (data) => {
		try {
			const s = data.toString();
			const j = JSON.parse(s) as Record<string, unknown>;
			const mtRaw = j.message_type;
			const mt = typeof mtRaw === 'string' ? mtRaw.toLowerCase() : '';

			function lineText(): string {
				if (typeof j.text === 'string' && j.text) return j.text;
				const tr = (j as { transcript?: unknown }).transcript;
				return typeof tr === 'string' ? tr : '';
			}

			const sttErrTypes = new Set([
				'error',
				'auth_error',
				'quota_exceeded',
				'transcriber_error',
				'input_error',
				'commit_throttled',
				'unaccepted_terms',
				'unaccepted_terms_error',
				'rate_limited',
				'queue_overflow',
				'resource_exhausted',
				'session_time_limit_exceeded',
				'chunk_size_exceeded',
				'insufficient_audio_activity'
			]);

			if (mt === 'session_started') {
				sessionReady = true;
				tryFlush();
				return;
			}

			if (mt === 'partial_transcript') {
				const text = lineText();
				if (text) {
					options.onEvent({
						type: 'partial',
						text,
						sessionId: 'default',
						raw: j
					});
				}
				return;
			}

			if (mt === 'committed_transcript' || mt === 'committed_transcript_with_timestamps') {
				const text = lineText();
				if (text) {
					let sp: string | null = null;
					const words = (j as { words?: unknown }).words;
					if (Array.isArray(words)) {
						for (const w of words) {
							if (!w || typeof w !== 'object') continue;
							const o = w as Record<string, unknown>;
							const sid = o.speaker_id ?? o.speakerId;
							if (typeof sid === 'string' && sid.trim()) {
								sp = sid;
								break;
							}
						}
					}
					options.onEvent({
						type: 'final',
						text,
						speakerId: sp,
						sessionId: 'default',
						raw: j
					});
				}
				return;
			}

			if (mt && sttErrTypes.has(mt)) {
				const errField = (j as { error?: unknown }).error;
				const detail =
					typeof errField === 'string'
						? errField
						: typeof (j as { message?: unknown }).message === 'string'
							? (j as { message: string }).message
							: JSON.stringify(j);
				options.onEvent({
					type: 'error',
					message: `${mt}: ${detail}`,
					sessionId: 'default'
				});
				return;
			}

			if (mt && mt.endsWith('error') && typeof (j as { error?: string }).error === 'string') {
				const msg = (j as { error: string }).error;
				options.onEvent({
					type: 'error',
					message: `${mt}: ${msg}`,
					sessionId: 'default'
				});
			}
		} catch {
			// non-json
		}
	});

	ws.on('error', (e) => {
		options.onEvent({
			type: 'error',
			message: (e as Error).message,
			sessionId: 'default'
		});
	});

	const sendClientJson = (line: string) => {
		if (ws.readyState === WebSocket.OPEN && sessionReady) {
			ws.send(line);
		} else {
			if (pending.length < MAX_QUEUED) pending.push(line);
		}
		if (ws.readyState === WebSocket.OPEN) tryFlush();
	};

	ws.on('open', () => {
		tryFlush();
	});

	const close = () => {
		try {
			ws.close();
		} catch {
			// ignore
		}
	};

	return { sendClientJson, close };
}
