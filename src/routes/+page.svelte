<script lang="ts">
	import TranscriptFeed from '$lib/components/TranscriptFeed.svelte';
	import DraftQueue from '$lib/components/DraftQueue.svelte';
	import PrdEditor from '$lib/components/PrdEditor.svelte';
	import AgentTrace from '$lib/components/AgentTrace.svelte';
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let token = $state('');
	let prd = $state('');
	let proposed = $state('');
	let transcriptLines: { speakerId: string | null; text: string; t: number }[] = $state([]);
	let traces: { phase: string; detail: string; t: number }[] = $state([]);
	let drafts: { id: string; title: string; description: string; state: string }[] = $state([]);
	let eventSrc: EventSource | null = null;

	function authHeader() {
		return { Authorization: token ? `Bearer ${token}` : '' } as Record<string, string>;
	}

	async function loadPrd() {
		const r = await fetch('/api/prd', { headers: authHeader() });
		if (r.ok) {
			const j = (await r.json()) as { content: string };
			prd = j.content;
		}
	}

	async function loadDrafts() {
		const r = await fetch('/api/tickets', { headers: authHeader() });
		if (r.ok) {
			const j = (await r.json()) as { drafts: (typeof drafts)[0][] };
			drafts = j.drafts;
		}
	}

	function connectSse() {
		eventSrc?.close();
		const u = new URL('/api/events', location.origin);
		if (token) u.searchParams.set('token', token);
		eventSrc = new EventSource(u.toString());
		eventSrc.onmessage = (ev) => {
			try {
				const e = JSON.parse(ev.data) as { type: string; [k: string]: unknown };
				if (e.type === 'transcript') {
					transcriptLines = [
						...transcriptLines,
						{
							speakerId: e.speakerId as string | null,
							text: e.text as string,
							t: Date.now()
						}
					].slice(-200);
				} else if (e.type === 'agent_trace' || (e as { type: string }).type === 'stt' || (e as { type: string }).type === 'stt_partial') {
					traces = [
						...traces,
						{ phase: (e as { phase?: string }).phase ?? (e as { type: string }).type, detail: String((e as { detail?: string }).detail ?? ''), t: Date.now() }
					].slice(-80);
				} else if (e.type === 'prd') {
					prd = e.content as string;
				} else if (e.type === 'prd_proposed') {
					const pe = e as unknown as { section: string; body: string };
					proposed = `${pe.section}:\n${pe.body}`;
				} else if (e.type === 'draft') {
					void loadDrafts();
				}
			} catch {
				// ignore
			}
		};
	}

	function isTypingTarget(t: EventTarget | null) {
		const n = t as HTMLElement | null;
		const name = n?.tagName;
		return name === 'INPUT' || name === 'TEXTAREA' || n?.isContentEditable;
	}

	function onKey(e: KeyboardEvent) {
		if (isTypingTarget(e.target)) return;
		if (e.key === 'a' && drafts[0]?.state === 'pending') {
			if (e.metaKey) return;
			void fetch(`/api/tickets/${drafts[0]!.id}/approve`, { method: 'POST', headers: authHeader() }).then(
				() => loadDrafts()
			);
		}
		if (e.key === 'r' && drafts[0]?.state === 'pending') {
			void fetch(`/api/tickets/${drafts[0]!.id}/reject`, { method: 'POST', headers: authHeader() }).then(
				() => loadDrafts()
			);
		}
	}

	onMount(() => {
		const fromLs = localStorage.getItem('hubToken');
		token = fromLs || data.hubToken || '';
		if (data.hubToken) {
			localStorage.setItem('hubToken', data.hubToken);
		}
		void loadPrd();
		void loadDrafts();
		connectSse();
		window.addEventListener('keydown', onKey);
	});

	onDestroy(() => {
		eventSrc?.close();
		if (browser) {
			window.removeEventListener('keydown', onKey);
		}
	});
</script>

<svelte:head>
	<title>AI PM Hub</title>
</svelte:head>

<header class="border-b border-zinc-800 px-4 py-3">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-lg font-semibold tracking-tight">Always-On AI PM</h1>
			<p class="text-xs text-zinc-500">Local hub · <a href="/mobile" class="text-blue-400 hover:underline">Open mobile capture</a></p>
		</div>
		<div class="flex flex-wrap items-center gap-2 text-xs">
			<label class="flex items-center gap-1 text-zinc-500">
				HUB_TOKEN
				<input class="w-40 rounded border border-zinc-700 bg-zinc-900 px-1 font-mono text-zinc-200" bind:value={token} type="password" />
			</label>
			<button
				type="button"
				class="rounded border border-zinc-600 px-2 py-0.5 text-zinc-300"
				onclick={() => {
					if (typeof localStorage !== 'undefined') localStorage.setItem('hubToken', token || '');
					connectSse();
				}}>Reconnect SSE</button
			>
		</div>
	</div>
	{#if !data.flags.ripgrep}
		<div class="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-200">
			<strong>ripgrep</strong> not found. Install <code>rg</code> and ensure it is on PATH.
		</div>
	{/if}
	{#if !data.flags.eleven}
		<div class="mt-2 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-rose-200">
			<strong>ELEVENLABS_API_KEY</strong> is required for streaming STT.
		</div>
	{/if}
	{#if !data.flags.linear}
		<div class="mt-2 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-amber-100/90">
			<strong>LINEAR_API_KEY / LINEAR_TEAM_ID</strong> are required to push tickets.
		</div>
	{/if}
	{#if !data.flags.llm}
		<div class="mt-2 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-rose-200">
			Configure <strong>ANTHROPIC_API_KEY</strong> or <strong>OPENAI_API_KEY</strong> and <strong>LLM_PROVIDER</strong>.
		</div>
	{/if}
</header>

<main
	class="grid min-h-[80vh] flex-1 grid-cols-1 gap-2 p-2 lg:grid-cols-3 lg:grid-rows-[minmax(200px,1fr)_minmax(200px,1fr)_auto]"
>
	<section class="min-h-[180px] lg:row-span-1">
		<TranscriptFeed lines={transcriptLines} />
	</section>
	<section class="min-h-[180px] lg:row-span-1">
		<DraftQueue {drafts} token={token ?? ''} onupdate={loadDrafts} />
	</section>
	<section
		class="flex min-h-[240px] min-w-0 flex-col gap-2 lg:col-span-1 lg:row-span-2 lg:min-h-[50vh]"
	>
		<PrdEditor bind:content={prd} bind:proposed />
		<div class="flex shrink-0 flex-wrap justify-end gap-2">
			<button
				type="button"
				class="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-300"
				onclick={async () => {
					const r = await fetch('/api/prd', { method: 'GET', headers: authHeader() });
					if (r.ok) {
						const j = (await r.json()) as { content: string };
						prd = j.content;
					}
				}}>Refresh</button
			>
			<button
				type="button"
				class="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white"
				onclick={async () => {
					const r = await fetch('/api/prd', {
						method: 'POST',
						headers: { 'content-type': 'application/json', ...authHeader() },
						body: JSON.stringify({ fullContent: prd })
					});
					if (r.ok) {
						const j = (await r.json()) as { content: string };
						prd = j.content;
					}
				}}>Save PRD</button
			>
		</div>
	</section>
	<section class="min-h-0 lg:col-span-2">
		<p class="mb-1 text-xs text-zinc-500">Agent trace (keyboard: a/r on first draft)</p>
		<AgentTrace traces={traces} />
	</section>
</main>
