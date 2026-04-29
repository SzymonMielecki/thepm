<script lang="ts">
  import { DEFAULT_DELEGATION_TEAM_NAME } from "$lib/delegation-constants";

  type Mux = { flavor: string; session?: string };
  type Agent = {
    source: string;
    name: string;
    description: string;
    shadowed?: boolean;
    body?: string;
    tools?: string;
    model?: string;
  };
  type Team = {
    source: string;
    name: string;
    description: string;
    dispatch: string;
    agents: string[];
    shadowed?: boolean;
    body?: string;
    promptTemplate?: string;
  };
  type DelegationRun = Record<string, unknown>;
  type Delegation = Record<string, unknown> & { runs?: DelegationRun[] };

  let {
    token = "",
    mux = { flavor: "none" } as Mux,
    /** True after `/api/agents` mux probe finished (or skipped when there is no token). */
    muxReady = false,
    frameless = false,
    reloadKey = 0,
    ontoast = (_k: "success" | "error" | "info", _m: string) => {},
  } = $props();

  let tab = $state<"live" | "catalog" | "build" | "newAgent">("live");
  let agents = $state<Agent[]>([]);
  let teams = $state<Team[]>([]);
  let delegations = $state<Delegation[]>([]);
  let hoverAgent = $state<Agent | null>(null);
  let hoverTeam = $state<Team | null>(null);

  let edAgent = $state<string | null>(null);
  let edAgentDescription = $state("");
  let edAgentTools = $state("");
  let edAgentModel = $state("");
  let edAgentBody = $state("");
  let edAgentSaving = $state(false);

  let edTeam = $state<string | null>(null);
  let edTeamDescription = $state("");
  let edTeamDispatch = $state<"parallel" | "sequential">("parallel");
  let edTeamMembers = $state("");
  let edTeamPrompt = $state("");
  let edTeamSaving = $state(false);

  let buildName = $state("");
  let buildDesc = $state("");
  let buildMode = $state<"parallel" | "sequential">("parallel");
  let buildMembers = $state("");
  let buildPrompt = $state("");
  let buildLoading = $state(false);

  let naName = $state("");
  let naDesc = $state("");
  let naTools = $state("");
  let naModel = $state("");
  let naBody = $state("");
  let naLoading = $state(false);

  function authHeader(): Record<string, string> {
    return { Authorization: token ? `Bearer ${token}` : "" };
  }

  async function refresh() {
    const r = await fetch("/api/agents", { headers: authHeader() });
    if (!r.ok) return;
    const j = (await r.json()) as { agents: Agent[]; teams: Team[] };
    agents = j.agents ?? [];
    teams = j.teams ?? [];
  }

  async function loadDelegations() {
    const r = await fetch("/api/delegations", { headers: authHeader() });
    if (!r.ok) return;
    const j = (await r.json()) as { delegations: Delegation[] };
    delegations = j.delegations ?? [];
  }

  function openAgentEditor(a: Agent) {
    edAgent = a.name;
    edAgentDescription = a.description ?? "";
    edAgentTools = a.tools ?? "";
    edAgentModel = a.model ?? "";
    edAgentBody = a.body ?? "";
  }

  function closeAgentEditor() {
    edAgent = null;
  }

  function openTeamEditor(t: Team) {
    edTeam = t.name;
    edTeamDescription = t.description ?? "";
    edTeamDispatch = t.dispatch === "sequential" ? "sequential" : "parallel";
    edTeamMembers = (t.agents ?? []).join(", ");
    edTeamPrompt = t.promptTemplate ?? "";
  }

  function closeTeamEditor() {
    edTeam = null;
  }

  async function saveAgentEditor() {
    const name = edAgent?.trim();
    if (!name || edAgentSaving) return;
    edAgentSaving = true;
    try {
      const r = await fetch(`/api/agents/agents/${encodeURIComponent(name)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...authHeader() },
        body: JSON.stringify({
          description: edAgentDescription,
          tools: edAgentTools,
          model: edAgentModel,
          body: edAgentBody,
        }),
      });
      if (!r.ok) {
        ontoast("error", `Save failed (${r.status})`);
        return;
      }
      ontoast("success", "Agent saved.");
      await refresh();
    } finally {
      edAgentSaving = false;
    }
  }

  async function revertAgentEditor() {
    const name = edAgent?.trim();
    if (!name) return;
    const r = await fetch(`/api/agents/agents/${encodeURIComponent(name)}`, {
      method: "DELETE",
      headers: authHeader(),
    });
    if (!r.ok) {
      if (r.status === 404) {
        ontoast("info", "No stored copy to remove.");
      } else {
        ontoast("error", `Revert failed (${r.status})`);
      }
      return;
    }
    ontoast("success", "Reverted to built-in defaults (for roles) or removed custom agent.");
    closeAgentEditor();
    await refresh();
  }

  async function saveTeamEditor() {
    const name = edTeam?.trim();
    if (!name || edTeamSaving) return;
    const members = edTeamMembers
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!members.length) {
      ontoast("error", "Team needs at least one member.");
      return;
    }
    edTeamSaving = true;
    try {
      const r = await fetch(`/api/agents/teams/${encodeURIComponent(name)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...authHeader() },
        body: JSON.stringify({
          description: edTeamDescription || null,
          dispatch_mode: edTeamDispatch,
          members,
          prompt_template: edTeamPrompt.trim() || null,
        }),
      });
      if (!r.ok) {
        ontoast("error", `Save failed (${r.status})`);
        return;
      }
      ontoast("success", "Team saved.");
      closeTeamEditor();
      await refresh();
    } finally {
      edTeamSaving = false;
    }
  }

  async function deleteTeamRow(name: string) {
    if (
      !confirm(
        name === DEFAULT_DELEGATION_TEAM_NAME
          ? "Remove saved override for the default team? Hub will use the built-in template again."
          : "Delete this team?",
      )
    ) {
      return;
    }
    const r = await fetch(`/api/agents/teams/${encodeURIComponent(name)}`, {
      method: "DELETE",
      headers: authHeader(),
    });
    if (!r.ok) {
      ontoast("error", `Delete failed (${r.status})`);
      return;
    }
    ontoast("success", name === DEFAULT_DELEGATION_TEAM_NAME ? "Default team reset." : "Team removed.");
    closeTeamEditor();
    await refresh();
  }

  async function submitTeam() {
    const members = buildMembers
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!buildName.trim() || !members.length || buildLoading) return;
    buildLoading = true;
    try {
      const r = await fetch("/api/agents/teams", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeader() },
        body: JSON.stringify({
          name: buildName.trim(),
          description: buildDesc.trim() || undefined,
          dispatch_mode: buildMode,
          members,
          prompt_template: buildPrompt.trim() || undefined,
        }),
      });
      if (!r.ok) {
        ontoast("error", `Save failed (${r.status})`);
        return;
      }
      ontoast("success", "Team saved.");
      buildName = "";
      buildDesc = "";
      buildMembers = "";
      buildPrompt = "";
      await refresh();
    } finally {
      buildLoading = false;
    }
  }

  async function submitNewAgent() {
    if (!naName.trim() || !naBody.trim() || naLoading) return;
    naLoading = true;
    try {
      const r = await fetch("/api/agents/agents", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeader() },
        body: JSON.stringify({
          name: naName.trim(),
          description: naDesc.trim(),
          tools: naTools.trim(),
          model: naModel.trim(),
          body: naBody.trim(),
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        ontoast("error", t || `Save failed (${r.status})`);
        return;
      }
      ontoast("success", "Agent added.");
      naName = "";
      naDesc = "";
      naTools = "";
      naModel = "";
      naBody = "";
      await refresh();
    } finally {
      naLoading = false;
    }
  }

  async function cancelDelegation(id: string) {
    const r = await fetch(`/api/delegations/${id}`, {
      method: "DELETE",
      headers: authHeader(),
    });
    if (!r.ok) {
      ontoast("error", `Cancel failed (${r.status})`);
      return;
    }
    ontoast("success", "Delegation cancelled.");
    await loadDelegations();
  }

  async function dismissDelegation(id: string) {
    const r = await fetch(`/api/delegations/${id}`, {
      method: "DELETE",
      headers: authHeader(),
    });
    if (!r.ok) {
      ontoast("error", `Dismiss failed (${r.status})`);
      return;
    }
    ontoast("success", "Delegation dismissed.");
    await loadDelegations();
  }

  async function focusRun(delegationId: string, runId: string) {
    const r = await fetch(`/api/delegations/${delegationId}/runs/${runId}/focus`, {
      method: "POST",
      headers: authHeader(),
    });
    if (!r.ok) ontoast("error", "Focus failed (tmux/cmux only on bridge host).");
    else ontoast("info", "Focus sent to bridge.");
  }

  $effect(() => {
    if (!token.trim()) return;
    void refresh();
    void loadDelegations();
  });

  $effect(() => {
    void reloadKey;
    if (!token.trim()) return;
    void loadDelegations();
  });
</script>

<div
  class="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden {frameless
    ? ''
    : 'rounded-lg border border-zinc-800 bg-zinc-900/50 p-3'}"
