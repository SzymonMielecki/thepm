import { EventEmitter } from 'node:events';
import type { CaptureClientInfo } from '../capture-types';

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
export type { CaptureClientInfo } from '../capture-types';
export type CaptureDevicesEvent = { type: 'capture_devices'; devices: CaptureClientInfo[] };
export type CaptureWaveformEvent = {
	type: 'capture_waveform';
	clientId: string;
	sessionId: string;
	/** ~0..1, length capped on server; bar graph on hub */
	levels: number[];
};
export type DelegationEvent = {
	type: 'delegation';
	id: string;
	/** Set when delegation was started from a hub ticket draft */
	draftId?: string | null;
	/** Set when delegation was started from a Linear issue without a draft */
	linearIssueId?: string | null;
	targetKind: 'agent' | 'team';
	targetName: string;
	status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
};
export type DelegationStatusEvent = {
	type: 'delegation_status';
	delegationId: string;
	runId: string;
	agentName: string;
	windowId?: string;
	branchName?: string;
	worktreePath?: string;
	status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
	exitCode?: number;
	diffStat?: string;
};
export type SseEvent =
	| TranscriptEvent
	| DraftEvent
	| PrdEvent
	| AgentTraceEvent
	| PrdProposedEvent
	| CaptureDevicesEvent
	| CaptureWaveformEvent
	| DelegationEvent
	| DelegationStatusEvent;

const BUS_KEY = Symbol.for('thepm.hubEventBus');

function getOrCreateBusEmitter() {
	const g = globalThis as unknown as Record<symbol, EventEmitter | undefined>;
	let e = g[BUS_KEY];
	if (!e) {
		e = new EventEmitter();
		e.setMaxListeners(200);
		g[BUS_KEY] = e;
	}
	return e;
}

export function getBus() {
	return getOrCreateBusEmitter();
}

export function publish(event: SseEvent) {
	const emitter = getOrCreateBusEmitter();
	emitter.emit('event', event);
	emitter.emit(event.type, event);
}
