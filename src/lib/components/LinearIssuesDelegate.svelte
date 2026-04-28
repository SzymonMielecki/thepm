<script lang="ts">
	import { responseErrorMessage } from '$lib/client/http-error-text';

	type TeamRow = { source: string; name: string; shadowed?: boolean; dispatch?: string };
	type IssueRow = {
		id: string;
		identifier: string;
		title: string;
		url: string;
		priority: number;
		priorityLabel: string;
		assigneeId: string | null;
		assigneeName: string | null;
		stateId: string | null;
		stateName: string | null;
		stateType: string | null;
	};
	type WfState = { id: string; name: string; type: string; position: number };
	type LinearUser = { id: string; name: string; email: string };

	const PRIORITY_OPTIONS: { v: string; label: string }[] = [
		{ v: '', label: 'Any priority' },
		{ v: '0', label: 'No priority' },
		{ v: '1', label: 'Urgent' },
		{ v: '2', label: 'High' },
		{ v: '3', label: 'Normal' },
		{ v: '4', label: 'Low' }
	];

	let {
		token = '',
		linearConfigured = false,
		ontoast = (_kind: 'success' | 'error' | 'info', _message: string) => {},
		frameless = false,
		delegateMuxOk = false,
		/** When false, mux warning is hidden and a loader is shown (agents page during `/api/agents` mux probe). Default true = treat mux as known. */
		muxReady = true,
		bridgeConnected = false,
		autoRefreshOnMount = false
	} = $props();

	let issues = $state<IssueRow[]>([]);
	let issuesLoading = $state(false);
	let issuesError = $state('');
	let cursor = $state<string | null>(null);
	let hasMore = $state(false);

	/** Form values (search applies on button / Enter) */
	let filterQDraft = $state('');
	let filterStateId = $state('');
	let filterAssigneeId = $state('');
	let filterPriority = $state('');
	let filterQApplied = $state('');

	let wfStates = $state<WfState[]>([]);
	let linearUsers = $state<LinearUser[]>([]);
	let metaLoading = $state(false);

	let delegateModalOpen = $state(false);
	let delegateIssueId = $state<string | null>(null);
	let delegateIssueLabel = $state('');
	let delegateLoading = $state(false);
	let delegateTeams = $state<TeamRow[]>([]);
	let delegatePick = $state('');

	function authHeader(): Record<string, string> {
		return { Authorization: token ? `Bearer ${token}` : '' };
	}

	function buildQuery(extra: { after?: string | null } = {}): string {
		const p = new URLSearchParams();
		p.set('first', '50');
		if (extra.after) p.set('after', extra.after);
		if (filterStateId.trim()) p.set('stateId', filterStateId.trim());
		if (filterAssigneeId === '__unassigned__') p.set('assigneeId', '__unassigned__');
		else if (filterAssigneeId.trim()) p.set('assigneeId', filterAssigneeId.trim());
		if (filterPriority !== '' && filterPriority !== 'any') p.set('priority', filterPriority);
		if (filterQApplied.trim()) p.set('q', filterQApplied.trim());
		return p.toString();
	}

	async function loadFilterMeta() {
		if (!token.trim() || !linearConfigured) return;
		metaLoading = true;
		try {
			const [rStates, rUsers] = await Promise.all([
				fetch('/api/linear/states', { headers: authHeader() }),
				fetch('/api/linear/users', { headers: authHeader() })
			]);
			if (rStates.ok) {
				const j = (await rStates.json()) as { states: WfState[] };
				wfStates = j.states ?? [];
			}
			if (rUsers.ok) {
				const j = (await rUsers.json()) as { users: LinearUser[] };
				linearUsers = j.users ?? [];
			}
		} finally {
			metaLoading = false;
		}
	}

	function stateTypeClass(t: string | null | undefined): string {
		const x = (t ?? '').toLowerCase();
		if (x === 'completed') return 'bg-emerald-500/20 text-emerald-200 ring-emerald-500/30';
		if (x === 'canceled' || x === 'cancelled') return 'bg-rose-500/15 text-rose-200 ring-rose-500/30';
		if (x === 'started') return 'bg-sky-500/15 text-sky-200 ring-sky-500/30';
		if (x === 'unstarted' || x === 'backlog') return 'bg-zinc-500/20 text-zinc-300 ring-zinc-600/40';
		if (x === 'triage') return 'bg-amber-500/15 text-amber-200 ring-amber-500/30';
		return 'bg-violet-500/15 text-violet-200 ring-violet-500/30';
	}

	let filterControlsDisabled = $derived(metaLoading || issuesLoading);

	async function refreshIssues() {
		if (!token.trim() || !linearConfigured) return;
		issuesLoading = true;
		issuesError = '';
		cursor = null;
		try {
			const r = await fetch(`/api/linear/issues?${buildQuery()}`, { headers: authHeader() });
			if (!r.ok) {
				issuesError = await r.text();
				issues = [];
				return;
			}
			const j = (await r.json()) as {
				issues: IssueRow[];
				endCursor: string | null;
				hasNextPage: boolean;
			};
			issues = j.issues ?? [];
			cursor = j.endCursor;
			hasMore = j.hasNextPage ?? false;
		} catch (e) {
			issuesError = (e as Error).message;
			issues = [];
		} finally {
			issuesLoading = false;
		}
	}

	function applySearchAndRefresh() {
		filterQApplied = filterQDraft;
		void refreshIssues();
	}

	function clearFilters() {
		filterQDraft = '';
		filterQApplied = '';
		filterStateId = '';
		filterAssigneeId = '';
		filterPriority = '';
		void refreshIssues();
	}

	$effect(() => {
		if (token.trim() && linearConfigured) {
			void loadFilterMeta();
		}
	});

	$effect(() => {
		if (!autoRefreshOnMount) return;
		if (!token.trim() || !linearConfigured) return;
		void refreshIssues();
	});

	async function loadMore() {
		if (!token.trim() || !linearConfigured || !cursor || issuesLoading) return;
		issuesLoading = true;
		try {
			const r = await fetch(`/api/linear/issues?${buildQuery({ after: cursor })}`, {
				headers: authHeader()
			});
			if (!r.ok) return;
			const j = (await r.json()) as {
				issues: IssueRow[];
				endCursor: string | null;
				hasNextPage: boolean;
			};
			issues = [...issues, ...(j.issues ?? [])];
			cursor = j.endCursor;
			hasMore = j.hasNextPage ?? false;
		} finally {
			issuesLoading = false;
		}
	}

	async function openDelegateModal(issue: IssueRow) {
		delegateIssueId = issue.id;
		delegateIssueLabel = `${issue.identifier}: ${issue.title}`;
		delegatePick = '';
		delegateModalOpen = true;
		delegateLoading = true;
		try {
			const r = await fetch('/api/agents', { headers: authHeader() });
			if (r.ok) {
				const j = (await r.json()) as { teams: TeamRow[] };
				delegateTeams = j.teams ?? [];
			}
		} finally {
			delegateLoading = false;
		}
	}

	async function submitDelegate() {
		const id = delegateIssueId;
		const name = delegatePick.trim();
		if (!id || !name || delegateLoading) return;
		delegateLoading = true;
		try {
			const r = await fetch('/api/linear/issues/delegate', {
				method: 'POST',
				headers: { 'content-type': 'application/json', ...authHeader() },
				body: JSON.stringify({ issueId: id, target: { kind: 'team' as const, name } })
			});
			if (r.status === 412) {
				const t = await r.text();
				ontoast('error', t || 'Mux not available on bridge.');
				return;
			}
			if (r.status === 403) {
				const t = await r.text();
				ontoast('error', t || 'Issue not in configured team.');
				return;
			}
			if (!r.ok) {
				const detail = await responseErrorMessage(r);
				// #region agent log
				void fetch('http://127.0.0.1:7428/ingest/65f24272-8316-4d58-a12d-8cd0e27b957f', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '3983a4' },
					body: JSON.stringify({
						sessionId: '3983a4',
						location: 'LinearIssuesDelegate.svelte:submitDelegate',
						message: 'delegate_http_error',
						data: {
							hypothesisId: 'H5',
							status: r.status,
							detailPrefix: detail.slice(0, 120)
						},
						timestamp: Date.now(),
						runId: 'delegation-debug'
					})
				}).catch(() => {});
				// #endregion
				ontoast('error', detail || `Delegate failed (${r.status}).`);
				return;
			}
			const j = (await r.json()) as { delegationId?: string };
			delegateModalOpen = false;
			ontoast('success', 'Delegation started on the bridge host.');
			if (j.delegationId) {
				ontoast('info', `Delegation ${j.delegationId.slice(0, 8)}…`);
			}
		} finally {
			delegateLoading = false;
		}
	}

	let delegateWarn = $derived(
		!linearConfigured
			? 'Configure LINEAR_API_KEY and LINEAR_TEAM_ID (or bridge flags) to list team issues.'
			: !token.trim() || !bridgeConnected
				? 'Connect the code bridge and set a token to delegate.'
				: !muxReady
					? ''
					: !delegateMuxOk
						? 'Mux not detected on bridge — run the bridge from `cmux claude-teams` (or set CMUX_SOCKET_PATH), or set THEPM_TMUX_BIN to ~/.cmuxterm/claude-teams-bin/tmux, or THEPM_MUX_SESSION.'
						: ''
	);

	let muxProbePending = $derived(
		!!token.trim() && linearConfigured && bridgeConnected && !muxReady
	);
