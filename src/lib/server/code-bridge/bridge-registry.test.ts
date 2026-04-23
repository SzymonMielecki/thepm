import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
	_resetBridgeRegistryForTests,
	isBridgeUiSessionTokenValid,
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

describe('bridge UI session lifecycle', () => {
	it('issues a session token on bridge connect', () => {
		const ws = openWsStub();
		const issued = registerBridgeConnection('default', ws, {
			projectRoot: '/tmp/repo',
			prdPath: '/tmp/repo/PRD.md',
			accessToken: 'bridge-token-123'
		});
		expect(typeof issued.token).toBe('string');
		expect(issued.token.length).toBeGreaterThan(20);
		expect(isBridgeUiSessionTokenValid(issued.token)).toBe(true);
		expect(isBridgeAccessTokenValid('bridge-token-123')).toBe(true);
	});

	it('invalidates session token when bridge disconnects', () => {
		const ws = openWsStub();
		const issued = registerBridgeConnection('default', ws, {
			projectRoot: '/tmp/repo',
			prdPath: '/tmp/repo/PRD.md',
			accessToken: 'bridge-token-abc'
		});
		expect(isBridgeUiSessionTokenValid(issued.token)).toBe(true);
		expect(isBridgeAccessTokenValid('bridge-token-abc')).toBe(true);
		unregisterBridgeConnection('default', ws);
		expect(isBridgeUiSessionTokenValid(issued.token)).toBe(false);
		expect(isBridgeAccessTokenValid('bridge-token-abc')).toBe(false);
	});
});
