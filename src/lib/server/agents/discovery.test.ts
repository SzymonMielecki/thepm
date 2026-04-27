import { describe, expect, it, beforeEach } from 'vitest';
import { getOrCreateDatabase, resetDatabaseInstanceForTest } from '../db';
import { listMergedAgents, listMergedTeams, renderPromptTemplate } from './discovery';

beforeEach(() => {
	resetDatabaseInstanceForTest();
});

describe('delegation catalog', () => {
	it('exposes researcher, coder, reviewer', async () => {
		const db = getOrCreateDatabase();
		const agents = await listMergedAgents(db, 'ws');
		expect(agents.map((a) => a.name).sort()).toEqual(['coder', 'researcher', 'reviewer']);
	});

	it('exposes default team without DB override', async () => {
		const db = getOrCreateDatabase();
		const teams = await listMergedTeams(db, 'ws');
		expect(teams.some((t) => t.name === 'default')).toBe(true);
		const def = teams.find((t) => t.name === 'default');
		expect(def?.agents).toEqual(['researcher', 'coder', 'reviewer']);
		expect(def?.dispatch).toBe('sequential');
	});
});

describe('renderPromptTemplate', () => {
	it('substitutes merge fields', () => {
		expect(
			renderPromptTemplate('T {{title}} D {{description}} F {{fileRefs}}', {
				title: 'A',
				description: 'B'
			}, 'C')
		).toBe('T A D B F C');
	});
});
