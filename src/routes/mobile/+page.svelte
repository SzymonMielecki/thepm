<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { startPcm16kCapture, type PcmCapture } from '$lib/client/pcm-capture';
	import { hubTokenToSsePathSegment, hubTokenToWsSubprotocol } from '$lib/client/hub-ws';
	import TranscriptFeed from '$lib/components/TranscriptFeed.svelte';

	// Never read localStorage during SSR (Node may stub it without getItem).
	let token = $state('');
	let status = $state('idle') as 'idle' | 'listening' | 'error';
	let err = $state('');
	let transcriptLines: { speakerId: string | null; text: string; t: number }[] = $state([]);
	let eventSrc: EventSource | null = null;
	/** Polling is a backstop: SSE is fragile through some PWA / proxy / EventSource paths. */
	let pollId: ReturnType<typeof setInterval> | null = null;
	let feedError = $state('');
	let pendingManual: string | null = null;

	const wsPath = '/api/audio/stream';
	let session = $state('');
	let ws: WebSocket | null = null;
	let pcm: PcmCapture | null = null;

	function authHeader() {
		return { Authorization: token ? `Bearer ${token}` : '' } as Record<string, string>;
	}

	async function loadTranscripts() {
		if (!token.trim()) {
			feedError = 'Set HUB_TOKEN to load transcript';
			return;
		}
		feedError = '';
		const r = await fetch('/api/transcripts', { headers: authHeader() });
		if (r.ok) {
			const j = (await r.json()) as {
				lines: { speakerId: string | null; text: string; t: number }[];
			};
			transcriptLines = j.lines.slice(-200);
		} else if (r.status === 401) {
			feedError = 'HUB_TOKEN rejected (check it matches the hub .env).';
		} else {
			feedError = `Transcript request failed (${r.status})`;
		}
	}

	function appendTranscriptLine(speakerId: string | null, text: string) {
		transcriptLines = [
			...transcriptLines,
			{ speakerId, text, t: Date.now() }
		].slice(-200);
	}

	function startTranscriptPoll() {
		if (pollId) {
			clearInterval(pollId);
			pollId = null;
		}
		if (!browser || !token.trim()) return;
		pollId = setInterval(() => {
			void loadTranscripts();
		}, 3500);
	}

	function connectSse() {
		if (!browser) return;
		eventSrc?.close();
		if (!token.trim()) return;
		// Path-based token: EventSource has no `Authorization`; `?token=` can be dropped by proxies.
		const u = new URL(location.origin);
		u.pathname = '/api/events/hub/' + hubTokenToSsePathSegment(token);
		eventSrc = new EventSource(u.toString());
		eventSrc.onmessage = (ev) => {
			try {
				const e = JSON.parse(ev.data) as { type: string; [k: string]: unknown };
				if (e.type === 'transcript') {
					feedError = '';
					appendTranscriptLine(e.speakerId as string | null, e.text as string);
				}
			} catch {
				// ignore
			}
		};
		eventSrc.onerror = () => {
			if (token.trim()) {
				feedError =
					'Live SSE failed (transcript still refreshes on a short poll). If this persists, reload the app.';
			}
		};
	}

	function reconnectFeed() {
		void loadTranscripts();
		connectSse();
		startTranscriptPoll();
	}

	function sendAudioChunk(b64: string) {
		if (ws?.readyState !== WebSocket.OPEN) return;
		ws.send(
			JSON.stringify({
				message_type: 'input_audio_chunk',
				audio_base_64: b64,
				commit: false,
				sample_rate: 16000
			})
		);
	}

	function sendWaveformLevels(levels: number[]) {
		if (ws?.readyState !== WebSocket.OPEN) return;
		ws.send(JSON.stringify({ type: 'waveform', levels }));
	}

	function connectWs() {
		if (!browser) return;
		ws?.close();
		const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
		const q = new URLSearchParams();
		if (token) q.set('token', token);
		if (session) q.set('session', session);
		const finalUrl = `${scheme}://${location.host}${wsPath}?${q.toString()}`;

		const sub = token.trim() ? [hubTokenToWsSubprotocol(token)] as string[] : undefined;
		ws = sub ? new WebSocket(finalUrl, sub) : new WebSocket(finalUrl);
		ws.binaryType = 'arraybuffer';
		ws.onmessage = (ev) => {
			try {
				const j = JSON.parse(ev.data as string) as { type: string; sessionId?: string; error?: string };
				if (j.type === 'session' && j.sessionId) {
					session = j.sessionId;
					localStorage.setItem('pmSession', j.sessionId);
				} else if (j.type === 'stt_upstream_error') {
					err = j.error ?? 'Speech-to-text error from provider';
				} else if (j.type === 'stt_unavailable' || j.type === 'error') {
					err = j.error ?? String(ev.data);
					status = 'error';
				} else if (j.type === 'final_acked' || j.type === 'config_acked') {
					err = '';
					if (j.type === 'final_acked' && pendingManual) {
						appendTranscriptLine(null, pendingManual);
						pendingManual = null;
					}
				} else if (j.type === 'final_failed' && j.error) {
					pendingManual = null;
					err = j.error;
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
		ws.onclose = (ev) => {
			if (ev.code === 4001) {
				err = 'Hub rejected the token (or it was lost in the WebSocket request). Re-enter HUB_TOKEN.';
				status = 'error';
			}
		};
	}

	/** Open hub WebSocket and wait (like Record) but do not use the mic — for manual line only. */
	async function ensureWsForManual(): Promise<boolean> {
		if (!browser) return false;
		if (ws?.readyState === WebSocket.OPEN) return true;
		if (!token.trim()) {
			err = 'Set HUB_TOKEN first';
			status = 'error';
			return false;
		}
		if (browser) {
			session = localStorage.getItem('pmSession') || session;
		}
		connectWs();
		try {
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
			});
		} catch (e) {
			err = (e as Error).message;
			status = 'error';
			return false;
		}
		return true;
	}

	async function start() {
		err = '';
		status = 'listening';
		if (browser) {
			session = localStorage.getItem('pmSession') || session;
		}
		if (!token.trim()) {
			err = 'Set HUB_TOKEN first';
			status = 'error';
			return;
		}
		reconnectFeed();
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
		// `err` is set on WS failure (status may not narrow for TS on `$state` here)
		if (err) return;
		try {
			const m = await navigator.mediaDevices.getUserMedia({
				audio: {
					channelCount: { ideal: 1 },
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true
				}
			});
			pcm = await startPcm16kCapture(m, sendAudioChunk, sendWaveformLevels);
		} catch (e) {
			err = (e as Error).message || 'Microphone error';
			status = 'error';
		}
	}

	function stop() {
		pcm?.stop();
		pcm = null;
		ws?.close();
		ws = null;
		status = 'idle';
	}

	/** Text fallback when STT is unavailable (still routes through hub). */
	async function sendText() {
		const t = (document.getElementById('manual-t') as HTMLInputElement | null)?.value;
		if (!t?.trim()) {
			err = 'Enter text to send';
			return;
		}
		const ok = await ensureWsForManual();
		if (!ok || !ws || ws.readyState !== WebSocket.OPEN) {
			err = err || 'Could not connect to hub';
			return;
		}
		err = '';
		pendingManual = t.trim();
		ws.send(JSON.stringify({ type: 'final', text: t, sessionId: session || undefined }));
		(document.getElementById('manual-t') as HTMLInputElement).value = '';
	}

	onMount(() => {
		try {
			token = localStorage.getItem('hubToken') || '';
			session = localStorage.getItem('pmSession') || '';
		} catch {
			// private mode / blocked
		}
		if (token.trim()) {
			reconnectFeed();
		}
	});

	onDestroy(() => {
		if (pollId) {
			clearInterval(pollId);
			pollId = null;
		}
		eventSrc?.close();
		eventSrc = null;
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
				onchange={() => {
					if (typeof localStorage !== 'undefined') localStorage.setItem('hubToken', token);
					if (token.trim()) reconnectFeed();
				}}
			/></label
		>
		<button
			type="button"
			class="w-full rounded border border-zinc-600 py-1.5 text-xs text-zinc-300"
			onclick={() => {
				if (typeof localStorage !== 'undefined') localStorage.setItem('hubToken', token);
				reconnectFeed();
			}}>Connect live transcript</button
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

	<div class="h-[min(50vh,28rem)] min-h-48 shrink-0 overflow-hidden">
		{#if feedError}
			<p class="mb-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
				{feedError}
			</p>
		{/if}
		<TranscriptFeed lines={transcriptLines} />
	</div>

	<div class="rounded border border-zinc-800 p-2 text-sm text-zinc-500">
		Session: <span class="font-mono text-zinc-300">{session || '—'}</span>
	</div>
	{#if err}
		<p class="text-sm text-rose-400">{err}</p>
	{/if}

	<div class="border-t border-zinc-800 pt-4">
		<p class="mb-1 text-xs text-zinc-500">Manual line — connects automatically; no need to press Record</p>
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
