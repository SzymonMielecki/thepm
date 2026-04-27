import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
	_resetBridgeRegistryForTests,
	isBridgeAccessTokenValid,
	registerBridgeConnection,
	unregisterBridgeConnection
} from './bridge-registry';

function openWsStub() {
	return {
		readyState: WebSocket.OPEN,
		send: vi.fn(),
		close: vi.fn()
	} as unknown as WebSocket;
}

afterEach(() => {
	_resetBridgeRegistryForTests();
});

describe('bridge access token', () => {
	it('accepts the token registered with the bridge connection', () => {
		const ws = openWsStub();
		registerBridgeConnection('default', ws, {
			projectRoot: '/tmp/repo',
			prdPath: '/tmp/repo/PRD.md',
			accessToken: 'bridge-token-123'
		});
		expect(isBridgeAccessTokenValid('bridge-token-123')).toBe(true);
	});

	it('rejects the token after the bridge disconnects', () => {
		const ws = openWsStub();
		registerBridgeConnection('default', ws, {
			projectRoot: '/tmp/repo',
			prdPath: '/tmp/repo/PRD.md',
			accessToken: 'bridge-token-abc'
		});
		expect(isBridgeAccessTokenValid('bridge-token-abc')).toBe(true);
		unregisterBridgeConnection('default', ws);
		expect(isBridgeAccessTokenValid('bridge-token-abc')).toBe(false);
	});
});
