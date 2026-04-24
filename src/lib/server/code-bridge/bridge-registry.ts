import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocket, type RawData } from 'ws';
import type { WebSocket as WsType } from 'ws';
import type { CodeOpName, CodeReqMessage, CodeResMessage } from './protocol';

const DEFAULT_CALL_MS = 60_000;
const BRIDGE_UI_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

type Pending = {
	complete: (v: CodeResMessage) => void;
	timer: ReturnType<typeof setTimeout>;
	workspaceId: string;
};

type BridgeEntry = {
	ws: WsType;
	/** e.g. client machine project root (from bridge_hello) */
	lastLabel?: string;
	prdPath?: string;
	projectRoot?: string;
	accessToken?: string;
	/** Optional; from bridge CLI — override hub env for this workspace. */
	linearApiKey?: string;
	linearTeamId?: string;
};

type BridgeUiSession = { workspaceId: string; token: string; expiresAt: number };

/** `server.ts` (tsx) and the bundled SvelteKit server are separate module instances — share in-memory state on globalThis. */
type BridgeGlobalMaps = {
	bridges: Map<string, BridgeEntry>;
	pending: Map<string, Pending>;
	bridgeUiSessionsByWorkspace: Map<string, BridgeUiSession>;
	bridgeUiSessionsByToken: Map<string, BridgeUiSession>;
};

function getBridgeMaps(): BridgeGlobalMaps {
	const g = globalThis as typeof globalThis & { __thepmBridgeRegistryMaps?: BridgeGlobalMaps };
	if (!g.__thepmBridgeRegistryMaps) {
		g.__thepmBridgeRegistryMaps = {
			bridges: new Map(),
			pending: new Map(),
			bridgeUiSessionsByWorkspace: new Map(),
			bridgeUiSessionsByToken: new Map()
		};
	}
	return g.__thepmBridgeRegistryMaps;
}

const { bridges, pending, bridgeUiSessionsByWorkspace, bridgeUiSessionsByToken } = getBridgeMaps();

function safeSend(ws: WsType, obj: object) {
	if (ws.readyState !== WebSocket.OPEN) {
		return false;
	}
	try {
		ws.send(JSON.stringify(obj));
		return true;
	} catch {
		return false;
	}
}

export function registerBridgeConnection(
	workspaceId: string,
	ws: WsType,
	opts?: {
		clientLabel?: string;
		prdPath?: string;
		projectRoot?: string;
		accessToken?: string;
		linearApiKey?: string;
		linearTeamId?: string;
	}
): BridgeUiSession {
	const old = bridges.get(workspaceId);
	if (old && old.ws !== ws) {
		try {
			old.ws.close(4002, 'replaced');
		} catch {
			// ignore
		}
	}
	bridges.set(workspaceId, {
		ws,
		lastLabel: opts?.clientLabel,
		prdPath: opts?.prdPath,
		projectRoot: opts?.projectRoot,
		accessToken: opts?.accessToken,
		linearApiKey: opts?.linearApiKey?.trim() || undefined,
		linearTeamId: opts?.linearTeamId?.trim() || undefined
	});
	return issueBridgeUiSession(workspaceId);
}

/** Active bridge client paths (from last `bridge_hello`) for a workspace, if connected. */
/** Bridge-supplied Linear overrides for this workspace (merged with hub env in `linear.ts`). */
export function getBridgeLinearOverrides(workspaceId: string): {
	linearApiKey?: string;
	linearTeamId?: string;
} {
	const e = bridges.get(workspaceId);
	if (!e || e.ws.readyState !== WebSocket.OPEN) return {};
	const out: { linearApiKey?: string; linearTeamId?: string } = {};
	if (e.linearApiKey) out.linearApiKey = e.linearApiKey;
	if (e.linearTeamId) out.linearTeamId = e.linearTeamId;
	return out;
}

export function getBridgeClientPaths(
	workspaceId: string
): { projectRoot: string; prdPath: string } | null {
	const e = bridges.get(workspaceId);
	if (!e || e.ws.readyState !== WebSocket.OPEN) return null;
	if (!e.prdPath || !e.projectRoot) return null;
	return { projectRoot: e.projectRoot, prdPath: e.prdPath };
}

export function unregisterBridgeConnection(workspaceId: string, ws: WsType) {
	const cur = bridges.get(workspaceId);
	if (cur?.ws === ws) {
		bridges.delete(workspaceId);
	}
	clearBridgeUiSession(workspaceId);
	for (const [id, p] of [...pending]) {
		if (p.workspaceId !== workspaceId) continue;
		p.complete({ type: 'code_res', id, ok: false, error: 'Bridge connection closed' });
		clearTimeout(p.timer);
		pending.delete(id);
	}
}

