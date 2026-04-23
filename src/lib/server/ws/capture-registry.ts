import { randomUUID } from 'node:crypto';
import { publish } from '../bus';
import type { CaptureClientInfo } from '../../capture-types';

const REG_KEY = Symbol.for('thepm.captureRegistry');

function getRegistry(): Map<string, CaptureClientInfo> {
	const g = globalThis as unknown as Record<symbol, Map<string, CaptureClientInfo> | undefined>;
	if (!g[REG_KEY]) g[REG_KEY] = new Map();
	return g[REG_KEY]!;
}

function broadcast() {
	const devices = [...getRegistry().values()];
	publish({ type: 'capture_devices', devices });
}

export function registerCaptureClient(
	fields: Omit<CaptureClientInfo, 'id' | 'connectedAt'>
): string {
	const id = randomUUID();
	const row: CaptureClientInfo = {
		id,
		connectedAt: Date.now(),
		...fields
	};
	getRegistry().set(id, row);
	broadcast();
	return id;
}

export function unregisterCaptureClient(id: string) {
	if (!getRegistry().delete(id)) return;
	broadcast();
}

export function updateCaptureClientSession(id: string, sessionId: string) {
	const reg = getRegistry();
	const cur = reg.get(id);
	if (!cur) return;
	reg.set(id, { ...cur, sessionId });
	broadcast();
}

export function listCaptureClients(): CaptureClientInfo[] {
	return [...getRegistry().values()];
}
