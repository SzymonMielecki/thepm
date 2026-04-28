import { randomUUID } from 'node:crypto';
import { callBridge } from '../code-bridge/bridge-registry';
import type { MuxCapabilities } from '../code-bridge/mux/detect';
import { publish, type DelegationEvent } from '../bus';
import type { AppDatabase } from '../db';
import { getLinearIssueInConfiguredTeam } from '../linear';
import {
	getAgentMarkdownForDispatch,
	listMergedAgents,
	renderPromptTemplate,
	resolveDelegationTarget
} from './discovery';
import { getEffectiveTicketProjectRoot } from '../ticket-scope';

const BRIDGE_LONG_MS = 120_000;

export class MuxNotAvailableError extends Error {
	readonly code = 'MUX_NONE' as const;
	constructor(message: string) {
		super(message);
		this.name = 'MuxNotAvailableError';
	}
}

export type DelegateTarget = { kind: 'team'; name: string };

function slug(s: string) {
	return s.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'x';
}

/** Suffix for git branch names: `worktree remove` leaves branches behind, so names must be unique per delegation. */
function delegationBranchSuffix(delegationId: string) {
	return delegationId.replace(/-/g, '').slice(0, 12);
}

function keepWorktreePolicy(): 'always' | 'never' | 'on_failure' {
	const v = (process.env.THEPM_DELEGATION_KEEP_WORKTREE ?? 'on_failure').trim().toLowerCase();
	if (v === 'always' || v === 'never') return v;
	return 'on_failure';
}

function shouldRemoveWorktrees(policy: ReturnType<typeof keepWorktreePolicy>, hadFailure: boolean): boolean {
	if (policy === 'always') return false;
	if (policy === 'never') return true;
	return !hadFailure;
}

async function appendEvent(
	db: AppDatabase,
	delegationId: string,
	runId: string | null,
	phase: string,
	detail: string
) {
	await db.from('delegation_events').insert({
		delegation_id: delegationId,
		run_id: runId,
		phase,
		detail
	});
}

export async function delegateDraft(input: {
	db: AppDatabase;
	workspaceId: string;
	draftId: string;
	target: DelegateTarget;
}): Promise<{ delegationId: string; runIds: string[] }> {
	const { db, workspaceId, draftId, target } = input;
	const { data: draft, error: dErr } = await db
		.from('ticket_drafts')
		.select('*')
		.eq('id', draftId)
		.eq('project_root', getEffectiveTicketProjectRoot())
		.maybeSingle();
	if (dErr) throw new Error(dErr.message);
	if (!draft) throw new Error('draft not found');
	return startDelegationRun({
		db,
		workspaceId,
		target,
		draftId,
		linearIssueId: null,
		taskTitle: String((draft as { title?: string }).title ?? ''),
		taskDescription: String((draft as { description?: string }).description ?? '')
	});
}

/** Linear issue in the configured team; does not use hub ticket_drafts. */
export async function delegateLinearIssue(input: {
	db: AppDatabase;
	workspaceId: string;
	issueId: string;
	target: DelegateTarget;
}): Promise<{ delegationId: string; runIds: string[] }> {
	const issue = await getLinearIssueInConfiguredTeam(input.issueId, input.workspaceId);
	return startDelegationRun({
		db: input.db,
		workspaceId: input.workspaceId,
		target: input.target,
		draftId: null,
		linearIssueId: issue.id,
		taskTitle: issue.title,
		taskDescription: issue.description
	});
}

