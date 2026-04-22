import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import chokidar from 'chokidar';
import type { AppDatabase } from '../db';
import { publish } from '../bus';
import { getProjectPaths } from '../config';
import { diffLines } from 'diff';

let prdPathGlobal = '';
let watcher: chokidar.FSWatcher | null = null;

function listSections(markdown: string): { title: string; level: number; body: string }[] {
	const lines = markdown.split('\n');
	const idx: { line: number; level: number; title: string }[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = /^(#+)\s+(.+)$/.exec(lines[i] ?? '');
		if (m) idx.push({ line: i, level: m[1]!.length, title: m[2]!.trim() });
	}
	const segs: { title: string; level: number; body: string }[] = [];
	for (let k = 0; k < idx.length; k++) {
		const end = k + 1 < idx.length ? idx[k + 1]!.line : lines.length;
		segs.push({
			title: idx[k]!.title,
			level: idx[k]!.level,
			body: lines.slice(idx[k]!.line + 1, end).join('\n')
		});
	}
	return segs;
}

export function listPrdSectionTitles(md: string) {
	return listSections(md).map((s) => s.title);
}

/** Get section body by full heading text (e.g. "## Goals" -> "Goals" or with hashes) */
export function getSectionByTitle(
	markdown: string,
	heading: string
): { title: string; body: string } | null {
	const want = heading.replace(/^#+\s*/, '').trim();
	const segs = listSections(markdown);
	for (const s of segs) {
		if (s.title === want) return { title: s.title, body: s.body.trim() };
	}
	// Fuzzy: contains
	for (const s of segs) {
		if (s.title.toLowerCase().includes(want.toLowerCase()) || want.toLowerCase().includes(s.title.toLowerCase())) {
			return { title: s.title, body: s.body.trim() };
		}
	}
	return null;
}

/**
 * Replace body under the first H2+ heading matching `title`.
 */
export function patchSection(
	markdown: string,
	sectionTitle: string,
	newBody: string
): { ok: true; out: string } | { ok: false; error: string } {
	const want = sectionTitle.replace(/^#+\s*/, '').trim();
	const lines = markdown.split('\n');
	let targetStart = -1;
	let targetLevel = 2;
	for (let i = 0; i < lines.length; i++) {
		const m = /^(#+)\s+(.+)$/.exec(lines[i] ?? '');
		if (m) {
			const level = m[1].length;
			const t = m[2].trim();
			if (t === want || t.toLowerCase() === want.toLowerCase()) {
				targetStart = i;
				targetLevel = level;
				break;
			}
		}
	}
	if (targetStart < 0) {
		// append new section
		const sep = markdown.trim().length ? '\n\n' : '';
		return { ok: true, out: `${markdown}${sep}## ${want}\n\n${newBody.trim()}\n` };
	}
	let end = lines.length;
	for (let j = targetStart + 1; j < lines.length; j++) {
		const m = /^(#+)\s/.exec(lines[j] ?? '');
		if (m) {
			const L = m[1].length;
			if (L <= targetLevel) {
				end = j;
				break;
			}
		}
	}
	const before = lines.slice(0, targetStart + 1).join('\n');
	const after = lines.slice(end).join('\n');
	const mid = newBody.trim();
	const newMd = [before, mid, after].filter(Boolean).join('\n\n');
	return { ok: true, out: newMd + (newMd.endsWith('\n') ? '' : '\n') };
}

export function getPrdContent(path: string) {
	if (!existsSync(path)) {
		const dir = dirname(path);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			path,
			'# Product Requirements (Root)\n\n## Vision\n\n## Goals\n\n## Decisions\n\n',
			'utf-8'
		);
	}
	return readFileSync(path, 'utf-8');
}

export function initPrdStore(_db: AppDatabase, prdPath: string, _projectRoot: string) {
	if (watcher) return;
	prdPathGlobal = prdPath;
	// ensure file
	getPrdContent(prdPath);
	watcher = chokidar.watch(prdPath, { ignoreInitial: true });
	watcher.on('change', () => {
		try {
			const content = getPrdContent(prdPath);
			publish({ type: 'prd', path: prdPath, content });
		} catch {
			// ignore
		}
	});
}

export function getPrdPath() {
	if (prdPathGlobal) return prdPathGlobal;
	return getProjectPaths().prdPath;
}

export function readPrd() {
	return getPrdContent(getPrdPath());
}

export function writePrdWithRevision(
	db: AppDatabase,
	sessionId: string | null,
	summary: string,
	before: string,
	after: string
) {
	const p = getPrdPath();
	writeFileSync(p, after, 'utf-8');
	db
		.prepare(
			'INSERT INTO prd_revisions (session_id, summary, content_before, content_after) VALUES (?,?,?,?)'
		)
		.run(sessionId, summary, before, after);
	publish({ type: 'prd', path: p, content: after });
}

export function applyPrdPatch(
	db: AppDatabase,
	sessionId: string | null,
	section: string,
	newBody: string
) {
	const before = readPrd();
	const r = patchSection(before, section, newBody);
	if (!r.ok) return r;
	const after = r.out;
	const diff = diffLines(before, after);
	const short =
		`… ${diff
			.filter((d) => d.added || d.removed)
			.map((d) => (d.added ? `+${d.value}` : d.removed ? `-${d.value}` : ''))
			.join('')
			.slice(0, 500)}`.trim() || 'PRD update';
	writePrdWithRevision(db, sessionId, short, before, after);
	return { ok: true as const, content: after };
}

export function writeFullPrd(
	db: AppDatabase,
	sessionId: string | null,
	content: string
) {
	const before = readPrd();
	if (before === content) return { ok: true as const, content };
	writePrdWithRevision(db, sessionId, 'full edit', before, content);
	return { ok: true as const, content };
}

