<script lang="ts">
	type SpeakerMapping = {
		speakerId: string;
		displayName: string | null;
		linearUserId: string | null;
		linearName: string | null;
	};
	type LinearUser = { id: string; name: string; email: string };

	let {
		sessionId = null as string | null,
		observedSpeakerIds = [] as string[],
		mappings = [] as SpeakerMapping[],
		linearUsers = [] as LinearUser[],
		onsave = async (_payload: {
			sessionId: string;
			speakerId: string;
			displayName: string | null;
			linearUserId: string | null;
			linearName: string | null;
		}) => {},
		frameless = false
	} = $props();

	const draftBySpeaker = $state({} as Record<string, { displayName: string; linearUserId: string }>);
	let savingSpeaker = $state<string | null>(null);

	const mappingBySpeaker = $derived.by(() => {
		const m: Record<string, SpeakerMapping> = {};
		for (const row of mappings) m[row.speakerId] = row;
		return m;
	});

	const allSpeakerIds = $derived.by(() => {
		const set = new Set<string>(observedSpeakerIds);
		for (const row of mappings) set.add(row.speakerId);
		return Array.from(set).sort();
	});

	function getDraft(speakerId: string) {
		const existing = draftBySpeaker[speakerId];
		if (existing) return existing;
		const mapped = mappingBySpeaker[speakerId];
		return {
			displayName: mapped?.displayName ?? '',
			linearUserId: mapped?.linearUserId ?? ''
		};
	}

	function setDisplayName(speakerId: string, value: string) {
		draftBySpeaker[speakerId] = { ...getDraft(speakerId), displayName: value };
	}

	function setLinearUserId(speakerId: string, value: string) {
		draftBySpeaker[speakerId] = { ...getDraft(speakerId), linearUserId: value };
	}

	async function save(speakerId: string) {
		if (!sessionId) return;
		const draft = getDraft(speakerId);
		const selectedUser = linearUsers.find((u) => u.id === draft.linearUserId);
		savingSpeaker = speakerId;
		try {
			await onsave({
				sessionId,
				speakerId,
				displayName: draft.displayName.trim() || null,
				linearUserId: draft.linearUserId || null,
				linearName: selectedUser?.name ?? null
			});
		} finally {
			savingSpeaker = null;
		}
	}
</script>

<div
	class="flex min-h-0 h-full max-h-full flex-col gap-2 overflow-y-auto rounded-lg bg-zinc-900/50 p-3 {frameless
		? ''
		: 'border border-zinc-800'}"
>
	{#if !sessionId}
		<p class="text-sm text-zinc-600">No active transcript session yet.</p>
	{:else if allSpeakerIds.length === 0}
		<p class="text-sm text-zinc-600">
			No speakers listed yet. After the next transcript line, you should see at least one entry
			(per capture device as <code class="text-zinc-500">capture:…</code>, or diarized
			<code class="text-zinc-500">speaker_…</code> when the model provides it).
		</p>
	{:else}
		{#each allSpeakerIds as speakerId}
			<div class="space-y-2 rounded border border-zinc-800 bg-zinc-950 p-2">
				<div class="text-xs text-zinc-500">{speakerId}</div>
				<input
					class="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
					placeholder="Display name"
					value={getDraft(speakerId).displayName}
					oninput={(e) => setDisplayName(speakerId, (e.currentTarget as HTMLInputElement).value)}
				/>
				<select
					class="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
					value={getDraft(speakerId).linearUserId}
					onchange={(e) => setLinearUserId(speakerId, (e.currentTarget as HTMLSelectElement).value)}
				>
					<option value="">Unassigned</option>
					{#each linearUsers as u}
						<option value={u.id}>{u.name} ({u.email})</option>
					{/each}
				</select>
				<button
					type="button"
					class="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-300"
					disabled={savingSpeaker === speakerId}
					onclick={() => void save(speakerId)}
				>
					{savingSpeaker === speakerId ? 'Saving…' : 'Save mapping'}
				</button>
			</div>
		{/each}
	{/if}
</div>
