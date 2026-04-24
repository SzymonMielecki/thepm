import { randomUUID } from 'node:crypto';
import type { AppDatabase } from './db';

export async function getOrCreateSessionId(
	db: AppDatabase,
	id: string | null | undefined
): Promise<string> {
	if (id) {
		const { data } = await db.from('sessions').select('id').eq('id', id).maybeSingle();
		if (data) return data.id;
	}
	const nid = randomUUID();
	const { error } = await db.from('sessions').insert({
		id: nid,
		name: `Session ${new Date().toISOString().slice(0, 16)}`
	});
	if (error) throw error;
	return nid;
}
