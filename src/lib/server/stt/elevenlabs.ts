import { publish } from '../bus';
import { runPmGraph } from '../agent/graph';
import { getOrCreateDatabase } from '../db';
import { getOrCreateSessionId } from '../session';
import { getEnv } from '../config';

/** Official Scribe v2 Realtime WebSocket (see ElevenLabs API docs). */
export const ELEVENLABS_REALTIME_STT = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';

/**
 * WebSocket base URL. Override with ELEVENLABS_STT_URL for regional endpoints, etc.
 */
export function buildScribeUrl(): string {
	return process.env.ELEVENLABS_STT_URL || process.env.SCRIBE_WS_URL || ELEVENLABS_REALTIME_STT;
}

const REALTIME_DEFAULT = 'scribe_v2_realtime';

/**
 * Query params for realtime STT.
 * The WebSocket is **Scribe v2 Realtime** only. Batch / `scribe_v1` ids (common in .env) do not
 * work here and will yield no (or broken) `committed_transcript` events.
 */
export function realtimeSttQuery(): URLSearchParams {
	const e = getEnv();
	const q = new URLSearchParams();
	const raw = (process.env.ELEVENLABS_STT_MODEL || e.elevenlabsSttModel || '').trim();
	// Only pass through explicit realtime model ids; anything else (e.g. scribe_v1) falls back.
	const model = raw && /realtime/i.test(raw) ? raw : REALTIME_DEFAULT;
	q.set('model_id', model);
	q.set('commit_strategy', 'vad');
	q.set('audio_format', 'pcm_16000');
	// Word-level payload includes speaker_id when the model provides diarization.
	q.set('include_timestamps', 'true');
	return q;
}

/**
 * Buffers and forwards to DB + optional PM graph.
 */
export async function handleElevenFinalLine(params: {
	sessionId: string;
	text: string;
	speakerId: string | null;
}) {
	const db = getOrCreateDatabase();
	const { sessionId, text, speakerId } = params;
	if (!text.trim()) return;
	const sid = getOrCreateSessionId(db, sessionId);
	db.prepare('INSERT INTO transcripts (session_id, speaker_id, text) VALUES (?,?,?)').run(
		sid,
		speakerId,
		text.trim()
	);
	publish({
		type: 'transcript',
		sessionId: sid,
		speakerId,
		text: text.trim()
	});
	try {
		await runPmGraph({ db, sessionId: sid, utterance: text.trim(), speakerId });
	} catch (e) {
		publish({
			type: 'agent_trace',
			phase: 'error',
			detail: (e as Error).message,
			sessionId: sid
		});
	}
}