function clearBridgeUiSession(workspaceId: string) {
	const cur = bridgeUiSessionsByWorkspace.get(workspaceId);
	if (!cur) return;
	bridgeUiSessionsByWorkspace.delete(workspaceId);
	bridgeUiSessionsByToken.delete(cur.token);
}

function sessionActive(s: BridgeUiSession): boolean {
	if (Date.now() >= s.expiresAt) {
		clearBridgeUiSession(s.workspaceId);
		return false;
	}
	const bridge = bridges.get(s.workspaceId);
	return !!bridge && bridge.ws.readyState === WebSocket.OPEN;
}

export function issueBridgeUiSession(workspaceId: string): BridgeUiSession {
	clearBridgeUiSession(workspaceId);
	const s: BridgeUiSession = {
		workspaceId,
		token: randomBytes(24).toString('base64url'),
		expiresAt: Date.now() + BRIDGE_UI_SESSION_TTL_MS
	};
	bridgeUiSessionsByWorkspace.set(workspaceId, s);
	bridgeUiSessionsByToken.set(s.token, s);
	return s;
}

export function isBridgeUiSessionTokenValid(token: string | null | undefined): boolean {
	const t = (token ?? '').trim();
	if (!t) return false;
	const s = bridgeUiSessionsByToken.get(t);
	if (!s) return false;
	if (!sessionActive(s)) return false;
	return true;
}

export function bridgeUiSessionForWorkspace(
	workspaceId: string
): { token: string; expiresAt: number } | null {
	const s = bridgeUiSessionsByWorkspace.get(workspaceId);
	if (!s) return null;
	if (!sessionActive(s)) return null;
	return { token: s.token, expiresAt: s.expiresAt };
}

function parseJson(data: RawData): unknown {
	try {
		return JSON.parse(data.toString());
	} catch {
		return null;
	}
}

/**
 * Call from the bridge WebSocket's single `message` handler to resolve pending `callBridge` RPCs.
 */
export function handleBridgeIncomingRpcMessage(data: RawData): void {
	const j = parseJson(data);
	if (!j || typeof j !== 'object') return;
	const t = (j as { type?: string; id?: string }).type;
	const id = (j as { id?: string }).id;
	if (t !== 'code_res' || !id) return;
	const p = pending.get(id);
	if (!p) return;
	const msg = j as CodeResMessage;
	clearTimeout(p.timer);
	pending.delete(id);
	p.complete(msg);
}

/**
 * @throws if no bridge or timeout
 */
export async function callBridge(
	workspaceId: string,
	op: CodeOpName,
	args: Record<string, unknown>,
	timeoutMs = DEFAULT_CALL_MS
): Promise<unknown> {
	const entry = bridges.get(workspaceId);
	if (!entry || entry.ws.readyState !== WebSocket.OPEN) {
		throw new Error(
			'Code bridge is not connected. Run `thepm bridge` with the required flags (see `thepm bridge --help`).'
		);
	}
	const id = randomUUID();
	const req: CodeReqMessage = { type: 'code_req', id, op, args };
	if (!safeSend(entry.ws, req)) {
		throw new Error('Code bridge: failed to send request');
	}
	return new Promise<unknown>((resolve, reject) => {
		const timer = setTimeout(() => {
			if (pending.delete(id)) {
				reject(new Error(`Code bridge timeout after ${timeoutMs}ms`));
			}
		}, timeoutMs);
		pending.set(id, {
			complete: (msg) => {
				if (msg.ok) {
					resolve(msg.result);
				} else {
					reject(new Error(msg.error));
				}
			},
			timer,
			workspaceId
		});
	});
}

export function isBridgeConnected(workspaceId: string): boolean {
	const e = bridges.get(workspaceId);
	return !!e && e.ws.readyState === WebSocket.OPEN;
}

export function isBridgeAccessTokenValid(token: string | null | undefined): boolean {
	const t = (token ?? '').trim();
	if (!t) return false;
	for (const entry of bridges.values()) {
		if (entry.ws.readyState !== WebSocket.OPEN) continue;
		if (entry.accessToken && entry.accessToken === t) return true;
	}
	return false;
}

export function getBridgeCount(): number {
	return bridges.size;
}

/** @internal tests */
export function _resetBridgeRegistryForTests() {
	for (const p of pending.values()) {
		clearTimeout(p.timer);
	}
	pending.clear();
	bridges.clear();
	bridgeUiSessionsByToken.clear();
	bridgeUiSessionsByWorkspace.clear();
}
