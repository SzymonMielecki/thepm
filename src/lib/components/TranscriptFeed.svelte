<script lang="ts">
	type Line = { speakerId: string | null; text: string; t: number };
	let { lines = [] as Line[] } = $props();
</script>

<div class="flex min-h-0 h-full max-h-full flex-col gap-1 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm">
	<h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Transcript</h2>
	{#each lines as l}
		<div class="rounded bg-zinc-800/50 px-2 py-1">
			<span class="text-zinc-500">{l.speakerId ? `[${l.speakerId}]` : '•'}</span>
			<span class="text-zinc-200">{l.text}</span>
		</div>
	{:else}
		<p class="text-zinc-600">Waiting for audio…</p>
	{/each}
</div>
