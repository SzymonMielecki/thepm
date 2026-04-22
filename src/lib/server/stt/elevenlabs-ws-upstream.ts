import WebSocket from 'ws';
import { getEnv } from '../config';
import { buildScribeUrl } from './elevenlabs';

export type SttEvent =
	| { type: 'final'; text: string; speakerId: string | null; sessionId: string; raw: unknown }
	| { type: 'partial'; text: string; sessionId: string; raw: unknown }
	| { type: 'error'; message: string; sessionId: string };

/**
 * Open upstream ElevenLabs WS. Accepts binary audio frames; emits JSON events (defensive parsing).
 */
export function openUpstreamStt(options: {
	onEvent: (e: SttEvent) => void;
}): { send: (buf: Buffer) => void; close: () => void } {
	const key = getEnv().elevenlabsApiKey;
	if (!key) {
		throw new Error('ELEVENLABS_API_KEY is required for speech-to-text');
	}
	const url = new URL(buildScribeUrl());
	url.searchParams.set('api_key', key);
	if (getEnv().elevenlabsSttModel) {
		url.searchParams.set('model', getEnv().elevenlabsSttModel);
	}
	const ws = new WebSocket(url.toString());
	const send = (buf: Buffer) => {
		if (ws.readyState === WebSocket.OPEN) ws.send(buf);
	};
	const close = () => {
		try {
			ws.close();
		} catch {
			// ignore
		}
	};
	ws.on('message', (data) => {
		try {
			const s = data.toString();
			const j = JSON.parse(s) as Record<string, unknown>;
			const text = (j.text ?? j.transcript ?? j.message ?? (j as { data?: { text?: string } }).data
				?.text) as string | undefined;
			if (!text) return;
			const isFinal = Boolean(
				(j as { is_final?: boolean }).is_final === true || (j as { final?: boolean }).final === true
			);
			const isPartial = (j as { is_final?: boolean }).is_final === false;
			if (!isFinal && isPartial) {
				const sid = String((j as { session_id?: string }).session_id ?? 'default');
				options.onEvent({ type: 'partial', text, sessionId: sid, raw: j });
				return;
			}
			// final if marked final or not explicitly partial
			if (isFinal || !isPartial) {
				const sid = String((j as { session_id?: string }).session_id ?? 'default');
				options.onEvent({
					type: 'final',
					text,
					speakerId: (j as { speaker_id?: string }).speaker_id ?? null,
					sessionId: sid,
					raw: j
				});
			}
		} catch {
			// binary
		}
	});
	ws.on('error', (e) => {
		options.onEvent({
			type: 'error',
			message: (e as Error).message,
			sessionId: 'default'
		});
	});
	return { send, close };
}
