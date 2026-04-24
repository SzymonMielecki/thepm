<script lang="ts">
	type Line = { speakerId: string | null; text: string; t: number };
	let {
		lines = [] as Line[],
		speakerNames = {} as Record<string, string>,
		frameless = false
	} = $props();

	function speakerLabel(speakerId: string | null) {
		if (!speakerId) return '•';
		const mapped = speakerNames[speakerId];
		return mapped ? `[${mapped}]` : `[${speakerId}]`;
	}
</script>

<div
	class="flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain rounded-lg bg-zinc-900/50 p-3 text-sm {frameless
		? ''
		: 'border border-zinc-800'}"
>
	{#each lines as l}
		<div class="rounded bg-zinc-800/50 px-2 py-1">
			<span class="text-zinc-500">{speakerLabel(l.speakerId)}</span>
			<span class="text-zinc-200">{l.text}</span>
		</div>
	{:else}
		<p class="text-zinc-600">Waiting for audio…</p>
	{/each}
</div>
