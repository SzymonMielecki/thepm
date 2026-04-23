<script lang="ts">
	import type { CaptureClientInfo } from '$lib/capture-types';

	let { devices, waveforms = {} } = $props<{
		devices: CaptureClientInfo[];
		waveforms?: Record<string, number[]>;
	}>();

	const BAR_COUNT = 20;
	const IDLE_WAVE: number[] = Array.from({ length: BAR_COUNT }, () => 0.04);

	function shortSession(id: string) {
		if (id.length <= 10) return id;
		return `${id.slice(0, 6)}…${id.slice(-4)}`;
	}

	function shortUa(ua: string | null) {
		if (!ua) return 'unknown client';
		const m = /(?:Mobile\/)?([^/;\s]+)/.exec(ua);
		const hint = m?.[1] ?? ua;
		if (ua.includes('iPhone') || ua.includes('Android')) {
			if (ua.includes('Safari') && !ua.includes('CriOS')) return 'Mobile Safari';
			if (ua.includes('CriOS')) return 'Chrome (iOS)';
			if (ua.includes('Android')) return 'Android WebView';
		}
		return hint.length > 28 ? hint.slice(0, 25) + '…' : hint;
	}

	function formatAddr(a: string | null) {
		if (!a) return '—';
		if (a === '::1' || a === '::ffff:127.0.0.1') return 'local';
		if (a.startsWith('::ffff:')) return a.slice(7);
		return a;
	}
</script>

<div class="border-t border-zinc-800/80 pt-2">
	<p class="mb-1.5 text-xs font-medium text-zinc-500">Connected capture</p>
	{#if devices.length === 0}
		<p class="text-xs text-zinc-600">No clients on <code class="text-zinc-500">/api/audio/stream</code> — open
			<a href="/mobile" class="text-blue-400 hover:underline">mobile capture</a> on a device.</p>
	{:else}
		<ul class="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap">
			{#each devices as d (d.id)}
				<li
					class="flex min-w-0 flex-wrap items-center gap-2 rounded border border-emerald-800/50 bg-emerald-950/25 px-2 py-1.5 text-xs"
				>
					<span
						class="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400"
						title="Connected"
					></span>
					<div
						class="flex h-7 min-w-22 max-w-full shrink-0 items-end gap-px self-center rounded border border-zinc-700/80 bg-zinc-950/80 px-0.5 py-0.5"
						title="Live level from this capture client"
					>
						{#each waveforms[d.id] ?? IDLE_WAVE as h, i (i)}
							<div
								class="min-h-px w-0.5 flex-1 rounded-t bg-linear-to-t from-emerald-600 to-emerald-300"
								style="height: {Math.max(2, 4 + h * 20)}px"
							></div>
						{/each}
					</div>
					<span class="font-mono text-emerald-100/90" title={d.sessionId}>{shortSession(d.sessionId)}</span>
					<span class="shrink-0 text-zinc-500">·</span>
					<span class="min-w-0 truncate text-zinc-400" title={d.userAgent ?? ''}>{shortUa(d.userAgent)}</span>
					<span class="shrink-0 text-zinc-600">{formatAddr(d.remoteAddress)}</span>
					<span class="shrink-0 text-zinc-600">
						· {new Date(d.connectedAt).toLocaleTimeString(undefined, {
							hour: '2-digit',
							minute: '2-digit',
							second: '2-digit'
						})}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
