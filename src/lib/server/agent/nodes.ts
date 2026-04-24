import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { getChatModel, invokeWithStructuredZod } from './llm';
import { getCodeBackend } from '../code-bridge/code-backend';
import {
	IntentOutputSchema,
	type IntentOutput,
	DraftTicketSchema,
	type DraftTicket,
	PrdSectionPatchSchema
} from './types';
import { publish } from '../bus';
import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db';
import { readPrdForHub } from '../prd/store';

const intentPrompt = `You are a product manager assistant. Classify the latest team utterance.
The message may include the current root PRD (PRD.md) for context so you can align prd_update sections with existing headings.
Return JSON only matching the schema. Use category "noise" for small talk.
Use "ticket" when the primary ask is actionable engineering work, bugs, or implementation tasks (even if the PRD should stay in sync — the ticket path captures the work).
Use "prd_update" when the primary ask is to change product scope, requirements, or documentation wording only.
For prd_update, include prd hints as usual; PRD edits are applied only after explicit draft approval.
Extract file or component name hints: for prd_update, add fileHints whenever the request touches specific code, features, or paths so the doc can be grounded in repo search.`;

const draftPrompt = `You are a product manager. Given intent, the root PRD (if any), and any code context snippets, output JSON with title, description (markdown, include file refs as path:line), fileRefs, acceptance (strings), assigneeHint (optional, name only). Return JSON only.`;

const prdRefinePrompt = `You update the product requirements document (markdown). You receive the current PRD, the team utterance, optional first-pass target section/body from classification, and ripgrep/code snippets from the repository.
Output JSON only: the section to update (heading text as in the PRD, e.g. "Goals" — match an existing H2+ title) and the new markdown body for that section only. Ground product claims in the code context when it supports the change; if code context is empty, still produce a consistent section update from the utterance and PRD.`;

const PRD_IN_PROMPT_MAX = 18_000;

export async function runIntentOnText(
	utterance: string,
	sessionId: string
): Promise<IntentOutput> {
	publish({ type: 'agent_trace', phase: 'intent', detail: utterance.slice(0, 200), sessionId });
	const model = getChatModel();
	let prdBlock = '';
	try {
		const full = await readPrdForHub();
		if (full.trim()) {
			prdBlock =
				full.length > PRD_IN_PROMPT_MAX
					? `${full.slice(0, PRD_IN_PROMPT_MAX)}\n\n[... PRD truncated for intent ...]`
					: full;
		}
	} catch (e) {
		publish({
			type: 'agent_trace',
			phase: 'intent_prd',
			detail: `No PRD context: ${(e as Error).message}`,
			sessionId
		});
	}
	const userContent = prdBlock
		? `Current root document (PRD.md):\n\n---\n${prdBlock}\n---\n\nLatest utterance to classify:\n\n${utterance}`
		: utterance;
	return invokeWithStructuredZod(model, IntentOutputSchema, [
		new SystemMessage(intentPrompt),
		new HumanMessage(userContent)
	]);
}

