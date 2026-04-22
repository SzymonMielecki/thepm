import { randomUUID } from 'node:crypto';
import type { AppDatabase } from './db';

export function getOrCreateSessionId(db: AppDatabase, id: string | null | undefined): string {
	if (id) {
		const r = db.prepare('SELECT id FROM sessions WHERE id = ?').get(id) as { id: string } | undefined;
		if (r) return r.id;
	}
	const nid = randomUUID();
	db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
		nid,
		`Session ${new Date().toISOString().slice(0, 16)}`
	);
	return nid;
}
