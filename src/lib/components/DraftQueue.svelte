<script lang="ts">
	type Draft = {
		id: string;
		title: string;
		description: string;
		state: string;
		assigneeHint?: string | null;
		assigneeUserId?: string | null;
		linearIdentifier?: string | null;
		linearUrl?: string | null;
	};
	type TeamRow = { source: string; name: string; shadowed?: boolean; dispatch?: string };
	let {
		drafts = [] as Draft[],
		token = '',
		onupdate = () => {},
		ontoast = (_kind: 'success' | 'error' | 'info', _message: string) => {},
		frameless = false,
		delegateMuxOk = false,
		bridgeConnected = false
	} = $props();

	let delegateModalOpen = $state(false);
	let delegateDraftId = $state<string | null>(null);
	let delegateLoading = $state(false);
	let delegateTeams = $state<TeamRow[]>([]);
	let delegatePick = $state('');

	function authHeader(): Record<string, string> {
		return { Authorization: token ? `Bearer ${token}` : '' };
	}

	async function approve(id: string) {
		const r = await fetch(`/api/tickets/${id}/approve`, {
			method: 'POST',
			headers: { Authorization: token ? `Bearer ${token}` : '' }
		});
		if (r.ok) {
			const payload = (await r.json()) as {
				prdApplied?: boolean;
				prdError?: string | null;
				delegationId?: string;
				delegationError?: string;
			};
			await onupdate();
			if (payload.prdError) {
				ontoast('error', `Draft approved, but PRD update failed: ${payload.prdError}`);
				return;
			}
			if (payload.delegationError) {
				ontoast('error', `Delegation: ${payload.delegationError}`);
			} else if (payload.delegationId) {
				ontoast(
					'info',
					`Delegation started (${payload.delegationId.slice(0, 8)}…). Check your tmux/cmux tab.`
				);
			}
			ontoast(
				'success',
				payload.prdApplied
					? 'Draft approved, sent to Linear, and PRD updated.'
					: 'Draft approved and sent to Linear.'
			);
			return;
		}
		ontoast('error', `Approve failed (${r.status}).`);
	}

	async function reject(id: string) {
		const r = await fetch(`/api/tickets/${id}/reject`, {
			method: 'POST',
			headers: { Authorization: token ? `Bearer ${token}` : '' }
		});
		if (r.ok) {
			await onupdate();
			ontoast('success', 'Draft rejected.');
			return;
		}
		ontoast('error', `Reject failed (${r.status}).`);
	}

	async function openDelegateModal(draftId: string) {
		delegateDraftId = draftId;
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
		const id = delegateDraftId;
		const name = delegatePick.trim();
		if (!id || !name || delegateLoading) return;
		delegateLoading = true;
		try {
			const r = await fetch(`/api/tickets/${id}/delegate`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', ...authHeader() },
				body: JSON.stringify({ target: { kind: 'team' as const, name } })
			});
			if (r.status === 412) {
				const t = await r.text();
				ontoast('error', t || 'Mux not available on bridge.');
				return;
			}
			if (!r.ok) {
				ontoast('error', `Delegate failed (${r.status}).`);
				return;
			}
			const j = (await r.json()) as { delegationId?: string };
			delegateModalOpen = false;
			ontoast('success', 'Delegation started on the bridge host.');
			if (j.delegationId) {
				ontoast('info', `Delegation ${j.delegationId.slice(0, 8)}…`);
			}
			await onupdate();
		} finally {
			delegateLoading = false;
		}
	}

	let delegateWarn = $derived(
		!token.trim() || !bridgeConnected
			? 'Connect the code bridge and set a token to delegate.'
			: !delegateMuxOk
				? 'Mux not detected on bridge — run the bridge from `cmux claude-teams` (or set CMUX_SOCKET_PATH), or set THEPM_TMUX_BIN to ~/.cmuxterm/claude-teams-bin/tmux, or THEPM_MUX_SESSION.'
				: ''
	);
</script>

<div
	class="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain rounded-lg bg-zinc-900/50 p-3 {frameless
		? ''
		: 'border border-zinc-800'}"
>
	{#if delegateWarn}
		<p class="text-xs text-amber-200/90">{delegateWarn}</p>
	{/if}
	{#each drafts as d}
		{@const approvedLabel =
			d.state === 'approved' && d.linearIdentifier?.trim()
				? d.linearIdentifier.trim()
				: d.state}
		<article class="space-y-2 rounded border border-zinc-800 bg-zinc-950 p-3">
			<header class="font-medium text-zinc-100">{d.title}</header>
			<pre class="max-h-40 overflow-auto text-xs text-zinc-400 whitespace-pre-wrap font-sans">{d.description}</pre>
			{#if d.assigneeHint}
				<p class="text-xs text-zinc-500">Assignee: {d.assigneeHint}</p>
			{/if}
			<div class="flex flex-wrap items-center gap-2">
				<span
					class="rounded px-1.5 py-0.5 text-xs {d.state === 'pending'
						? 'bg-amber-500/20 text-amber-300'
						: d.state === 'approved'
							? 'bg-emerald-500/20 text-emerald-300'
							: 'bg-zinc-700 text-zinc-400'}"
					>{#if d.state === 'approved' && d.linearUrl?.trim()}
						<a
							href={d.linearUrl.trim()}
							target="_blank"
							rel="noopener noreferrer"
							class="font-medium underline decoration-emerald-500/50 hover:decoration-emerald-300"
							>{approvedLabel}</a
						>
					{:else}
						{approvedLabel}
					{/if}</span
				>
				{#if d.state === 'pending'}
					<button
						type="button"
						class="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500"
						onclick={() => approve(d.id)}>Approve (Linear)</button
					>
					<button
						type="button"
						class="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-300"
						onclick={() => reject(d.id)}>Reject</button
					>
				{/if}
				{#if d.state === 'pending' || d.state === 'approved'}
					<button
						type="button"
						class="rounded border border-violet-600/60 bg-violet-950/40 px-2 py-1 text-xs text-violet-200 disabled:opacity-40"
						disabled={!token.trim() || delegateLoading}
						title="Pick a team (Claude Code agent teams) on the bridge"
						onclick={() => void openDelegateModal(d.id)}>Delegate</button
					>
				{/if}
			</div>
		</article>
	{:else}
		<p class="text-sm text-zinc-600">No drafts yet.</p>
	{/each}
</div>

{#if delegateModalOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
		<div class="w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-900 p-4">
			<h2 class="text-sm font-semibold text-zinc-100">Delegate draft (agent team)</h2>
			<p class="mt-1 text-xs text-zinc-500">
				Opens one Claude Code lead session on the bridge; the lead spawns teammates from the team’s
				roles (tmux / cmux split panes).
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
