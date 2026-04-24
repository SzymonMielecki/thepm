import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db';
import { publish } from '../bus';
import {
	runIntentOnText,
	runIntentOnManualPrompt,
	runExplore,
	runDraft,
	persistDraft,
	runPrdPatchFromContext
} from './nodes';
import { getEnv } from '../config';
import { ensureCodeExploreReady } from './explore-preflight';
import { StateGraph, END, START, Annotation } from '@langchain/langgraph';

const State = Annotation.Root({
	utterance: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => '' }),
	sessionId: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => 'default' }),
	speakerId: Annotation<string | null>({ reducer: (_x, y) => y, default: () => null }),
	intentMode: Annotation<'default' | 'hub_manual'>({
		reducer: (x, y) => (y !== undefined ? y : x),
		default: () => 'default'
	}),
	intent: Annotation<import('./types').IntentOutput | null>({ reducer: (_x, y) => y, default: () => null }),
	rg: Annotation<
		{ path: string; line: number; text: string; excerpt?: string }[] | null
	>({ reducer: (_x, y) => y, default: () => null }),
	pendingPrdPatch: Annotation<{ section: string; newBody: string } | null>({
		reducer: (_x, y) => y,
		default: () => null
	}),
	draftId: Annotation<string | null>({ reducer: (_x, y) => y, default: () => null })
});

type S = (typeof State)['State'];
let _db: AppDatabase;

function db(): AppDatabase {
	if (!_db) throw new Error('PM graph: database not set');
	return _db;
}

/** Live meeting speech often misclassified as noise when phrased as a problem report, not an explicit "please fix". */
export function utteranceSuggestsTicketCue(utterance: string): boolean {
	const compact = utterance.toLowerCase().replace(/\s+/g, ' ');
	if (
		/\bno problem\b/.test(compact) ||
		/\bnot a problem\b/.test(compact) ||
		/\bit's not a problem\b/.test(compact) ||
		/\bits not a problem\b/.test(compact)
	) {
		return false;
	}
	const cues = [
		/\bbug\b/,
		/\bbroken\b/,
		/\bcrash(ed|es|ing)?\b/,
		/\berror\b/,
		/\bexception\b/,
		/\bdoesn'?t work\b/,
		/\bdoes not work\b/,
		/\bnot working\b/,
		/\bwon'?t (work|open|load|save|connect)\b/,
		/\bregression\b/,
		/\bfail(s|ed|ing)?\b/,
		/\bcan'?t\b/,
		/\bunable to\b/,
		/\bissue with\b/,
		/\bproblem with\b/,
		/\bsomething'?s wrong\b/,
		/\bwrong (data|number|value|count)\b/,
		/\bincorrect\b/,
		/\btoo slow\b/,
		/\bslow\b.*\b(load|page|screen|app)\b/,
		/\bglitch/,
		/\bconfus(ed|ing)\b/,
		/\bspin(s|ning)?\b/,
		/\bstuck (on|at|in|loading)\b/,
		/\bhangs?\b/,
		/\bcomplain/,
		/\bfix this\b/,
		/\bwe (need|should) to fix\b/,
		/\bfile a ticket\b/,
		/\btracking (a |an )?bug\b/
	];
	return cues.some((re) => re.test(compact));
}

async function nodeIntent(s: S): Promise<Partial<S>> {
	let intent =
		s.intentMode === 'hub_manual'
			? await runIntentOnManualPrompt(s.utterance, s.sessionId)
			: await runIntentOnText(s.utterance, s.sessionId);
	if (s.intentMode === 'hub_manual' && intent.category === 'noise') {
		intent = { category: 'ticket', fileHints: [], alsoCreateTicket: false };
	} else if (
		s.intentMode === 'default' &&
		intent.category === 'noise' &&
		utteranceSuggestsTicketCue(s.utterance)
	) {
		intent = { ...intent, category: 'unclear' };
	}
	return { intent };
}

