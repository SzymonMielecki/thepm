import '$lib/server/load-dotenv';
import { getOrCreateDatabase } from '$lib/server/db';
import { initPrdStore } from '$lib/server/prd/store';
import { getProjectPaths } from '$lib/server/config';
import { initAgent } from '$lib/server/agent/graph';

let ready = false;
function boot() {
	if (ready) return;
	const db = getOrCreateDatabase();
	const { prdPath, projectRoot } = getProjectPaths();
	initPrdStore(db, prdPath, projectRoot);
	initAgent({ db, prdPath, projectRoot });
	ready = true;
}

export const handle = async ({ event, resolve }) => {
	// Browsers request /favicon.ico by default; do not require SQLite for that.
	if (event.url.pathname === '/favicon.ico') {
		return resolve(event);
	}
	boot();
	event.locals.db = getOrCreateDatabase();
	return resolve(event);
};
