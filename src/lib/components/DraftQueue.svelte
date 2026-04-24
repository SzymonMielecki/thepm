<script lang="ts">
	type Draft = {
		id: string;
		title: string;
		description: string;
		state: string;
	};
	let {
		drafts = [] as Draft[],
		token = '',
		onupdate = () => {},
		ontoast = (_kind: 'success' | 'error', _message: string) => {}
	} = $props();

	async function approve(id: string) {
		const r = await fetch(`/api/tickets/${id}/approve`, {
			method: 'POST',
			headers: { Authorization: token ? `Bearer ${token}` : '' }
		});
		if (r.ok) {
			const payload = (await r.json()) as { prdApplied?: boolean; prdError?: string | null };
			await onupdate();
			if (payload.prdError) {
				ontoast('error', `Draft approved, but PRD update failed: ${payload.prdError}`);
				return;
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
</script>

<div class="flex min-h-0 h-full max-h-full flex-col gap-2 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
	<h2 class="text-xs font-semibold uppercase tracking-wider text-zinc-500">Ticket drafts</h2>
	{#each drafts as d}
		<article class="space-y-2 rounded border border-zinc-800 bg-zinc-950 p-3">
			<header class="font-medium text-zinc-100">{d.title}</header>
			<pre class="max-h-40 overflow-auto text-xs text-zinc-400 whitespace-pre-wrap font-sans">{d.description}</pre>
			<div class="flex flex-wrap items-center gap-2">
				<span
					class="rounded px-1.5 py-0.5 text-xs {d.state === 'pending'
						? 'bg-amber-500/20 text-amber-300'
						: d.state === 'approved'
							? 'bg-emerald-500/20 text-emerald-300'
							: 'bg-zinc-700 text-zinc-400'}"
					>{d.state}</span
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
			</div>
		</article>
	{:else}
		<p class="text-sm text-zinc-600">No drafts yet.</p>
	{/each}
</div>