async function startDelegationRun(input: {
	db: AppDatabase;
	workspaceId: string;
	target: DelegateTarget;
	draftId: string | null;
	linearIssueId: string | null;
	taskTitle: string;
	taskDescription: string;
}): Promise<{ delegationId: string; runIds: string[] }> {
	const { db, workspaceId, target, draftId, linearIssueId, taskTitle, taskDescription } = input;

	const cap = (await callBridge(workspaceId, 'mux_capabilities', {})) as MuxCapabilities;
	// #region agent log
	void fetch('http://127.0.0.1:7428/ingest/65f24272-8316-4d58-a12d-8cd0e27b957f', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '3983a4' },
		body: JSON.stringify({
			sessionId: '3983a4',
			location: 'dispatch.ts:startDelegationRun:mux_capabilities',
			message: 'mux_cap_after_bridge',
			data: { hypothesisId: 'H1', flavor: cap.flavor, hasSession: !!cap.session },
			timestamp: Date.now(),
			runId: 'delegation-debug'
		})
	}).catch(() => {});
	// #endregion
	if (cap.flavor === 'none' || !cap.session) {
		throw new MuxNotAvailableError(
			'Multiplexer not detected on the bridge host: run `thepm bridge` where `tmux` can reach your session (tmux/cmux), or set THEPM_MUX_SESSION to the tmux session name.'
		);
	}

	const resolved = await resolveDelegationTarget(db, workspaceId, target);
	// #region agent log
	void fetch('http://127.0.0.1:7428/ingest/65f24272-8316-4d58-a12d-8cd0e27b957f', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '3983a4' },
		body: JSON.stringify({
			sessionId: '3983a4',
			location: 'dispatch.ts:startDelegationRun:resolve_ok',
			message: 'resolveDelegationTarget_ok',
			data: {
				hypothesisId: 'H4',
				targetName: target.name,
				dispatch: resolved.dispatch,
				agentCount: resolved.agentNames.length
			},
			timestamp: Date.now(),
			runId: 'delegation-debug'
		})
	}).catch(() => {});
	// #endregion
	const mergedAgents = await listMergedAgents(db, workspaceId);
	// #region agent log
	void fetch('http://127.0.0.1:7428/ingest/65f24272-8316-4d58-a12d-8cd0e27b957f', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '3983a4' },
		body: JSON.stringify({
			sessionId: '3983a4',
			location: 'dispatch.ts:startDelegationRun:merged_agents_ok',
			message: 'listMergedAgents_ok',
			data: { hypothesisId: 'H4', mergedCount: mergedAgents.length },
			timestamp: Date.now(),
			runId: 'delegation-debug'
		})
	}).catch(() => {});
	// #endregion
	const prompt = renderPromptTemplate(
		resolved.promptTemplate,
		{ title: taskTitle, description: taskDescription },
		''
	);

	const delegationId = randomUUID();
	const idForShort = draftId ?? linearIssueId ?? delegationId;
	const short = idForShort.replace(/-/g, '').slice(0, 8);
	const now = new Date().toISOString();

	const { error: insDelErr } = await db.from('delegations').insert({
		id: delegationId,
		draft_id: draftId,
		linear_issue_id: linearIssueId,
		target_kind: target.kind,
		target_name: target.name,
		dispatch_mode: resolved.dispatch,
		branch_base: 'HEAD',
		status: 'running',
		started_at: now,
		updated_at: now
	});
	if (insDelErr) {
		// #region agent log
		void fetch('http://127.0.0.1:7428/ingest/65f24272-8316-4d58-a12d-8cd0e27b957f', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '3983a4' },
			body: JSON.stringify({
				sessionId: '3983a4',
				location: 'dispatch.ts:startDelegationRun:delegations_insert',
				message: 'delegations_insert_failed',
				data: {
					hypothesisId: 'H3',
					err: (insDelErr as { message?: string }).message?.slice?.(0, 200)
				},
				timestamp: Date.now(),
				runId: 'delegation-debug'
			})
		}).catch(() => {});
		// #endregion
		throw new Error(insDelErr.message);
	}

	const runDefs: { id: string; agentName: string; position: number }[] = [];
	for (let i = 0; i < resolved.agentNames.length; i++) {
		const id = randomUUID();
		runDefs.push({ id, agentName: resolved.agentNames[i], position: i });
		const { error } = await db.from('delegation_runs').insert({
			id,
			delegation_id: delegationId,
			agent_name: resolved.agentNames[i],
			position: i,
			status: 'queued'
		});
		if (error) throw new Error(error.message);
	}

	await appendEvent(db, delegationId, null, 'started', `target=${target.kind}:${target.name}`);

	publish({
		type: 'delegation',
		id: delegationId,
		draftId: draftId ?? undefined,
		linearIssueId: linearIssueId ?? undefined,
		targetKind: target.kind,
		targetName: target.name,
		status: 'running'
	});

	void runDelegationLifecycle({
		db,
		workspaceId,
		delegationId,
		draftId,
		linearIssueId,
		target,
		cap,
		resolved,
		mergedAgents,
		prompt,
		short,
		runDefs
	}).catch((e) => {
		// eslint-disable-next-line no-console
		console.error('[thepm] delegation lifecycle error', e);
	});

	return { delegationId, runIds: runDefs.map((r) => r.id) };
}

