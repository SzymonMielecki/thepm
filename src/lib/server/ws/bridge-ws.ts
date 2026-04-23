import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import {
	registerBridgeConnection,
	unregisterBridgeConnection,
	handleBridgeIncomingRpcMessage
} from '../code-bridge/bridge-registry';
import { scheduleBridgePrdBootstrap } from '../prd/bridge-prd-bootstrap';
import { z } from 'zod';

const PATH = '/api/bridge';

const pathSchema = z.object({
	PROJECT_ROOT: z.string().min(1),
	PRD_PATH: z.string().min(1)
});

type State = { workspaceId: string; projectRoot: string; prdPath: string; ready: boolean };

function send(ws: WebSocket, obj: object) {
	if (ws.readyState === WebSocket.OPEN) {
		try {
			ws.send(JSON.stringify(obj));
		} catch {
			// ignore
		}
	}
}

export function handleBridgeSocket(ws: WebSocket, req: IncomingMessage) {
	const u = new URL(req.url ?? '', 'http://x');
	const token = u.searchParams.get('token')?.trim() ?? '';
	if (!token) {
		ws.close(4001, 'bridge token required');
		return;
	}
	const workspaceId = (u.searchParams.get('workspace') || 'default').trim() || 'default';
	const st: State = { workspaceId, prdPath: '', projectRoot: '', ready: false };

	const finish = (projectRoot: string, prdPath: string) => {
		if (st.ready) return;
		const p = pathSchema.safeParse({ PROJECT_ROOT: projectRoot, PRD_PATH: prdPath });
		if (!p.success) {
			send(ws, { type: 'bridge_ack', ok: false, error: p.error.message });
			return;
		}
		st.projectRoot = p.data.PROJECT_ROOT;
		st.prdPath = p.data.PRD_PATH;
		st.ready = true;
		const uiSession = registerBridgeConnection(st.workspaceId, ws, {
			clientLabel: st.projectRoot,
			projectRoot: st.projectRoot,
			prdPath: st.prdPath,
			accessToken: token
		});
		send(ws, {
			type: 'bridge_ack',
			workspaceId: st.workspaceId,
			ok: true,
			uiSessionToken: uiSession.token,
			uiSessionExpiresAt: uiSession.expiresAt
		});
		scheduleBridgePrdBootstrap(st.workspaceId);
	};

	const tryConfig = (raw: string) => {
		let j: unknown;
		try {
			j = JSON.parse(raw);
		} catch {
			return;
		}
		if (!j || typeof j !== 'object') return;
		const t = (j as { type?: string }).type;
		if (t !== 'bridge_hello' && t !== 'bridge_config') return;
		const w = 'workspaceId' in j && typeof (j as { workspaceId?: string }).workspaceId === 'string'
			? (j as { workspaceId: string }).workspaceId
			: null;
		if (w) {
			st.workspaceId = w;
		}
		const pRoot = (j as { projectRoot?: string; prdPath?: string }).projectRoot;
		const pPrd = (j as { projectRoot?: string; prdPath?: string }).prdPath;
		if (typeof pRoot === 'string' && typeof pPrd === 'string' && pRoot && pPrd) {
			finish(pRoot, pPrd);
		}
	};

	ws.on('message', (data) => {
		const raw = data.toString();
		if (!st.ready) {
			tryConfig(raw);
			if (!st.ready) {
				try {
					ws.close(4003, 'Expected bridge_hello with projectRoot and prdPath');
				} catch {
					// ignore
				}
			}
			return;
		}
		handleBridgeIncomingRpcMessage(data);
	});

	ws.on('close', () => {
		if (st.ready) {
			unregisterBridgeConnection(st.workspaceId, ws);
		}
	});
}

let attached = false;

export function attachBridgeWssToHttpServer(httpServer: Server) {
	if (attached) return;
	attached = true;
	const wss = new WebSocketServer({ noServer: true });
	wss.on('connection', (ws, req) => {
		void handleBridgeSocket(ws, req as IncomingMessage);
	});
	httpServer.on('upgrade', (req, socket, head) => {
		const p = new URL(req.url ?? '', 'http://x').pathname;
		if (p !== PATH) return;
		wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
	});
}

export { PATH as BRIDGE_WSS_PATH };