function routeAfterIntent(s: S): 'noise' | 'explore' | 'draft' {
	const i = s.intent;
	if (!i || i.category === 'noise') return 'noise';
	if (i.category === 'prd_update') return 'explore';
	if (i.fileHints.length) return 'explore';
	if (i.category === 'ticket' || i.category === 'unclear') return 'draft';
	return 'noise';
}

async function nodeExplore(s: S): Promise<Partial<S>> {
	if (!s.intent) return { rg: [] };
	try {
		await ensureCodeExploreReady();
	} catch (e) {
		publish({
			type: 'agent_trace',
			phase: 'explore',
			detail: (e as Error).message,
			sessionId: s.sessionId
		});
		return { rg: [] };
	}
	try {
		const rg = await runExplore(s.intent, s.sessionId);
		return { rg };
	} catch (e) {
		publish({
			type: 'agent_trace',
			phase: 'explore',
			detail: (e as Error).message,
			sessionId: s.sessionId
		});
		return { rg: [] };
	}
}

async function nodeDraft(s: S): Promise<Partial<S>> {
	if (!s.intent) return {};
	const rg = s.rg ?? [];
	const d = await runDraft(s.utterance, s.intent, rg, s.sessionId, s.speakerId);
	if (!d) return {};
	const id = await persistDraft(db(), s.sessionId, d, {
		pendingPrdPatch: s.pendingPrdPatch,
		speakerId: s.speakerId
	});
	return { draftId: id };
}

async function nodePrd(s: S): Promise<Partial<S>> {
	if (!s.intent) return {};
	const rg = s.rg ?? [];
	const pendingPrdPatch = await runPrdPatchFromContext(s.utterance, s.intent, rg, s.sessionId);
	return { pendingPrdPatch };
}

async function nodeEnd(_s: S): Promise<Partial<S>> {
	return {};
}

let compiled: { invoke: (x: S) => Promise<S> } | null = null;

function compile(_database: AppDatabase) {
	_db = _database;
	const g: any = new StateGraph(State)
		.addNode('classify_intent' as any, nodeIntent)
		.addNode('explore' as any, nodeExplore)
		.addNode('draft' as any, nodeDraft)
		.addNode('prd' as any, nodePrd)
		.addNode('end' as any, nodeEnd);
	g.addEdge(START, 'classify_intent');
	g.addConditionalEdges('classify_intent' as any, (st: S) => routeAfterIntent(st), {
		noise: 'end' as any,
		explore: 'explore' as any,
		draft: 'draft' as any
	});
	g.addConditionalEdges(
		'explore' as any,
		(st: S) => (st.intent?.category === 'prd_update' ? 'prd' : 'draft'),
		{ prd: 'prd' as any, draft: 'draft' as any }
	);
	g.addEdge('draft' as any, 'end' as any);
	g.addConditionalEdges(
		'prd' as any,
		(_st: S) => 'draft',
		{ draft: 'draft' as any }
	);
	g.addEdge('end' as any, END);
	compiled = g.compile() as { invoke: (x: S) => Promise<S> };
}

/**
 * Main LangGraph entry.
 */
export async function runPmGraph(input: {
	db: AppDatabase;
	sessionId: string;
	utterance: string;
	speakerId: string | null;
	intentMode?: 'default' | 'hub_manual';
}) {
	const { db: database, sessionId, utterance, speakerId, intentMode = 'default' } = input;
	// preflight env
	getEnv();
	if (!compiled) compile(database);
	else _db = database;
	const out = await compiled!.invoke({
		utterance,
		sessionId,
		speakerId,
		intentMode,
		intent: null,
		rg: null,
		pendingPrdPatch: null,
		draftId: null
	} as S);
	return out;
}

export function newSessionId() {
	return randomUUID();
}

export function initAgent(_: { db: AppDatabase; prdPath: string; projectRoot: string }) {
	// no-op: DB bound per `runPmGraph`
	void _;
}
