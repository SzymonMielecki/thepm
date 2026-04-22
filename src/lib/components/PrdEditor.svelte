<script lang="ts">
	import { marked } from 'marked';
	let { content = $bindable(''), proposed = $bindable('') } = $props();
	const html = $derived(marked.parse(content || '') as string);
</script>

<div class="grid h-full min-h-0 grid-cols-1 gap-2 lg:grid-cols-2">
	<div class="flex min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-800">
		<div class="border-b border-zinc-800 px-2 py-1.5 text-xs text-zinc-500">Source (PRD.md)</div>
		<textarea
			class="min-h-[200px] flex-1 resize-none bg-zinc-950 p-2 font-mono text-xs text-zinc-200 outline-none"
			bind:value={content}></textarea>
	</div>
	<div class="min-h-0 overflow-y-auto rounded-lg border border-zinc-800 p-2">
		<div class="prose prose-invert max-w-none text-sm text-zinc-200">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<div class="markdown-body">{@html html}</div>
		</div>
		{#if proposed}
			<div class="mt-3 border-t border-dashed border-amber-500/40 pt-2 text-xs text-amber-200/80">
				Proposed
				<pre class="whitespace-pre-wrap text-zinc-400">{proposed}</pre>
			</div>
		{/if}
	</div>
</div>
