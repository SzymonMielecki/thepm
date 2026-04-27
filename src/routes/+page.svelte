<script lang="ts">
  import TranscriptFeed from "$lib/components/TranscriptFeed.svelte";
  import DraftQueue from "$lib/components/DraftQueue.svelte";
  import SpeakersPanel from "$lib/components/SpeakersPanel.svelte";
  import PrdEditor from "$lib/components/PrdEditor.svelte";
  import AgentTrace from "$lib/components/AgentTrace.svelte";
  import ConnectedCapture from "$lib/components/ConnectedCapture.svelte";
  import HubBrandNav from "$lib/components/HubBrandNav.svelte";
  import ToastStack from "$lib/components/ToastStack.svelte";
  import ExpandableBlockHeader from "$lib/components/ExpandableBlockHeader.svelte";
  import type { CaptureClientInfo } from "$lib/capture-types";
  import { onDestroy, onMount } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { browser } from "$app/environment";
  import type { PageData } from "./$types";
  import type { HubPageDataFields } from "$lib/types/hub-ui";
  import {
    clientHubTokenFromPageData,
    persistHubToken,
  } from "$lib/client/hub-token";
  import { isStubOrEmptyPrd } from "$lib/prd/is-stub-or-empty";

  const AGENT_TRACES_STORAGE_KEY = "pm-hub:agent-traces-v1";

  let { data }: { data: PageData & HubPageDataFields } = $props();

  let token = $state("");
  let prd = $state("");
  let proposed = $state("");
  let transcriptLines: { speakerId: string | null; text: string; t: number }[] =
    $state([]);
  let traces: { phase: string; detail: string; t: number }[] = $state([]);
  /** Avoid overwriting sessionStorage before traces are restored on mount. */
  let tracePersistenceReady = $state(false);
  let drafts: {
    id: string;
    title: string;
    description: string;
    state: string;
    assigneeHint?: string | null;
    assigneeUserId?: string | null;
    linearIdentifier?: string | null;
    linearUrl?: string | null;
  }[] = $state([]);
  let speakerMappings = $state(
    [] as {
      sessionId: string;
      speakerId: string;
      displayName: string | null;
      linearUserId: string | null;
      linearName: string | null;
      updatedAt: string;
    }[],
  );
  let observedSpeakerIds = $state([] as string[]);
  let speakerSessionId = $state<string | null>(null);
  let linearUsers = $state([] as { id: string; name: string; email: string }[]);
  let speakerNames = $derived.by(() => {
    const out: Record<string, string> = {};
    for (const m of speakerMappings) {
      if (m.displayName?.trim()) out[m.speakerId] = m.displayName.trim();
      else if (m.linearName?.trim()) out[m.speakerId] = m.linearName.trim();
    }
    return out;
  });
  let captureDevices: CaptureClientInfo[] = $state([]);
  /** clientId → bar heights 0..1 for live capture waveform (SSE) */
  let captureWaveforms: Record<string, number[]> = $state({});
  let eventSrc: EventSource | null = null;
  let prdLoadError = $state("");
  /** Hub-resolved file path for the document shown (local disk or bridge’s `--prd` path) */
  let prdFilePath = $state("");
  /** True while the PRD textarea is focused — avoid SSE overwrites that reset the editor. */
  let prdEditing = $state(false);
  /** Last PRD content known to match the file (load, save, or applied SSE). Used to detect unsaved edits. */
  let prdSyncedContent = $state("");
  /** With hub token: overlay PRD block while fetching or waiting for bridge PRD bootstrap. */
  let prdBlockLoading = $state(false);
  let tokenDraft = $state("");
  let tokenModalOpen = $state(false);
  let draftGenModalOpen = $state(false);
  let draftGenPrompt = $state("");
  let draftGenLoading = $state(false);
  type HubExpandedPanel =
    | "transcript"
    | "drafts"
    | "prd"
    | "agent"
    | "speakers"
    | null;
  let expandedHubPanel = $state<HubExpandedPanel>(null);
  let muxCap = $state({ flavor: "none", session: undefined as string | undefined });
  let delegationsReloadKey = $state(0);
  let toasts = $state(
    [] as { id: number; kind: "success" | "error" | "info"; message: string }[],
  );
  let nextToastId = 1;
  let hydrated = $state(false);
  let bridgeConnected = $state(false);
  let hasUiAuth = $derived(!!token.trim());

  function authHeader() {
    return { Authorization: token ? `Bearer ${token}` : "" } as Record<
      string,
      string
    >;
  }

  function pushToast(
    kind: "success" | "error" | "info",
    message: string,
    timeoutMs = 2800,
  ) {
    const id = nextToastId++;
    toasts = [...toasts, { id, kind, message }];
    setTimeout(() => {
      dismissToast(id);
    }, timeoutMs);
  }

  function dismissToast(id: number) {
    toasts = toasts.filter((t) => t.id !== id);
  }

  async function parseApiError(response: Response) {
    try {
      const body = (await response.json()) as {
        error?: string;
        detail?: string;
        message?: string;
      };
      return (
        body.detail ||
        body.message ||
        body.error ||
        `Request failed (${response.status})`
      );
    } catch {
      return `Request failed (${response.status})`;
    }
  }

  async function loadPrd() {
    prdLoadError = "";
    const r = await fetch("/api/prd", { headers: authHeader() });
    if (r.ok) {
      const j = (await r.json()) as {
        content: string;
        prdFilePath?: string;
        prdBootstrap?: "off" | "if_empty" | "always";
      };
      prd = j.content;
      prdSyncedContent = j.content;
      if (j.prdFilePath) prdFilePath = j.prdFilePath;
      bridgeConnected = true;
      const mode = j.prdBootstrap ?? "if_empty";
      const stub = isStubOrEmptyPrd(j.content);
      if (!stub || mode === "off") {
        prdBlockLoading = false;
      } else {
        prdBlockLoading = true;
      }
      return;
    }
    prdBlockLoading = false;
    try {
      const j = (await r.json()) as { error?: string; detail?: string };
      if (j?.detail) {
        prdLoadError = j.detail;
        if (j.detail.toLowerCase().includes("bridge is not connected")) {
          bridgeConnected = false;
        }
      } else {
        prdLoadError = `PRD request failed (${r.status})`;
      }
    } catch {
      prdLoadError = `PRD request failed (${r.status})`;
    }
  }

  async function loadDrafts() {
    const r = await fetch("/api/tickets", { headers: authHeader() });
    if (r.ok) {
      const j = (await r.json()) as {
        drafts: {
          id: string;
          title: string;
          description: string;
          state: string;
          assignee_hint?: string | null;
          assignee_user_id?: string | null;
          linear_identifier?: string | null;
          linear_url?: string | null;
        }[];
      };
      drafts = j.drafts.map((d) => ({
        id: d.id,
        title: d.title,
        description: d.description,
        state: d.state,
        assigneeHint: d.assignee_hint ?? null,
        assigneeUserId: d.assignee_user_id ?? null,
        linearIdentifier: d.linear_identifier ?? null,
        linearUrl: d.linear_url ?? null,
      }));
    }
  }

  async function loadTranscripts() {
    const r = await fetch("/api/transcripts", { headers: authHeader() });
    if (r.ok) {
      const j = (await r.json()) as {
        lines: { speakerId: string | null; text: string; t: number }[];
      };
      transcriptLines = j.lines.slice(-200);
    }
  }

  async function loadCaptureClients() {
    const r = await fetch("/api/capture/clients", { headers: authHeader() });
    if (r.ok) {
      const j = (await r.json()) as { devices: CaptureClientInfo[] };
      captureDevices = j.devices;
    }
  }

  async function loadSpeakerMappings() {
    const r = await fetch("/api/speakers", { headers: authHeader() });
    if (!r.ok) return;
    const j = (await r.json()) as {
      sessionId: string | null;
      observedSpeakerIds: string[];
      speakers: (typeof speakerMappings)[0][];
    };
    speakerSessionId = j.sessionId;
    observedSpeakerIds = j.observedSpeakerIds ?? [];
    speakerMappings = j.speakers ?? [];
  }

  async function loadLinearUsers() {
    const r = await fetch("/api/linear/users", { headers: authHeader() });
    if (!r.ok) return;
    const j = (await r.json()) as { users: (typeof linearUsers)[0][] };
    linearUsers = j.users ?? [];
  }

  async function loadAgentsMux() {
    if (!token.trim()) return;
    const r = await fetch("/api/agents", { headers: authHeader() });
    if (!r.ok) return;
    const j = (await r.json()) as {
      mux?: { flavor: string; session?: string };
    };
    if (j.mux) muxCap = { flavor: j.mux.flavor, session: j.mux.session };
  }

  async function saveSpeakerMapping(payload: {
    sessionId: string;
    speakerId: string;
    displayName: string | null;
    linearUserId: string | null;
    linearName: string | null;
  }) {
    const r = await fetch("/api/speakers", {
      method: "PATCH",
      headers: { "content-type": "application/json", ...authHeader() },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      pushToast("error", await parseApiError(r));
      return;
    }
    pushToast("success", "Speaker mapping saved.");
    await loadSpeakerMappings();
    await loadDrafts();
  }

  $effect(() => {
    if (!browser || !expandedHubPanel) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") expandedHubPanel = null;
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  });

  $effect(() => {
    if (!browser || !tracePersistenceReady) return;
    try {
      sessionStorage.setItem(AGENT_TRACES_STORAGE_KEY, JSON.stringify(traces));
    } catch {
      /* quota, private mode, etc. */
    }
  });

  function connectSse() {
    eventSrc?.close();
    const u = new URL("/api/events", location.origin);
    if (token) u.searchParams.set("token", token);
    eventSrc = new EventSource(u.toString());
    eventSrc.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data) as { type: string; [k: string]: unknown };
        if (e.type === "transcript") {
          transcriptLines = [
            ...transcriptLines,
            {
              speakerId: e.speakerId as string | null,
              text: e.text as string,
              t: Date.now(),
            },
          ].slice(-200);
          void loadSpeakerMappings();
        } else if (
          e.type === "agent_trace" ||
          (e as { type: string }).type === "stt" ||
          (e as { type: string }).type === "stt_partial"
        ) {
          if (e.type === "agent_trace") {
            const phase = (e as { phase?: string }).phase ?? "";
            const detail = String((e as { detail?: string }).detail ?? "");
            if (
              phase === "prd_bootstrap" &&
              detail &&
              !detail.startsWith("start ")
            ) {
              prdBlockLoading = false;
            }
          }
          traces = [
            ...traces,
            {
              phase:
                (e as { phase?: string }).phase ?? (e as { type: string }).type,
              detail: String((e as { detail?: string }).detail ?? ""),
              t: Date.now(),
            },
          ].slice(-80);
        } else if (e.type === "prd") {
          const next = e.content as string;
          if (prdBlockLoading && !isStubOrEmptyPrd(next)) {
            prdBlockLoading = false;
          }
          if (!prdEditing && next !== prd) {
            prd = next;
            prdSyncedContent = next;
          }
        } else if (e.type === "prd_proposed") {
          const pe = e as unknown as { section: string; body: string };
          proposed = `${pe.section}:\n${pe.body}`;
        } else if (e.type === "draft") {
          void loadDrafts();
        } else if (e.type === "delegation" || e.type === "delegation_status") {
          delegationsReloadKey += 1;
          const term =
            e.type === "delegation" &&
            ((e as { status?: string }).status === "succeeded" ||
              (e as { status?: string }).status === "failed");
          if (term) {
            pushToast(
              "info",
              `Delegation ${(e as { status?: string }).status ?? "updated"}`,
              4000,
            );
          }
        } else if (e.type === "capture_devices") {
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
        } else if (e.type === "capture_waveform") {
          const p = e as unknown as { clientId: string; levels: number[] };
          if (
            typeof p.clientId === "string" &&
            Array.isArray(p.levels) &&
            p.levels.length
          ) {
            captureWaveforms = { ...captureWaveforms, [p.clientId]: p.levels };
          }
        }
      } catch {
        // ignore
      }
    };
  }

  async function copyHubToken() {
    if (!token.trim()) return;
    try {
      await navigator.clipboard.writeText(token);
      pushToast("success", "Bridge token copied.");
    } catch (e) {
      pushToast(
        "error",
        `Could not copy token: ${(e as Error).message || "clipboard unavailable"}`,
      );
    }
  }

  function openTokenModal() {
    tokenDraft = token;
    tokenModalOpen = true;
  }

  function saveTokenFromModal() {
    token = tokenDraft.trim();
    persistHubToken(token);
    tokenModalOpen = false;
    pushToast(
      "success",
      token ? "Bridge token saved." : "Bridge token cleared.",
    );
    void loadAgentsMux();
  }

  async function refreshPrd() {
    if (prd !== prdSyncedContent) {
      const ok = confirm(
        "You have unsaved edits to the PRD. Refresh loads the file from disk and discards those edits. Continue?",
      );
      if (!ok) return;
    }
    await loadPrd();
    if (prdLoadError) {
      pushToast("error", `Refresh failed: ${prdLoadError}`);
      return;
    }
    pushToast("success", "PRD refreshed.");
  }

  async function savePrd() {
    const r = await fetch("/api/prd", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader() },
      body: JSON.stringify({ fullContent: prd }),
    });
    if (!r.ok) {
      pushToast("error", await parseApiError(r));
      return;
    }
    const j = (await r.json()) as { content: string };
    prd = j.content;
    prdSyncedContent = j.content;
    pushToast("success", "PRD saved.");
  }

  function openDraftGenModal() {
    draftGenPrompt = "";
    draftGenModalOpen = true;
  }

  async function submitDraftGen() {
    const prompt = draftGenPrompt.trim();
    if (!prompt || draftGenLoading) return;
    draftGenLoading = true;
    try {
      const r = await fetch("/api/tickets/generate", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeader() },
        body: JSON.stringify({ prompt }),
      });
      if (!r.ok) {
        pushToast("error", await parseApiError(r));
        return;
      }
      draftGenModalOpen = false;
      draftGenPrompt = "";
      pushToast("success", "Draft generated.");
      await loadDrafts();
    } finally {
      draftGenLoading = false;
    }
  }

  onMount(() => {
    try {
      const raw = sessionStorage.getItem(AGENT_TRACES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as typeof traces;
        if (Array.isArray(parsed) && parsed.length) {
          traces = parsed.slice(-80);
        }
      }
    } catch {
      /* ignore */
    }
    tracePersistenceReady = true;

    token = clientHubTokenFromPageData(data);
    bridgeConnected = data.bridgeReady;
    try {
      const fromQuery = new URL(location.href).searchParams.get("token");
      if (fromQuery && fromQuery.trim()) {
        token = fromQuery.trim();
        persistHubToken(token);
      }
    } catch {
      /* ignore */
    }
    if (token.trim()) {
      prdBlockLoading = true;
    }
    connectSse();
    void loadPrd();
    void loadDrafts();
    void (async () => {
      await loadTranscripts();
      await loadCaptureClients();
      await loadSpeakerMappings();
      await loadLinearUsers();
      await loadAgentsMux();
    })();
    hydrated = true;
  });

  onDestroy(() => {
    eventSrc?.close();
  });

  const hubExpandedShellClass =
    "hub-expanded-in fixed z-50 flex max-h-[calc(100dvh-6.5rem)] min-h-0 flex-col gap-2 overflow-hidden rounded-xl bg-zinc-950/98 p-3 shadow-2xl sm:max-h-[calc(100dvh-7rem)] sm:p-4 left-[max(1.5rem,6vw)] right-[max(1.5rem,6vw)] top-[max(5.25rem,10vh)] bottom-[max(1.5rem,5vh)] sm:left-[max(2.25rem,8vw)] sm:right-[max(2.25rem,8vw)] sm:top-24 sm:bottom-[max(1.75rem,6vh)] md:left-[max(3rem,10vw)] md:right-[max(3rem,10vw)]";
