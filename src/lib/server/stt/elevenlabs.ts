import { publish } from '../bus';
import { runPmGraph } from '../agent/graph';
import { getOrCreateDatabase } from '../db';
import { getOrCreateSessionId } from '../session';

const DEFAULT_STT = 'wss://api.elevenlabs.io/v1/speech-to-text';

/**
 * STT base URL. Override with ELEVENLABS_STT_URL / SCRIBE_WS_URL to match your ElevenLabs product.
 */
export function buildScribeUrl(): string {
	return process.env.ELEVENLABS_STT_URL || process.env.SCRIBE_WS_URL || DEFAULT_STT;
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
	// run PM brain on the latest utterance
	try {
		await runPmGraph({ db, sessionId: sid, utterance: text.trim() });
	} catch (e) {
		publish({
			type: 'agent_trace',
			phase: 'error',
			detail: (e as Error).message,
			sessionId: sid
		});
	}
}