async function runDelegationLifecycle(ctx: {
	db: AppDatabase;
	workspaceId: string;
	delegationId: string;
	draftId: string | null;
	linearIssueId: string | null;
	target: DelegateTarget;
	cap: MuxCapabilities;
	resolved: { dispatch: 'parallel' | 'sequential'; agentNames: string[]; promptTemplate: string };
	mergedAgents: import('./discovery').MergedAgent[];
	prompt: string;
	short: string;
	runDefs: { id: string; agentName: string; position: number }[];
}) {
	const {
		db,
		workspaceId,
		delegationId,
		draftId,
		linearIssueId,
		target,
		cap,
		resolved,
		mergedAgents,
		prompt,
		short,
		runDefs
	} = ctx;

	let hadFailure = false;
	const dBranch = delegationBranchSuffix(delegationId);

	try {
		const branchName = `thepm/${short}/team-${slug(target.name)}-${dBranch}`;
		const lead = runDefs[0];
		await dispatchAgentTeam({
			db,
			workspaceId,
			delegationId,
			runDefs,
			mergedAgents,
			prompt,
			branchName,
			tabName: `thepm:${short}:team-${slug(target.name)}-${dBranch}`,
			coordination: resolved.dispatch
		});
		await pollRun(
			db,
			workspaceId,
			delegationId,
			lead,
			runDefs.slice(1).map((r) => ({ id: r.id, agentName: r.agentName }))
		);

		await finalizeRuns(db, workspaceId, delegationId, runDefs, cap, hadFailure, {
			muxLeadRunId: runDefs[0].id
		});

		const fin = new Date().toISOString();
		await db
			.from('delegations')
			.update({
				status: hadFailure ? 'failed' : 'succeeded',
				finished_at: fin,
				updated_at: fin
			})
			.eq('id', delegationId);

		publish({
			type: 'delegation',
			id: delegationId,
			draftId: draftId ?? undefined,
			linearIssueId: linearIssueId ?? undefined,
			targetKind: target.kind,
			targetName: target.name,
			status: hadFailure ? 'failed' : 'succeeded'
		});
	} catch (e) {
		hadFailure = true;
		const msg = (e as Error).message;
		// #region agent log
		void fetch('http://127.0.0.1:7428/ingest/65f24272-8316-4d58-a12d-8cd0e27b957f', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '3983a4' },
			body: JSON.stringify({
				sessionId: '3983a4',
				location: 'dispatch.ts:runDelegationLifecycle:catch',
				message: 'delegation_lifecycle_throw',
				data: {
					hypothesisId: 'H6_lifecycle',
					msgPrefix: msg.slice(0, 220),
					notGit:
						msg.includes('not a git repository') ||
						msg.includes('--is-inside-work-tree')
				},
				timestamp: Date.now(),
				runId: 'delegation-debug'
			})
		}).catch(() => {});
		// #endregion
		await appendEvent(db, delegationId, null, 'error', msg);
		const fin = new Date().toISOString();
		await db
			.from('delegations')
			.update({ status: 'failed', summary: msg, finished_at: fin, updated_at: fin })
			.eq('id', delegationId);
		const summaryShort = msg.length > 2000 ? `${msg.slice(0, 2000)}…` : msg;
		publish({
			type: 'delegation',
			id: delegationId,
			draftId: draftId ?? undefined,
			linearIssueId: linearIssueId ?? undefined,
			targetKind: target.kind,
			targetName: target.name,
			status: 'failed',
			summary: summaryShort
		});
	}
}

