import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { getChatModel } from './llm';
import { getProjectPaths } from '../config';
import { runRipgrep } from '../ripgrep';
import { readScopedFile } from '../fs-scoped';
import { IntentOutputSchema, type IntentOutput, DraftTicketSchema, type DraftTicket } from './types';
import { publish } from '../bus';
import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db';
import { applyPrdPatch } from '../prd/store';

const intentPrompt = `You are a product manager assistant. Classify the latest team utterance.
Return JSON only matching the schema. Use category "noise" for small talk. Use "ticket" for actionable engineering work, bugs, or tasks. Use "prd_update" for product scope or requirements. Extract file or component name hints.`;

const draftPrompt = `You are a product manager. Given intent and any code context snippets, output JSON with title, description (markdown, include file refs as path:line), fileRefs, acceptance (strings), assigneeHint (optional, name only). Return JSON only.`;

export async function runIntentOnText(
	utterance: string,
	sessionId: string
): Promise<IntentOutput> {
	publish({ type: 'agent_trace', phase: 'intent', detail: utterance.slice(0, 200), sessionId });
	const model = getChatModel();
	const structured = model.withStructuredOutput(
		IntentOutputSchema
	) as { invoke: (x: unknown) => Promise<IntentOutput> };
	const out = await structured.invoke([new SystemMessage(intentPrompt), new HumanMessage(utterance)]);
	return IntentOutputSchema.parse(out);
}

export async function runExplore(
	intent: IntentOutput,
	_sessionId: string
): Promise<{ path: string; line: number; text: string; excerpt?: string }[]> {
	if (!intent.fileHints.length) return [];
	const { projectRoot } = getProjectPaths();
	const all: { path: string; line: number; text: string; excerpt?: string }[] = [];
	for (const hint of intent.fileHints.slice(0, 4)) {
		const q = hint.replace(/[^a-zA-Z0-9/_\-.]/g, ' ').trim();
		if (q.length < 2) continue;
		const hits = await runRipgrep(q, { max: 8 });
		for (const h of hits) {
			let excerpt: string | undefined;
			try {
				const rel = h.path;
				const full = readScopedFile(projectRoot, rel);
				const lineIdx = h.line - 1;
				const lns = full.split('\n');
				excerpt = lns
					.slice(Math.max(0, lineIdx - 2), lineIdx + 3)
					.map((L, i) => `${h.line - 2 + i}: ${L}`)
					.join('\n');
			} catch {
				// no excerpt
			}
			all.push({ ...h, excerpt });
		}
	}
	return all.slice(0, 20);
}

export async function runDraft(
	utterance: string,
	intent: IntentOutput,
	rg: { path: string; line: number; text: string; excerpt?: string }[],
	sessionId: string
): Promise<DraftTicket | null> {
	if (intent.category !== 'ticket' && intent.category !== 'unclear') return null;
	publish({ type: 'agent_trace', phase: 'draft', detail: 'Composing ticket', sessionId });
	const model = getChatModel();
	const structured = model.withStructuredOutput(
		DraftTicketSchema
	) as { invoke: (x: unknown) => Promise<DraftTicket> };
	const ctx = rg
		.map(
			(r) =>
				`### ${r.path}:${r.line}\n${r.text}\n` + (r.excerpt ? `Snippet:\n${r.excerpt}\n` : '')
		)
		.join('\n');
	const out = await structured.invoke([
		new SystemMessage(draftPrompt),
		new HumanMessage(
			`Utterance:\n${utterance}\n\nIntent JSON:\n${JSON.stringify(intent)}\n\nContext:\n${ctx}`
		)
	]);
	return DraftTicketSchema.parse(out);
}

export function persistDraft(db: AppDatabase, sessionId: string, d: DraftTicket) {
	const id = randomUUID();
	db.prepare(
		'INSERT INTO ticket_drafts (id, session_id, title, description, assignee_hint, state) VALUES (?,?,?,?,?,"pending")'
	).run(id, sessionId, d.title, d.description, d.assigneeHint ?? null);
	publish({ type: 'draft', id, title: d.title, state: 'pending' });
	return id;
}

export function applyPrdFromIntent(
	db: AppDatabase,
	sessionId: string,
	intent: IntentOutput
) {
	if (intent.category !== 'prd_update' || !intent.prd) {
		// if LLM only put prd in alternative shape
		return null;
	}
	const p = intent.prd;
	return applyPrdPatch(db, sessionId, p.section, p.newBody);
}

