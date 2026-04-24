<script lang="ts">
	type Trace = { phase: string; detail: string; t: number };
	let { traces = [] as Trace[], frameless = false } = $props();

	function formatTraceTime(t: number) {
		const d = new Date(t);
		if (Number.isNaN(d.getTime())) return '--:--:--';
		return d.toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hour12: false
		});
	}
</script>

<div
	class="h-full min-h-0 w-full overflow-y-auto rounded bg-zinc-900/30 p-2 font-mono text-xs text-zinc-500 {frameless
		? ''
		: 'border border-zinc-800'}"
>
	{#each traces as t}
		<div class="flex items-start gap-2">
			<div class="min-w-0 flex-1">
				<span class="text-blue-400">{t.phase}</span>
				<span class="px-1 text-zinc-700">·</span>
				{t.detail.slice(0, 300)}
			</div>
			<span class="shrink-0 text-zinc-600 tabular-nums">{formatTraceTime(t.t)}</span>
		</div>
	{:else}
		<div class="text-zinc-600">—</div>
	{/each}
</div>