async function getRunWorktree(db: AppDatabase, runId: string): Promise<string> {
	const { data } = await db.from('delegation_runs').select('worktree_path').eq('id', runId).maybeSingle();
	const p = (data as { worktree_path?: string } | null)?.worktree_path;
	return p ?? '';
}

async function dispatchAgentTeam(input: {
	db: AppDatabase;
	workspaceId: string;
	delegationId: string;
	runDefs: { id: string; agentName: string; position: number }[];
	mergedAgents: import('./discovery').MergedAgent[];
	prompt: string;
	branchName: string;
	tabName: string;
	coordination: 'parallel' | 'sequential';
}) {
	const { db, workspaceId, delegationId, runDefs, mergedAgents, prompt, branchName, tabName, coordination } =
		input;
	const leadId = runDefs[0].id;
	const teamAgentBodies: Record<string, string> = {};
	for (const rd of runDefs) {
		teamAgentBodies[rd.agentName] = getAgentMarkdownForDispatch(mergedAgents, rd.agentName);
	}
	const now = new Date().toISOString();
	for (const rd of runDefs) {
		await db.from('delegation_runs').update({ status: 'running', started_at: now }).eq('id', rd.id);
	}

	const out = (await callBridge(
		workspaceId,
		'mux_dispatch',
		{
			runId: leadId,
			workspaceId,
			agentTeamMode: true,
			teamMemberNames: runDefs.map((r) => r.agentName),
			teamCoordination: coordination,
			teamAgentBodies,
			prompt,
			branchBase: 'HEAD',
			branchName,
			tabName,
			agentName: '',
			agentBody: ''
		},
		BRIDGE_LONG_MS
	)) as {
		windowId: string;
		worktreePath: string;
		branchName: string;
	};

	for (const rd of runDefs) {
		await db
			.from('delegation_runs')
			.update({
				mux_window_id: out.windowId,
				worktree_path: out.worktreePath,
				branch_name: out.branchName
			})
			.eq('id', rd.id);
		await appendEvent(db, delegationId, rd.id, 'tab_opened', `${out.windowId} ${out.worktreePath}`);
		publish({
			type: 'delegation_status',
			delegationId,
			runId: rd.id,
			agentName: rd.agentName,
			windowId: out.windowId,
			branchName: out.branchName,
			worktreePath: out.worktreePath,
			status: 'running'
		});
	}
}

/** @returns false if run failed / dead unexpectedly */
async function pollRun(
	db: AppDatabase,
	workspaceId: string,
	delegationId: string,
	rd: { id: string; agentName: string },
	mirrorFinished?: { id: string; agentName: string }[]
): Promise<boolean> {
	for (;;) {
		await new Promise((r) => setTimeout(r, 3000));
		let rows: { runId: string; alive: boolean; exitCode: number | null }[] = [];
		try {
			rows = (await callBridge(workspaceId, 'mux_status', { runIds: [rd.id] })) as typeof rows;
		} catch {
			continue;
		}
		const alive = rows[0]?.alive ?? false;
		publish({
			type: 'delegation_status',
			delegationId,
			runId: rd.id,
			agentName: rd.agentName,
			status: alive ? 'running' : 'succeeded',
			exitCode: rows[0]?.exitCode ?? undefined
		});
		if (!alive) {
			const fin = new Date().toISOString();
			const exitCode = rows[0]?.exitCode ?? 0;
			const toFinish = [{ id: rd.id, agentName: rd.agentName }, ...(mirrorFinished ?? [])];
			for (const x of toFinish) {
				await db
					.from('delegation_runs')
					.update({
						status: 'succeeded',
						exit_code: exitCode,
						finished_at: fin
					})
					.eq('id', x.id);
				publish({
					type: 'delegation_status',
					delegationId,
					runId: x.id,
					agentName: x.agentName,
					status: 'succeeded',
					exitCode
				});
			}
			return true;
		}
	}
}

