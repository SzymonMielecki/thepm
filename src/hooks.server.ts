import '$lib/server/load-dotenv';
import { getOrCreateDatabase } from '$lib/server/db';
import { initPrdStore } from '$lib/server/prd/store';
import { getProjectPaths } from '$lib/server/config';
import { initAgent } from '$lib/server/agent/graph';
import { isBridgeUiSessionTokenValid } from '$lib/server/code-bridge/bridge-registry';

const BRIDGE_SESSION_COOKIE = 'thepm_bridge_session';

let storageLogDone = false;
let ready = false;
function boot() {
	if (ready) return;
	if (!storageLogDone) {
		storageLogDone = true;
		console.log(
			'[thepm] Hub storage: local SQLite (`.thepm/hub.db`). Override path with THEPM_SQLITE_PATH if needed.'
		);
	}
	const db = getOrCreateDatabase();
	const { prdPath, projectRoot } = getProjectPaths();
	initPrdStore(db, prdPath, projectRoot);
	initAgent({ db, prdPath, projectRoot });
	ready = true;
}

export const handle = async ({ event, resolve }) => {
	// Browsers request /favicon.ico by default; do not require the DB client for that.
	if (event.url.pathname === '/favicon.ico') {
		return resolve(event);
	}
	const qsBridgeSession = event.url.searchParams.get('bridge_session')?.trim();
	if (qsBridgeSession) {
		if (isBridgeUiSessionTokenValid(qsBridgeSession)) {
			event.cookies.set(BRIDGE_SESSION_COOKIE, qsBridgeSession, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				secure: event.url.protocol === 'https:'
			});
			event.locals.bridgeSessionActive = true;
		} else {
			event.cookies.delete(BRIDGE_SESSION_COOKIE, { path: '/' });
			event.locals.bridgeSessionActive = false;
		}
	} else {
		const cookieBridgeSession = event.cookies.get(BRIDGE_SESSION_COOKIE)?.trim();
		if (cookieBridgeSession && isBridgeUiSessionTokenValid(cookieBridgeSession)) {
			event.locals.bridgeSessionActive = true;
		} else {
			if (cookieBridgeSession) {
				event.cookies.delete(BRIDGE_SESSION_COOKIE, { path: '/' });
			}
			event.locals.bridgeSessionActive = false;
		}
	}
	boot();
	event.locals.db = getOrCreateDatabase();
	return resolve(event);
};
