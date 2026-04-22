import { EventEmitter } from 'node:events';

export type TranscriptEvent = {
	type: 'transcript';
	sessionId: string;
	speakerId: string | null;
	text: string;
};
export type DraftEvent = { type: 'draft'; id: string; title: string; state: string };
export type PrdEvent = { type: 'prd'; path: string; content: string };
export type AgentTraceEvent = {
	type: 'agent_trace';
	phase: string;
	detail: string;
	sessionId?: string;
};
export type PrdProposedEvent = { type: 'prd_proposed'; section: string; body: string };
export type SseEvent = TranscriptEvent | DraftEvent | PrdEvent | AgentTraceEvent | PrdProposedEvent;

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

export function getBus() {
	return emitter;
}

export function publish(event: SseEvent) {
	emitter.emit('event', event);
	emitter.emit(event.type, event);
}