async function finalizeRuns(
	db: AppDatabase,
	workspaceId: string,
	delegationId: string,
	runDefs: { id: string; agentName: string }[],
	cap: MuxCapabilities,
	hadFailure: boolean,
	opts?: { muxLeadRunId?: string }
) {
	const policy = keepWorktreePolicy();
	const removeWt = shouldRemoveWorktrees(policy, hadFailure);
	const summaries: string[] = [];

	const cancelIds =
		opts?.muxLeadRunId != null ? [opts.muxLeadRunId] : runDefs.map((r) => r.id);
	for (const rid of cancelIds) {
		try {
			const { diffStat } = (await callBridge(workspaceId, 'mux_cancel', { runId: rid })) as {
				diffStat: string;
			};
			if (diffStat) {
				if (opts?.muxLeadRunId != null && rid === opts.muxLeadRunId) {
					summaries.push(diffStat);
				} else if (!opts?.muxLeadRunId) {
					const rd = runDefs.find((r) => r.id === rid);
					if (rd) summaries.push(`${rd.agentName}: ${diffStat}`);
				}
			}
			const rd = runDefs.find((r) => r.id === rid);
			if (rd) await appendEvent(db, delegationId, rd.id, 'finalized', diffStat?.slice(0, 500) ?? '');
		} catch {
			/* ignore */
		}
	}

	const paths = new Set<string>();
	for (const rd of runDefs) {
		const p = await getRunWorktree(db, rd.id);
		if (p) paths.add(p);
	}

	if (removeWt) {
		for (const p of paths) {
			try {
				await callBridge(workspaceId, 'mux_remove_worktree', { path: p });
			} catch {
				/* ignore */
			}
		}
	}

	const summary = summaries.join('\n---\n');
	await db.from('delegations').update({ summary, updated_at: new Date().toISOString() }).eq('id', delegationId);

	if (cap.flavor === 'cmux' && summary) {
		try {
			await callBridge(workspaceId, 'mux_notify', {
				title: 'thepm delegation',
				body: summary.slice(0, 500)
			});
		} catch {
			/* optional */
		}
	}
}

/** Hub can call to read mux without delegating */
export async function fetchMuxCapabilities(workspaceId: string): Promise<MuxCapabilities> {
	return (await callBridge(workspaceId, 'mux_capabilities', {})) as MuxCapabilities;
}

export async function cancelDelegation(
	db: AppDatabase,
	workspaceId: string,
	delegationId: string
): Promise<void> {
	const { data: meta } = await db
		.from('delegations')
		.select('draft_id,linear_issue_id,target_kind,target_name')
		.eq('id', delegationId)
		.maybeSingle();
	const { data: runs, error } = await db.from('delegation_runs').select('id').eq('delegation_id', delegationId);
	if (error) throw new Error(error.message);
	for (const r of (runs ?? []) as { id: string }[]) {
		try {
			await callBridge(workspaceId, 'mux_cancel', { runId: r.id });
		} catch {
			/* ignore */
		}
	}
	const fin = new Date().toISOString();
	await db
		.from('delegations')
		.update({ status: 'cancelled', finished_at: fin, updated_at: fin })
		.eq('id', delegationId);
	const m = meta as {
		draft_id?: string | null;
		linear_issue_id?: string | null;
		target_kind?: string;
		target_name?: string;
	} | null;
	if (m?.target_kind && m?.target_name) {
		publish({
			type: 'delegation',
			id: delegationId,
			draftId: m.draft_id ?? undefined,
			linearIssueId: m.linear_issue_id ?? undefined,
			targetKind: m.target_kind as DelegationEvent['targetKind'],
			targetName: m.target_name,
			status: 'cancelled'
		});
	}
}