</script>

<div
	class="mt-3 flex h-full min-h-0 min-w-0 w-full max-w-full flex-1 flex-col gap-2 rounded-lg bg-zinc-900/40 p-3 {frameless
		? ''
		: 'border border-zinc-800/80'}"
>
	<div class="shrink-0 space-y-2">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h3 class="text-xs font-semibold uppercase tracking-wide text-zinc-500">Linear team issues</h3>
			<div class="flex flex-wrap items-center gap-1.5">
				<button
					type="button"
					class="rounded border border-zinc-600 px-2 py-0.5 text-xs text-zinc-300 disabled:opacity-40"
					disabled={!token.trim() || !linearConfigured || issuesLoading}
					onclick={() => void refreshIssues()}>Refresh</button
				>
			</div>
		</div>

		{#if token.trim() && linearConfigured}
			<div class="space-y-1.5">
				<div class="flex flex-wrap items-end gap-1.5">
					<label class="min-w-32 flex-1 sm:min-w-40">
						<span class="mb-0.5 block text-[10px] font-medium text-zinc-500">Search title</span>
						<input
							type="search"
							class="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
							placeholder="Keyword…"
							bind:value={filterQDraft}
							disabled={filterControlsDisabled}
							onkeydown={(e) => e.key === 'Enter' && applySearchAndRefresh()}
						/>
					</label>
					<button
						type="button"
						class="shrink-0 rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-100 disabled:opacity-40"
						disabled={filterControlsDisabled}
						onclick={applySearchAndRefresh}
						>{issuesLoading ? 'Applying…' : 'Apply'}</button
					>
				</div>
				<div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
					<label>
						<span class="mb-0.5 block text-[10px] font-medium text-zinc-500">Status</span>
						<select
							class="w-full rounded border border-zinc-700 bg-zinc-950 py-1 pl-1.5 pr-2 text-xs text-zinc-100"
							bind:value={filterStateId}
							disabled={filterControlsDisabled}
							onchange={() => void refreshIssues()}
						>
							<option value="">All states</option>
							{#each wfStates as s}
								<option value={s.id}>{s.name}</option>
							{/each}
						</select>
					</label>
					<label>
						<span class="mb-0.5 block text-[10px] font-medium text-zinc-500">Assignee</span>
						<select
							class="w-full rounded border border-zinc-700 bg-zinc-950 py-1 pl-1.5 pr-2 text-xs text-zinc-100"
							bind:value={filterAssigneeId}
							disabled={filterControlsDisabled}
							onchange={() => void refreshIssues()}
						>
							<option value="">Anyone</option>
							<option value="__unassigned__">Unassigned</option>
							{#each linearUsers as u}
								<option value={u.id}>{u.name}</option>
							{/each}
						</select>
					</label>
					<label>
						<span class="mb-0.5 block text-[10px] font-medium text-zinc-500">Priority</span>
						<select
							class="w-full rounded border border-zinc-700 bg-zinc-950 py-1 pl-1.5 pr-2 text-xs text-zinc-100"
							bind:value={filterPriority}
							disabled={filterControlsDisabled}
							onchange={() => void refreshIssues()}
						>
							{#each PRIORITY_OPTIONS as opt}
								<option value={opt.v}>{opt.label}</option>
							{/each}
						</select>
					</label>
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<button
						type="button"
						class="text-[10px] text-zinc-500 underline hover:text-zinc-300 disabled:opacity-40"
						disabled={filterControlsDisabled}
						onclick={clearFilters}>Clear filters</button
					>
				</div>
			</div>
		{/if}
	</div>

	{#if muxProbePending}
		<p class="inline-flex shrink-0 items-center gap-2 text-xs text-zinc-400" role="status" aria-live="polite">
			<span
				class="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300"
				aria-hidden="true"
			></span>
			Detecting multiplexer…
		</p>
	{:else if delegateWarn}
		<p class="shrink-0 text-xs text-amber-200/90">{delegateWarn}</p>
	{/if}
	{#if issuesError}
		<p class="shrink-0 text-xs text-rose-300/90">{issuesError}</p>
	{/if}

	<div
		class="min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch] pr-0.5"
	>
		{#if issuesLoading && issues.length === 0}
			<p class="text-xs text-zinc-500">Loading issues…</p>
		{:else if !linearConfigured}
			<p class="text-xs text-zinc-600">Linear not configured.</p>
		{:else if issues.length === 0}
			<p class="text-xs text-zinc-600">No issues match. Adjust filters or load the backlog.</p>
		{:else}
			<div class="relative min-h-0">
				{#if issuesLoading}
					<div
						class="pointer-events-none sticky top-0 z-10 mb-2 rounded border border-sky-500/30 bg-sky-950/90 px-2 py-1 text-center text-[10px] text-sky-200"
						aria-live="polite"
					>
						Updating list…
					</div>
				{/if}
				<ul class="space-y-2 text-xs {issuesLoading ? 'opacity-60' : ''}">
				{#each issues as issue}
					<li
						class="flex flex-col gap-1.5 rounded border border-zinc-800/80 bg-zinc-950/80 p-2 sm:flex-row sm:items-start sm:justify-between"
					>
						<div class="min-w-0 flex-1">
							<div>
								<a
									href={issue.url}
									target="_blank"
									rel="noopener noreferrer"
									class="font-medium text-emerald-400/90 underline decoration-emerald-600/40 hover:decoration-emerald-300"
									>{issue.identifier}</a
								>
								<span class="text-zinc-100"> {issue.title}</span>
							</div>
							<div class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
								{#if issue.stateName}
									<span
										class="inline-flex max-w-full rounded px-1.5 py-0.5 ring-1 {stateTypeClass(
											issue.stateType
										)}"
									>
										{issue.stateName}
									</span>
								{:else}
									<span class="text-zinc-600">—</span>
								{/if}
								<span
									class="inline-flex rounded bg-zinc-800/80 px-1.5 py-0.5 text-zinc-300 ring-1 ring-zinc-700/80"
									>prio: {issue.priorityLabel || String(issue.priority)}</span
								>
								<span class="text-zinc-500">
									{issue.assigneeName?.trim() ? issue.assigneeName : 'Unassigned'}
								</span>
							</div>
						</div>
						<button
							type="button"
							class="shrink-0 self-end rounded border border-violet-600/60 bg-violet-950/40 px-2 py-0.5 text-violet-200 sm:self-start disabled:opacity-40"
							disabled={!token.trim() || delegateLoading}
							onclick={() => void openDelegateModal(issue)}>Delegate</button
						>
					</li>
				{/each}
				</ul>
			</div>
		{/if}
		{#if hasMore && issues.length > 0}
			<div class="pt-2">
				<button
					type="button"
					class="text-xs text-zinc-500 underline hover:text-zinc-300"
					disabled={issuesLoading}
					onclick={() => void loadMore()}>{issuesLoading ? 'Loading…' : 'Load more'}</button
				>
			</div>
		{/if}
	</div>
</div>

{#if delegateModalOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
		<div class="w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-900 p-4">
			<h2 class="text-sm font-semibold text-zinc-100">Delegate Linear issue (agent team)</h2>
			<p class="mt-1 line-clamp-3 text-xs text-zinc-500">{delegateIssueLabel}</p>
			<p class="mt-1 text-xs text-zinc-500">
				Opens one Claude Code lead session on the bridge; the lead spawns teammates from the team’s roles
				(tmux / cmux panes).
			</p>
			{#if delegateLoading}
				<p class="mt-3 text-xs text-zinc-500">Loading teams…</p>
			{:else}
				<select
					class="mt-3 w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-100"
					bind:value={delegatePick}
				>
					<option value="">— pick team —</option>
					{#each delegateTeams.filter((t) => !t.shadowed) as t}
						<option value={t.name}>[{t.source}] {t.name} ({t.dispatch})</option>
					{/each}
				</select>
			{/if}
			<div class="mt-4 flex justify-end gap-2">
				<button
					type="button"
					class="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-300"
					onclick={() => {
						delegateModalOpen = false;
					}}>Cancel</button
				>
				<button
					type="button"
					class="rounded bg-violet-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
					disabled={delegateLoading || !delegatePick.trim()}
					onclick={() => void submitDelegate()}>Delegate</button
				>
			</div>
		</div>
	</div>
{/if}
