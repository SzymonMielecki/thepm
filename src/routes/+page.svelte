<script lang="ts">
	import TranscriptFeed from '$lib/components/TranscriptFeed.svelte';
	import DraftQueue from '$lib/components/DraftQueue.svelte';
	import PrdEditor from '$lib/components/PrdEditor.svelte';
	import AgentTrace from '$lib/components/AgentTrace.svelte';
	import ConnectedCapture from '$lib/components/ConnectedCapture.svelte';
	import type { CaptureClientInfo } from '$lib/capture-types';
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
	let captureDevices: CaptureClientInfo[] = $state([]);
	/** clientId → bar heights 0..1 for live capture waveform (SSE) */
	let captureWaveforms: Record<string, number[]> = $state({});
	let eventSrc: EventSource | null = null;
	let prdLoadError = $state('');
	/** Hub-resolved file path for the document shown (local disk or bridge’s `--prd` path) */
	let prdFilePath = $state('');

	function authHeader() {
		return { Authorization: token ? `Bearer ${token}` : '' } as Record<string, string>;
	}

	async function loadPrd() {
		prdLoadError = '';
		const r = await fetch('/api/prd', { headers: authHeader() });
		if (r.ok) {
			const j = (await r.json()) as { content: string; prdFilePath?: string };
			prd = j.content;
			if (j.prdFilePath) prdFilePath = j.prdFilePath;
			return;
		}
		try {
			const j = (await r.json()) as { error?: string; detail?: string };
			if (j?.detail) {
				prdLoadError = j.detail;
			} else {
				prdLoadError = `PRD request failed (${r.status})`;
			}
		} catch {
			prdLoadError = `PRD request failed (${r.status})`;
		}
	}

	async function loadDrafts() {
		const r = await fetch('/api/tickets', { headers: authHeader() });
		if (r.ok) {
			const j = (await r.json()) as { drafts: (typeof drafts)[0][] };
			drafts = j.drafts;
		}
	}

	async function loadTranscripts() {
		const r = await fetch('/api/transcripts', { headers: authHeader() });
		if (r.ok) {
			const j = (await r.json()) as {
				lines: { speakerId: string | null; text: string; t: number }[];
			};
			transcriptLines = j.lines.slice(-200);
		}
	}

	async function loadCaptureClients() {
		const r = await fetch('/api/capture/clients', { headers: authHeader() });
		if (r.ok) {
			const j = (await r.json()) as { devices: CaptureClientInfo[] };
			captureDevices = j.devices;
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
				} else if (e.type === 'capture_devices') {
					const p = e as unknown as { devices: CaptureClientInfo[] };
					if (Array.isArray(p.devices)) {
						captureDevices = p.devices;
						const keep = new Set(p.devices.map((d) => d.id));
						const w = { ...captureWaveforms };
						for (const k of Object.keys(w)) {
							if (!keep.has(k)) delete w[k];
						}
						captureWaveforms = w;
					}
				} else if (e.type === 'capture_waveform') {
					const p = e as unknown as { clientId: string; levels: number[] };
					if (typeof p.clientId === 'string' && Array.isArray(p.levels) && p.levels.length) {
						captureWaveforms = { ...captureWaveforms, [p.clientId]: p.levels };
					}
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
		void (async () => {
			await loadTranscripts();
			await loadCaptureClients();
			connectSse();
		})();
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
					void loadPrd();
					void Promise.all([loadTranscripts(), loadCaptureClients()]).then(() => connectSse());
				}}>Reconnect / reload PRD</button
			>
		</div>
	</div>
	{#if !data.flags.ripgrep}
		<div class="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-200">
			{#if data.codeBackend === 'bridge'}
				<strong>Code bridge</strong> is not connected. The hub cannot read the repo or PRD from your machine. Run
				<code>thepm-bridge --help</code> with the same <code>--hub-url</code> / <code>--token</code> as this hub, then
				click <em>Reconnect / reload PRD</em>.
			{:else}
				<strong>ripgrep</strong> not found. Install <code>rg</code> and ensure it is on PATH.
			{/if}
		</div>
	{/if}
	{#if prdLoadError}
		<div class="mt-2 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-rose-100 text-xs">
			<strong>PRD</strong> could not be loaded: {prdLoadError}
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
			Configure <strong>LLM_PROVIDER</strong> and keys (<strong>ANTHROPIC_API_KEY</strong> /
			<strong>OPENAI_API_KEY</strong>) or use local <strong>ollama</strong> with <strong>OLLAMA_MODEL</strong>.
		</div>
	{/if}
	<div class="mt-3 px-0">
		<ConnectedCapture devices={captureDevices} waveforms={captureWaveforms} />
	</div>
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
		{#if prdFilePath}
			<p class="shrink-0 text-xs leading-snug text-zinc-500">
				{#if data.codeBackend === 'bridge'}
					PRD content is read and written on the machine running <code class="text-zinc-400">thepm-bridge</code> at the
					path above.
				{:else}
					The hub reads and writes <strong>this</strong> file on the server. To work on a different project’s PRD: set
					<code class="text-zinc-400">PROJECT_ROOT</code> and
					<code class="text-zinc-400">PRD_PATH</code> in the hub’s <code class="text-zinc-400">.env</code>, or use a
					remote hub with
					<code class="text-zinc-400">CODE_BACKEND=bridge</code> and run
					<code class="text-zinc-400">thepm-bridge</code> from that repository.
				{/if}
			</p>
		{/if}
		<PrdEditor bind:content={prd} bind:proposed pathLabel={prdFilePath} />
		<div class="flex shrink-0 flex-wrap justify-end gap-2">
			<button
				type="button"
				class="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-300"
				onclick={async () => {
					await loadPrd();
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
