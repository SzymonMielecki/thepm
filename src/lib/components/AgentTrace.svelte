<script lang="ts">
	type Trace = { phase: string; detail: string; t: number };
	let { traces = [] as Trace[] } = $props();
</script>

<div class="h-32 overflow-y-auto rounded border border-zinc-800 bg-zinc-900/30 p-2 font-mono text-xs text-zinc-500">
	{#each traces as t}
		<div>
			<span class="text-blue-400">{t.phase}</span>
			{t.detail.slice(0, 300)}
		</div>
	{:else}
		<div class="text-zinc-600">—</div>
	{/each}
</div>