</script>

<svelte:head>
  <title>thepm</title>
</svelte:head>

<div
  class="pointer-events-none fixed left-1/2 top-20 z-[100] flex w-[min(42rem,calc(100vw-1.5rem))] -translate-x-1/2 flex-col gap-2"
  aria-live="polite"
>
  {#if !bridgeConnected}
    <div
      class="pointer-events-auto rounded border border-amber-600 bg-amber-950 px-3 py-2 text-sm text-amber-100 shadow-2xl"
      in:fly={{ y: -10, duration: 200 }}
      out:fly={{ y: -8, duration: 150 }}
    >
      <strong>Code bridge</strong> is not connected. The hub cannot read the
      repo or PRD from your machine. Run
      <code>thepm bridge --help</code> with the same <code>--hub-url</code>,
      then paste the active bridge token (or open the printed dashboard URL with
      <code>?token=</code>), then refresh this page to reconnect.
    </div>
  {/if}
  {#if prdLoadError}
    <div
      class="pointer-events-auto rounded border border-rose-700 bg-rose-950 px-3 py-2 text-xs text-rose-50 shadow-2xl"
      in:fly={{ y: -10, duration: 200 }}
      out:fly={{ y: -8, duration: 150 }}
    >
      <strong>PRD</strong> could not be loaded: {prdLoadError}
    </div>
  {/if}
</div>

<div class="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
  <header class="shrink-0 border-b border-zinc-800 px-4 py-3">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <HubBrandNav />
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <div class="flex flex-wrap items-center gap-1 text-zinc-500">
          <span>Bridge token</span>
          <button
            type="button"
            class="rounded border border-zinc-600 px-2 py-0.5 text-zinc-300"
            onclick={openTokenModal}>Edit</button
          >
          <button
            type="button"
            class="rounded border border-zinc-600 px-2 py-0.5 text-zinc-300"
            disabled={!token.trim()}
            onclick={() => void copyHubToken()}>Copy</button
          >
        </div>
      </div>
    </div>
    {#if hydrated && !hasUiAuth}
      <div
        class="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-200"
      >
        Open the dashboard using the URL with <code>?token=</code> printed by
        <code>thepm bridge</code>, or paste the active bridge token above.
      </div>
    {/if}
    {#if !data.flags.eleven}
      <div
        class="mt-2 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-rose-200"
      >
        <strong>ELEVENLABS_API_KEY</strong> is required for streaming STT.
      </div>
    {/if}
    {#if !data.flags.linear}
      <div
        class="mt-2 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-amber-100/90"
      >
        <strong>LINEAR_API_KEY / LINEAR_TEAM_ID</strong> (or
        <strong>--linear-api-key</strong> / <strong>--linear-team-id</strong> on
        <strong>thepm</strong>) are required to push tickets.
      </div>
    {/if}
    {#if !data.flags.llm}
      <div
        class="mt-2 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-rose-200"
      >
        Configure <strong>LLM_PROVIDER</strong> and keys (<strong
          >ANTHROPIC_API_KEY</strong
        >
        /
        <strong>OPENAI_API_KEY</strong>) or use local <strong>ollama</strong>
        with
        <strong>OLLAMA_MODEL</strong>.
      </div>
    {/if}
    <div class="mt-3 px-0">
      <ConnectedCapture devices={captureDevices} waveforms={captureWaveforms} />
    </div>
  </header>

  <main
    class="grid min-h-0 w-full min-w-0 flex-1 grid-cols-1 gap-2 overflow-hidden p-2 max-lg:grid-rows-[minmax(0,13rem)_minmax(0,13rem)_minmax(0,1fr)_minmax(0,28vh)] sm:max-lg:grid-rows-[minmax(0,15rem)_minmax(0,15rem)_minmax(0,1fr)_minmax(0,28vh)] lg:grid-cols-3 lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)_auto]"
  >
    <div
      class="flex max-lg:row-start-1 max-lg:row-end-2 h-full min-h-0 min-w-0 w-full flex-col overflow-hidden lg:col-start-1 lg:row-start-1 lg:row-end-3"
    >
      {#if expandedHubPanel === "transcript"}
        <div
          class="flex h-full min-h-0 w-full flex-col gap-2 lg:flex-1"
          aria-hidden="true"
        ></div>
      {/if}
      <section
        class={expandedHubPanel === "transcript"
          ? hubExpandedShellClass
          : "flex h-full min-h-0 max-h-full w-full flex-col gap-2 overflow-hidden lg:min-h-0"}
      >
        <ExpandableBlockHeader
          title="Transcript"
          expanded={expandedHubPanel === "transcript"}
          onexpand={() => (expandedHubPanel = "transcript")}
          onclose={() => (expandedHubPanel = null)}
        />
        <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <TranscriptFeed
            lines={transcriptLines}
            {speakerNames}
            frameless={expandedHubPanel === "transcript"}
          />
        </div>
      </section>
    </div>
    <div
      class="flex max-lg:row-start-2 max-lg:row-end-3 h-full min-h-0 min-w-0 w-full flex-col overflow-hidden lg:col-start-2 lg:row-start-1 lg:row-end-3"
    >
      {#if expandedHubPanel === "drafts"}
        <div
          class="flex h-full min-h-0 w-full flex-col gap-2 lg:flex-1"
          aria-hidden="true"
        ></div>
      {/if}
      <section
        class={expandedHubPanel === "drafts"
          ? hubExpandedShellClass
          : "flex h-full min-h-0 max-h-full w-full flex-col gap-2 overflow-hidden lg:min-h-0"}
      >
        <ExpandableBlockHeader
          title="Ticket drafts"
          expanded={expandedHubPanel === "drafts"}
          onexpand={() => (expandedHubPanel = "drafts")}
          onclose={() => (expandedHubPanel = null)}
        >
          {#snippet trailing()}
            <div class="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                class="inline-flex h-7 shrink-0 items-center justify-center rounded bg-blue-600 px-2.5 text-xs font-medium leading-none text-white"
                disabled={!bridgeConnected ||
                  !hasUiAuth ||
                  !data.flags.llm ||
                  draftGenLoading}
                onclick={openDraftGenModal}>Generate draft</button
              >
            </div>
          {/snippet}
        </ExpandableBlockHeader>
        <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <DraftQueue
            {drafts}
            token={token ?? ""}
            onupdate={loadDrafts}
            frameless={expandedHubPanel === "drafts"}
            delegateMuxOk={muxCap.flavor !== "none"}
            {bridgeConnected}
            ontoast={(kind: "success" | "error" | "info", message: string) =>
              pushToast(kind, message)}
          />
        </div>
      </section>
    </div>
    <div
      class="flex max-lg:row-start-3 max-lg:row-end-4 h-full min-h-0 min-w-0 w-full flex-col overflow-hidden lg:col-start-3 lg:row-start-1 lg:row-end-4"
    >
      {#if expandedHubPanel === "prd"}
        <div
          class="flex h-full min-h-0 min-w-0 w-full flex-col gap-2 lg:flex-1"
          aria-hidden="true"
        ></div>
      {/if}
      <section
        class={expandedHubPanel === "prd"
          ? hubExpandedShellClass
          : "flex h-full min-h-0 max-h-full min-w-0 w-full flex-col gap-2 overflow-hidden lg:min-h-0"}
      >
        <ExpandableBlockHeader
          title="PRD"
          expanded={expandedHubPanel === "prd"}
          onexpand={() => (expandedHubPanel = "prd")}
          onclose={() => (expandedHubPanel = null)}
        >
          {#snippet trailing()}
            <div class="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                class="inline-flex h-7 shrink-0 items-center justify-center rounded border border-zinc-600 px-2.5 text-xs leading-none text-zinc-300"
                disabled={!bridgeConnected || !hasUiAuth}
                onclick={() => {
                  void refreshPrd();
                }}>Refresh</button
              >
              <button
                type="button"
                class="inline-flex h-7 shrink-0 items-center justify-center rounded bg-blue-600 px-2.5 text-xs font-medium leading-none text-white"
                disabled={!bridgeConnected || !hasUiAuth}
                onclick={() => {
                  void savePrd();
                }}>Save PRD</button
              >
            </div>
          {/snippet}
        </ExpandableBlockHeader>
        <div class="relative h-full min-h-0 flex-1">
          {#if prdBlockLoading && hasUiAuth}
            <div
              class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/90 px-4 text-center"
              role="status"
              aria-live="polite"
              aria-busy="true"
            >
              <div
                class="h-8 w-8 shrink-0 animate-spin rounded-full border-2 border-zinc-600 border-t-blue-500"
              ></div>
              <p class="text-xs text-zinc-400">Loading PRD…</p>
            </div>
          {/if}
          <div
            class={prdBlockLoading && hasUiAuth
              ? "pointer-events-none h-full min-h-0 opacity-40"
              : "h-full min-h-0"}
          >
            <PrdEditor
              bind:content={prd}
              bind:proposed
              bind:editing={prdEditing}
              pathLabel={prdFilePath}
              frameless={expandedHubPanel === "prd"}
            />
          </div>
        </div>
      </section>
    </div>
    <section
      class="grid min-h-0 w-full min-w-0 gap-2 max-lg:h-full max-lg:max-h-full max-lg:min-h-0 max-lg:overflow-hidden max-lg:row-start-4 max-lg:row-end-5 lg:col-span-2 lg:row-start-3 lg:row-end-4 lg:h-[30vh] lg:min-h-[30vh] lg:max-h-[30vh] lg:grid-cols-2"
    >
      <div
        class="relative flex h-full min-h-0 max-h-full w-full min-w-0 flex-col lg:h-[30vh] lg:min-h-[30vh] lg:max-h-[30vh]"
      >
        {#if expandedHubPanel === "agent"}
          <div
            class="flex h-full min-h-0 max-h-full flex-col gap-2 lg:h-[30vh] lg:min-h-[30vh] lg:max-h-[30vh]"
            aria-hidden="true"
          >
            <div class="h-6 shrink-0"></div>
            <div class="min-h-0 flex-1"></div>
          </div>
        {/if}
        <div
          class={expandedHubPanel === "agent"
            ? hubExpandedShellClass
            : "flex h-full min-h-0 w-full min-w-0 flex-col gap-2"}
        >
          <ExpandableBlockHeader
            title="Agent trace"
            expanded={expandedHubPanel === "agent"}
            onexpand={() => (expandedHubPanel = "agent")}
            onclose={() => (expandedHubPanel = null)}
          />
          <div
            class={expandedHubPanel === "agent"
              ? "min-h-0 flex-1"
              : "min-h-0 flex-1 overflow-hidden"}
          >
            <AgentTrace
              {traces}
              frameless={expandedHubPanel === "agent"}
            />
          </div>
        </div>
      </div>
      <div
        class="relative flex h-full min-h-0 max-h-full w-full min-w-0 flex-col lg:h-[30vh] lg:min-h-[30vh] lg:max-h-[30vh]"
      >
        {#if expandedHubPanel === "speakers"}
          <div
            class="flex h-full min-h-0 max-h-full flex-col gap-2 lg:h-[30vh] lg:min-h-[30vh] lg:max-h-[30vh]"
            aria-hidden="true"
          >
            <div class="h-6 shrink-0"></div>
            <div class="min-h-0 flex-1"></div>
          </div>
        {/if}
        <div
          class={expandedHubPanel === "speakers"
            ? hubExpandedShellClass
            : "flex h-full min-h-0 w-full min-w-0 flex-col gap-2"}
        >
          <ExpandableBlockHeader
            title="Speakers"
            expanded={expandedHubPanel === "speakers"}
            onexpand={() => (expandedHubPanel = "speakers")}
            onclose={() => (expandedHubPanel = null)}
          />
          <div
            class={expandedHubPanel === "speakers"
              ? "min-h-0 flex-1"
              : "min-h-0 flex-1 overflow-hidden"}
          >
            <SpeakersPanel
              sessionId={speakerSessionId}
              {observedSpeakerIds}
              mappings={speakerMappings}
              {linearUsers}
              frameless={expandedHubPanel === "speakers"}
              onsave={saveSpeakerMapping}
            />
          </div>
        </div>
      </div>
    </section>
  </main>
</div>

{#if expandedHubPanel}
  <div
    class="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px]"
    role="presentation"
    aria-hidden="true"
    transition:fade={{ duration: 180 }}
    onclick={() => (expandedHubPanel = null)}
  ></div>
{/if}

{#if draftGenModalOpen}
  <div
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
  >
    <div
      class="w-full max-w-xl rounded-lg border border-zinc-700 bg-zinc-900 p-4"
    >
      <h2 class="text-sm font-semibold text-zinc-100">Generate task draft</h2>
      <p class="mt-1 text-xs text-zinc-500">
        Describe the task. The agent uses your PRD and repository search (via
        the code bridge) for context.
      </p>
      <textarea
        class="mt-3 h-32 w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-100"
        bind:value={draftGenPrompt}
        placeholder="e.g. Add error handling when the tickets API returns 422…"
        disabled={draftGenLoading}
        autocomplete="off"
      ></textarea>
      <div class="mt-3 flex justify-end gap-2">
        <button
          type="button"
          class="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-300"
          disabled={draftGenLoading}
          onclick={() => {
            draftGenModalOpen = false;
          }}>Cancel</button
        >
        <button
          type="button"
          class="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
          disabled={draftGenLoading || !draftGenPrompt.trim()}
          onclick={() => void submitDraftGen()}>Generate</button
        >
      </div>
    </div>
  </div>
{/if}

{#if tokenModalOpen}
  <div
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
  >
    <div
      class="w-full max-w-xl rounded-lg border border-zinc-700 bg-zinc-900 p-4"
    >
      <h2 class="text-sm font-semibold text-zinc-100">Edit bridge token</h2>
      <p class="mt-1 text-xs text-zinc-500">
        Token is shown in plain text and saved in this browser.
      </p>
      <textarea
        class="mt-3 h-28 w-full rounded border border-zinc-700 bg-zinc-950 p-2 font-mono text-xs text-zinc-100"
        bind:value={tokenDraft}
        autocomplete="off"
        spellcheck="false"
      ></textarea>
      <div class="mt-3 flex justify-end gap-2">
        <button
          type="button"
          class="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-300"
          onclick={() => {
            tokenModalOpen = false;
          }}>Cancel</button
        >
        <button
          type="button"
          class="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white"
          onclick={saveTokenFromModal}>Save token</button
        >
      </div>
    </div>
  </div>
{/if}

<ToastStack {toasts} ondismiss={dismissToast} />