export async function runExplore(
	intent: IntentOutput,
	_sessionId: string
): Promise<{ path: string; line: number; text: string; excerpt?: string }[]> {
	if (!intent.fileHints.length) return [];
	const backend = getCodeBackend();
	const all: { path: string; line: number; text: string; excerpt?: string }[] = [];
	for (const hint of intent.fileHints.slice(0, 4)) {
		const q = hint.replace(/[^a-zA-Z0-9/_\-.]/g, ' ').trim();
		if (q.length < 2) continue;
		const hits = await backend.ripgrep(q, { max: 8 });
		for (const h of hits) {
			let excerpt: string | undefined;
			try {
				const rel = h.path;
				const full = await backend.readFile(rel);
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

const PRD_IN_DRAFT_MAX = 8_000;
const PRD_IN_REFINE_MAX = 8_000;

export async function runDraft(
	utterance: string,
	intent: IntentOutput,
	rg: { path: string; line: number; text: string; excerpt?: string }[],
	sessionId: string
): Promise<DraftTicket | null> {
	const allowDraft =
		intent.category === 'ticket' ||
		intent.category === 'unclear' ||
		intent.category === 'prd_update';
	if (!allowDraft) return null;
	publish({ type: 'agent_trace', phase: 'draft', detail: 'Composing ticket', sessionId });
	const model = getChatModel();
	let prdExcerpt = '';
	try {
		const p = await readPrdForHub();
		if (p.trim()) {
			prdExcerpt =
				p.length > PRD_IN_DRAFT_MAX
					? `${p.slice(0, PRD_IN_DRAFT_MAX)}\n[... PRD truncated ...]`
					: p;
		}
	} catch {
		// draft still runs on code + utterance
	}
	const codeCtx = rg
		.map(
			(r) =>
				`### ${r.path}:${r.line}\n${r.text}\n` + (r.excerpt ? `Snippet:\n${r.excerpt}\n` : '')
		)
		.join('\n');
	const blocks = [
		`Utterance:\n${utterance}`,
		`Intent JSON:\n${JSON.stringify(intent)}`,
		prdExcerpt ? `Root PRD (PRD.md):\n${prdExcerpt}` : '',
		`Code / ripgrep context:\n${codeCtx || '(none)'}`
	].filter(Boolean);
	return invokeWithStructuredZod(model, DraftTicketSchema, [
		new SystemMessage(draftPrompt),
		new HumanMessage(blocks.join('\n\n'))
	]);
}

type PendingPrdPatch = { section: string; newBody: string };

export function persistDraft(
	db: AppDatabase,
	sessionId: string,
	d: DraftTicket,
	opts?: { pendingPrdPatch?: PendingPrdPatch | null }
) {
	const id = randomUUID();
	db.prepare(
		"INSERT INTO ticket_drafts (id, session_id, title, description, assignee_hint, state, prd_section, prd_body) VALUES (?,?,?,?,?,'pending',?,?)"
	).run(
		id,
		sessionId,
		d.title,
		d.description,
		d.assigneeHint ?? null,
		opts?.pendingPrdPatch?.section ?? null,
		opts?.pendingPrdPatch?.newBody ?? null
	);
	publish({ type: 'draft', id, title: d.title, state: 'pending' });
	return id;
}

/**
 * After explore: produce section + newBody using PRD + repo (rg) context, then apply.
 * Replaces first-pass `intent.prd` so updates are grounded in the codebase when hints exist.
 */
export async function runPrdPatchFromContext(
	utterance: string,
	intent: IntentOutput,
	rg: { path: string; line: number; text: string; excerpt?: string }[],
	sessionId: string,
	_db: AppDatabase
) {
	if (intent.category !== 'prd_update') return null;
	publish({ type: 'agent_trace', phase: 'prd_refine', detail: 'Composing PRD patch from repo context', sessionId });
	const model = getChatModel();
	let prdExcerpt = '';
	try {
		const p = await readPrdForHub();
		if (p.trim()) {
			prdExcerpt =
				p.length > PRD_IN_REFINE_MAX
					? `${p.slice(0, PRD_IN_REFINE_MAX)}\n[... PRD truncated ...]`
					: p;
		}
	} catch (e) {
		publish({
			type: 'agent_trace',
			phase: 'prd_refine',
			detail: `No PRD: ${(e as Error).message}`,
			sessionId
		});
		return null;
	}
	const codeCtx = rg
		.map(
			(r) =>
				`### ${r.path}:${r.line}\n${r.text}\n` + (r.excerpt ? `Snippet:\n${r.excerpt}\n` : '')
		)
		.join('\n');
	const firstPass = intent.prd
		? `First-pass suggestion (refine or replace using context):\n${JSON.stringify(intent.prd)}`
		: '';
	const blocks = [
		`Utterance:\n${utterance}`,
		`Intent (category prd_update):\n${JSON.stringify({ ...intent, prd: intent.prd ?? undefined })}`,
		`Current PRD (PRD.md):\n${prdExcerpt || '(empty)'}`,
		firstPass,
		`Code / ripgrep context:\n${codeCtx || '(none)'}`
	].filter(Boolean);
	const out = await invokeWithStructuredZod(model, PrdSectionPatchSchema, [
		new SystemMessage(prdRefinePrompt),
		new HumanMessage(blocks.join('\n\n'))
	]);
	publish({ type: 'prd_proposed', section: out.section, body: out.newBody });
	return out;
}