>
  <div class="shrink-0 text-xs text-zinc-500">
    {#if !muxReady}
      <span class="inline-flex items-center gap-2 text-zinc-400" role="status" aria-live="polite">
        <span
          class="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300"
          aria-hidden="true"
        ></span>
        Detecting multiplexer…
      </span>
    {:else if mux.flavor === "none"}
      <span class="text-amber-200/90"
        >No multiplexer detected on the bridge — run <code class="text-amber-100">thepm bridge</code> in the same
        environment as <strong>tmux</strong> / <code class="text-amber-100">cmux claude-teams</code> (so
        <code class="text-amber-100">tmux</code> can see your session), or set
        <code class="text-amber-100">THEPM_MUX_SESSION</code> to the session name.</span
      >
    {:else}
      Mux: <strong class="text-zinc-300">{mux.flavor}</strong>{#if mux.session}
        · session <code class="text-zinc-400">{mux.session}</code>{/if}
    {/if}
  </div>

  <div class="flex shrink-0 flex-wrap gap-1 border-b border-zinc-800 pb-2">
    <button
      type="button"
      class="rounded px-2 py-1 text-xs {tab === 'live' ? 'bg-zinc-700 text-white' : 'text-zinc-400'}"
      onclick={() => {
        tab = "live";
        void loadDelegations();
      }}>Live delegations</button
    >
    <button
      type="button"
      class="rounded px-2 py-1 text-xs {tab === 'catalog' ? 'bg-zinc-700 text-white' : 'text-zinc-400'}"
      onclick={() => (tab = 'catalog')}>Catalog</button
    >
    <button
      type="button"
      class="rounded px-2 py-1 text-xs {tab === 'build' ? 'bg-zinc-700 text-white' : 'text-zinc-400'}"
      onclick={() => (tab = 'build')}>New team</button
    >
    <button
      type="button"
      class="rounded px-2 py-1 text-xs {tab === 'newAgent' ? 'bg-zinc-700 text-white' : 'text-zinc-400'}"
      onclick={() => (tab = 'newAgent')}>New agent</button
    >
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain text-sm">
    {#if tab === "live"}
      <ul class="space-y-2 text-xs">
        {#each delegations as del}
          <li class="rounded border border-zinc-800 bg-zinc-950 p-2">
            <div class="font-medium text-zinc-200">
              {String(del.target_kind)} · {String(del.target_name)}
              <span class="text-zinc-500">· {String(del.status)}</span>
            </div>
            {#if del.draft_id}
              <p class="mt-0.5 text-[10px] text-zinc-600">draft {String(del.draft_id).slice(0, 8)}…</p>
            {:else if del.linear_issue_id}
              <p class="mt-0.5 text-[10px] text-zinc-600">
                Linear issue {String(del.linear_issue_id).slice(0, 8)}…
              </p>
            {/if}
            <ul class="mt-1 space-y-1 text-zinc-400">
              {#each del.runs ?? [] as run}
                <li class="flex flex-wrap items-center gap-2">
                  <span>{String(run.agent_name)}</span>
                  <span class="text-zinc-600">{String(run.status)}</span>
                  {#if run.mux_window_id}
                    <code class="text-zinc-500">{String(run.mux_window_id)}</code>
                  {/if}
                  <button
                    type="button"
                    class="text-blue-400 hover:underline"
                    onclick={() => void focusRun(String(del.id), String(run.id))}>Focus tab</button
                  >
                </li>
              {/each}
            </ul>
            {#if String(del.status) === 'running' || String(del.status) === 'queued'}
              <button
                type="button"
                class="mt-2 text-rose-400 hover:underline"
                onclick={() => void cancelDelegation(String(del.id))}>Cancel</button
              >
            {:else if String(del.status) === 'cancelled' || String(del.status) === 'failed' || String(del.status) === 'succeeded'}
              <button
                type="button"
                class="mt-2 text-zinc-500 hover:text-zinc-300 hover:underline"
                onclick={() => void dismissDelegation(String(del.id))}>Dismiss</button
              >
            {/if}
          </li>
        {:else}
          <li class="text-zinc-600">No delegations yet.</li>
        {/each}
      </ul>
    {:else if tab === "catalog"}
      <div class="space-y-3">
        <p class="text-xs text-zinc-500">
          Edit built-in roles or the <strong class="text-zinc-300">default</strong> team; add more teams/agents from
          the other tabs. Stored changes live in the hub database.
        </p>
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wide text-zinc-500">Agents</h3>
          <ul class="mt-1 space-y-1">
            {#each agents as a}
              <li class="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="text-left text-zinc-200 hover:underline {a.shadowed ? 'opacity-40' : ''}"
                  onmouseenter={() => (hoverAgent = a)}
                  onmouseleave={() => (hoverAgent = null)}
                >
                  <span class="text-zinc-500">[{a.source}]</span> {a.name}
                </button>
                <button
                  type="button"
                  class="text-xs text-blue-400 hover:underline"
                  onclick={() => openAgentEditor(a)}>Edit</button
                >
              </li>
            {/each}
          </ul>
        </div>
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wide text-zinc-500">Teams</h3>
          <ul class="mt-1 space-y-1">
            {#each teams as t}
              <li class="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="text-left text-zinc-200 hover:underline {t.shadowed ? 'opacity-40' : ''}"
                  onmouseenter={() => (hoverTeam = t)}
                  onmouseleave={() => (hoverTeam = null)}
                >
                  <span class="text-zinc-500">[{t.source}]</span> {t.name}
                  <span class="text-zinc-500">· {t.dispatch}</span>
                </button>
                <button
                  type="button"
                  class="text-xs text-blue-400 hover:underline"
                  onclick={() => openTeamEditor(t)}>Edit</button
                >
                {#if t.source === "db" && t.name !== DEFAULT_DELEGATION_TEAM_NAME}
                  <button
                    type="button"
                    class="text-xs text-rose-400/90 hover:underline"
                    onclick={() => void deleteTeamRow(t.name)}>Delete</button
                  >
                {:else if t.name === DEFAULT_DELEGATION_TEAM_NAME && t.source === "db"}
                  <button
                    type="button"
                    class="text-xs text-zinc-500 hover:underline"
                    onclick={() => void deleteTeamRow(t.name)}>Reset default</button
                  >
                {/if}
              </li>
            {/each}
          </ul>
        </div>
        {#if hoverAgent}
          <pre
            class="max-h-32 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-2 text-xs text-zinc-400 whitespace-pre-wrap">{hoverAgent.body ?? ''}</pre>
        {:else if hoverTeam}
          <pre
            class="max-h-32 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-2 text-xs text-zinc-400 whitespace-pre-wrap">{hoverTeam.promptTemplate ?? hoverTeam.body ?? ''}</pre>
        {/if}

        {#if edAgent}
          <div class="space-y-2 rounded border border-zinc-700 bg-zinc-950/80 p-2 text-xs">
            <div class="font-medium text-zinc-200">Edit agent: {edAgent}</div>
            <label class="block text-zinc-500" for="ed-agent-desc">Description</label>
            <input
              id="ed-agent-desc"
              class="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
              bind:value={edAgentDescription}
            />
            <label class="block text-zinc-500" for="ed-agent-tools">Tools</label>
            <input
              id="ed-agent-tools"
              class="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
              bind:value={edAgentTools}
            />
            <label class="block text-zinc-500" for="ed-agent-model">Model</label>
            <input
              id="ed-agent-model"
              class="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
              bind:value={edAgentModel}
            />
            <label class="block text-zinc-500" for="ed-agent-body">Body (markdown)</label>
            <textarea
              id="ed-agent-body"
              class="h-32 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
              bind:value={edAgentBody}
            ></textarea>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="rounded bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-50"
                disabled={edAgentSaving}
                onclick={() => void saveAgentEditor()}>Save</button
              >
              <button
                type="button"
                class="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-300"
                onclick={() => void revertAgentEditor()}>Revert / remove stored</button
              >
              <button
                type="button"
                class="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-300"
                onclick={closeAgentEditor}>Close</button
              >
            </div>
          </div>
        {/if}

        {#if edTeam}
          <div class="space-y-2 rounded border border-zinc-700 bg-zinc-950/80 p-2 text-xs">
            <div class="font-medium text-zinc-200">Edit team: {edTeam}</div>
            <label class="block text-zinc-500" for="ed-team-desc">Description</label>
            <input
              id="ed-team-desc"
              class="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
              bind:value={edTeamDescription}
            />
            <label class="block text-zinc-500" for="ed-team-dispatch">Dispatch</label>
            <select
              id="ed-team-dispatch"
              class="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
              bind:value={edTeamDispatch}
            >
              <option value="parallel">parallel</option>
              <option value="sequential">sequential</option>
            </select>
            <label class="block text-zinc-500" for="ed-team-members">Members (comma-separated)</label>
            <input
              id="ed-team-members"
              class="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
              bind:value={edTeamMembers}
            />
            <label class="block text-zinc-500" for="ed-team-prompt">Prompt template</label>
            <textarea
              id="ed-team-prompt"
              class="h-28 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
              bind:value={edTeamPrompt}
            ></textarea>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="rounded bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-50"
                disabled={edTeamSaving}
                onclick={() => void saveTeamEditor()}>Save</button
              >
              <button
                type="button"
                class="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-300"
                onclick={closeTeamEditor}>Close</button
              >
            </div>
          </div>
        {/if}
      </div>
    {:else if tab === "build"}
      <div class="space-y-2 text-xs">
        <label class="block text-zinc-500" for="agents-build-name">Name</label>
        <input
          id="agents-build-name"
          class="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
          bind:value={buildName}
        />
        <label class="block text-zinc-500" for="agents-build-desc">Description</label>
        <input
          id="agents-build-desc"
          class="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
          bind:value={buildDesc}
        />
        <label class="block text-zinc-500" for="agents-build-dispatch">Dispatch</label>
        <select
          id="agents-build-dispatch"
          class="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
          bind:value={buildMode}
        >
          <option value="parallel">parallel</option>
          <option value="sequential">sequential</option>
        </select>
        <label class="block text-zinc-500" for="agents-build-members"
          >Members (comma-separated agent names)</label
        >
        <input
          id="agents-build-members"
          class="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
          bind:value={buildMembers}
          placeholder="researcher, my-agent"
        />
        <label class="block text-zinc-500" for="agents-build-prompt">Prompt template (optional)</label>
        <textarea
          id="agents-build-prompt"
          class="h-24 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
          bind:value={buildPrompt}
          placeholder={'Task: {{title}} — {{description}}, {{fileRefs}}'}
        ></textarea>
        <button
          type="button"
          class="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          disabled={buildLoading || !buildName.trim() || !buildMembers.trim()}
          onclick={() => void submitTeam()}>Save team</button
        >
      </div>
    {:else}
      <div class="space-y-2 text-xs">
        <p class="text-zinc-500">Names must differ from the three built-in roles (researcher, coder, reviewer).</p>
        <label class="block text-zinc-500" for="na-name">Name</label>
        <input
          id="na-name"
          class="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
          bind:value={naName}
        />
        <label class="block text-zinc-500" for="na-desc">Description</label>
        <input
          id="na-desc"
          class="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
          bind:value={naDesc}
        />
        <label class="block text-zinc-500" for="na-tools">Tools</label>
        <input
          id="na-tools"
          class="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
          bind:value={naTools}
        />
        <label class="block text-zinc-500" for="na-model">Model</label>
        <input
          id="na-model"
          class="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
          bind:value={naModel}
        />
        <label class="block text-zinc-500" for="na-body">Body (markdown)</label>
        <textarea
          id="na-body"
          class="h-32 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
          bind:value={naBody}
        ></textarea>
        <button
          type="button"
          class="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          disabled={naLoading || !naName.trim() || !naBody.trim()}
          onclick={() => void submitNewAgent()}>Create agent</button
        >
      </div>
    {/if}
  </div>
</div>
