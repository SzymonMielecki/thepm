<script lang="ts">
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';

	let token = $state(typeof localStorage !== 'undefined' ? localStorage.getItem('hubToken') || '' : '');
	let status = $state('idle') as 'idle' | 'listening' | 'error';
	let err = $state('');

	const wsPath = '/api/audio/stream';
	let session = $state('');
	let ws: WebSocket | null = null;
	let rec: MediaRecorder | null = null;

	function connectWs() {
		if (!browser) return;
		ws?.close();
		const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
		const q = new URLSearchParams();
		if (token) q.set('token', token);
		if (session) q.set('session', session);
		const finalUrl = `${scheme}://${location.host}${wsPath}?${q.toString()}`;

		ws = new WebSocket(finalUrl);
		ws.binaryType = 'arraybuffer';
		ws.onmessage = (ev) => {
			try {
				const j = JSON.parse(ev.data as string) as { type: string; sessionId?: string; error?: string };
				if (j.type === 'session' && j.sessionId) {
					session = j.sessionId;
					localStorage.setItem('pmSession', j.sessionId);
				} else if (j.type === 'stt_unavailable' || j.type === 'error') {
					err = j.error ?? String(ev.data);
					status = 'error';
				}
			} catch {
				// binary
			}
		};
		ws.onerror = () => {
			err = 'WebSocket error';
			status = 'error';
		};
	}

	async function start() {
		err = '';
		status = 'listening';
		session = localStorage.getItem('pmSession') || session;
		if (!token.trim()) {
			err = 'Set HUB_TOKEN first';
			status = 'error';
			return;
		}
		connectWs();
		await new Promise<void>((res, rej) => {
			const t = setTimeout(() => rej(new Error('WS timeout')), 8000);
			if (!ws) {
				clearTimeout(t);
				rej(new Error('no ws'));
				return;
			}
			ws.addEventListener('open', () => {
				clearTimeout(t);
				res();
			});
			ws.addEventListener('error', () => {
				clearTimeout(t);
				rej(new Error('ws'));
			});
		}).catch((e) => {
			err = (e as Error).message;
			status = 'error';
		});
		if (status === 'error') return;
		const m = await navigator.mediaDevices.getUserMedia({ audio: true });
		rec = new MediaRecorder(m, { mimeType: 'audio/webm' });
		rec.addEventListener('dataavailable', (e) => {
			if (e.data.size > 0 && ws?.readyState === WebSocket.OPEN) {
				e.data
					.arrayBuffer()
					.then((b) => ws?.send(b))
					.catch(() => {
						// ignore
					});
			}
		});
		rec.start(250);
	}

	function stop() {
		rec?.stop();
		rec = null;
		ws?.close();
		ws = null;
		status = 'idle';
	}

	/** Text fallback when STT is unavailable (still routes through hub). */
	function sendText() {
		const t = (document.getElementById('manual-t') as HTMLInputElement | null)?.value;
		if (!t?.trim() || !ws || ws.readyState !== WebSocket.OPEN) {
			err = 'Connect and enter text';
			return;
		}
		ws.send(JSON.stringify({ type: 'final', text: t, sessionId: session || undefined }));
		(document.getElementById('manual-t') as HTMLInputElement).value = '';
	}

	onDestroy(() => {
		stop();
	});
</script>

<svelte:head>
	<title>Capture · PM</title>
	<meta name="theme-color" content="#0a0a0a" />
</svelte:head>

<div class="mx-auto max-w-md space-y-4 p-4">
	<h1 class="text-xl font-semibold">Table capture</h1>
	<p class="text-sm text-zinc-500">PWA: allow microphone. Use <code>tailscale funnel</code> for HTTPS on phones.</p>

	<div class="space-y-2">
		<label class="block text-xs text-zinc-500"
			>HUB_TOKEN
			<input
				type="password"
				class="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-2"
				bind:value={token}
			/></label
		>
	</div>

	<div class="flex gap-2">
		{#if status === 'idle' || status === 'error'}
			<button
				type="button"
				class="flex-1 rounded-lg bg-red-600 py-4 text-lg font-semibold text-white"
				onclick={start}
			>
				Record
			</button>
		{:else}
			<button
				type="button"
				class="flex-1 rounded-lg bg-zinc-700 py-4 text-lg font-semibold"
				onclick={stop}
			>
				Stop
			</button>
		{/if}
	</div>

	<div class="rounded border border-zinc-800 p-2 text-sm text-zinc-500">
		Session: <span class="font-mono text-zinc-300">{session || '—'}</span>
	</div>
	{#if err}
		<p class="text-sm text-rose-400">{err}</p>
	{/if}

	<div class="border-t border-zinc-800 pt-4">
		<p class="mb-1 text-xs text-zinc-500">Manual line (if STT WIP)</p>
		<div class="flex gap-1">
			<input id="manual-t" class="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2" placeholder="Say something…" />
			<button
				type="button"
				class="rounded border border-zinc-600 px-2"
				onclick={sendText}>Send</button
			>
		</div>
	</div>
</div>
