<script lang="ts">
  import TranscriptFeed from "$lib/components/TranscriptFeed.svelte";
  import DraftQueue from "$lib/components/DraftQueue.svelte";
  import PrdEditor from "$lib/components/PrdEditor.svelte";
  import AgentTrace from "$lib/components/AgentTrace.svelte";
  import ConnectedCapture from "$lib/components/ConnectedCapture.svelte";
  import ToastStack from "$lib/components/ToastStack.svelte";
  import type { CaptureClientInfo } from "$lib/capture-types";
  import { onDestroy, onMount } from "svelte";
  import { browser } from "$app/environment";
  import { invalidateAll } from "$app/navigation";
  import type { PageData } from "./$types";
  import type { HubPageDataFields } from "$lib/types/hub-ui";
  import {
    clientHubTokenFromPageData,
    persistHubToken,
  } from "$lib/client/hub-token";

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
  }[] = $state([]);
  let captureDevices: CaptureClientInfo[] = $state([]);
  /** clientId → bar heights 0..1 for live capture waveform (SSE) */
  let captureWaveforms: Record<string, number[]> = $state({});
  let eventSrc: EventSource | null = null;
  let prdLoadError = $state("");
  /** Hub-resolved file path for the document shown (local disk or bridge’s `--prd` path) */
  let prdFilePath = $state("");
  /** True while the PRD textarea is focused — avoid SSE overwrites that reset the editor. */
  let prdEditing = $state(false);
  let tokenDraft = $state("");
  let tokenModalOpen = $state(false);
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
      const body = (await response.json()) as { error?: string; detail?: string };
      return body.detail || body.error || `Request failed (${response.status})`;
    } catch {
      return `Request failed (${response.status})`;
    }
  }

  async function loadPrd() {
    prdLoadError = "";
    const r = await fetch("/api/prd", { headers: authHeader() });
    if (r.ok) {
      const j = (await r.json()) as { content: string; prdFilePath?: string };
      prd = j.content;
      if (j.prdFilePath) prdFilePath = j.prdFilePath;
      bridgeConnected = true;
      return;
    }
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
      const j = (await r.json()) as { drafts: (typeof drafts)[0][] };
      drafts = j.drafts;
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
        } else if (
          e.type === "agent_trace" ||
          (e as { type: string }).type === "stt" ||
          (e as { type: string }).type === "stt_partial"
        ) {
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
          if (!prdEditing && next !== prd) {
            prd = next;
          }
        } else if (e.type === "prd_proposed") {
          const pe = e as unknown as { section: string; body: string };
          proposed = `${pe.section}:\n${pe.body}`;
        } else if (e.type === "draft") {
          void loadDrafts();
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
    pushToast("success", token ? "Bridge token saved." : "Bridge token cleared.");
  }

  async function reconnectAndReload() {
    await loadPrd();
    await Promise.all([loadTranscripts(), loadCaptureClients()]);
    connectSse();
    await invalidateAll();
    if (prdLoadError) {
      pushToast("error", `Reconnect failed: ${prdLoadError}`);
      return;
    }
    pushToast("success", "Reconnected and reloaded.");
  }

  async function refreshPrd() {
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
    pushToast("success", "PRD saved.");
  }

  function isTypingTarget(t: EventTarget | null) {
    const n = t as HTMLElement | null;
    const name = n?.tagName;
    return name === "INPUT" || name === "TEXTAREA" || n?.isContentEditable;
  }

  function onKey(e: KeyboardEvent) {
    if (isTypingTarget(e.target)) return;
    if (e.key === "a" && drafts[0]?.state === "pending") {
      if (e.metaKey) return;
      void fetch(`/api/tickets/${drafts[0]!.id}/approve`, {
        method: "POST",
        headers: authHeader(),
      }).then((r) => {
        if (r.ok) {
          pushToast("success", "Draft approved and sent to Linear.");
          return loadDrafts();
        }
        pushToast("error", `Approve failed (${r.status}).`);
      });
    }
    if (e.key === "r" && drafts[0]?.state === "pending") {
      void fetch(`/api/tickets/${drafts[0]!.id}/reject`, {
        method: "POST",
        headers: authHeader(),
      }).then((r) => {
        if (r.ok) {
          pushToast("success", "Draft rejected.");
          return loadDrafts();
        }
        pushToast("error", `Reject failed (${r.status}).`);
      });
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
    void loadPrd();
    void loadDrafts();
    void (async () => {
      await loadTranscripts();
      await loadCaptureClients();
      connectSse();
    })();
    window.addEventListener("keydown", onKey);
    hydrated = true;
  });

  onDestroy(() => {
    eventSrc?.close();
    if (browser) {
      window.removeEventListener("keydown", onKey);
    }
  });
</script>

<svelte:head>
  <title>thepm</title>
</svelte:head>

<div class="flex min-h-0 w-full min-w-0 flex-1 flex-col">
  <header class="shrink-0 border-b border-zinc-800 px-4 py-3">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold tracking-tight">thepm</h1>
        <p class="text-xs text-zinc-500">
          Bridge-backed hub · <a
            href="/mobile"
            class="text-blue-400 hover:underline"
            target="_blank"
            rel="noopener noreferrer">Open mobile capture</a
          >
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <span
          class={`rounded border px-2 py-0.5 ${
            data.bridgeSessionActive || hasUiAuth
              ? "border-emerald-500/40 text-emerald-200"
              : "border-zinc-700 text-zinc-500"
          }`}
          >UI auth {data.bridgeSessionActive || hasUiAuth ? "active" : "inactive"}</span
        >
        <div class="flex flex-wrap items-center gap-1 text-zinc-500">
          <span>Bridge token</span>
          <button
            type="button"
            class="rounded border border-zinc-600 px-2 py-0.5 text-zinc-300"
            onclick={openTokenModal}
            >Edit</button
          >
          <button
            type="button"
            class="rounded border border-zinc-600 px-2 py-0.5 text-zinc-300"
            disabled={!token.trim()}
            onclick={() => void copyHubToken()}
            >Copy</button
          >
        </div>
        <button
          type="button"
          class="rounded border border-zinc-600 px-2 py-0.5 text-zinc-300"
          onclick={() => {
            void reconnectAndReload();
          }}>Reconnect / reload PRD</button
        >
      </div>
    </div>
    {#if !bridgeConnected}
      <div
        class="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-200"
      >
        <strong>Code bridge</strong> is not connected. The hub cannot read the
        repo or PRD from your machine. Run
        <code>thepm bridge --help</code> with the same <code>--hub-url</code>,
        then paste the active bridge token (or open the printed
        <code>bridge_session</code> URL), then click
        <em>Reconnect / reload PRD</em>.
      </div>
    {/if}
    {#if hydrated && !hasUiAuth}
      <div
        class="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-200"
      >
        Open the dashboard using the <code>bridge_session</code> URL printed by
        <code>thepm bridge</code>, or paste the active bridge token above.
      </div>
    {/if}
    {#if prdLoadError}
      <div
        class="mt-2 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-rose-100 text-xs"
      >
        <strong>PRD</strong> could not be loaded: {prdLoadError}
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
        <strong>LINEAR_API_KEY / LINEAR_TEAM_ID</strong> are required to push tickets.
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
    class="grid min-h-0 w-full min-w-0 flex-1 grid-cols-1 grid-rows-[auto_auto_minmax(0,auto)_1fr] gap-2 p-2 lg:grid-cols-3 lg:grid-rows-[auto_auto_1fr]"
  >
    <section
      class="flex h-52 min-h-0 max-lg:row-start-1 max-lg:row-end-2 flex-col sm:h-60 lg:col-start-1 lg:row-start-1 lg:row-end-3 lg:h-full lg:min-h-0"
    >
      <TranscriptFeed lines={transcriptLines} />
    </section>
    <section
      class="flex h-52 min-h-0 max-lg:row-start-2 max-lg:row-end-3 flex-col sm:h-60 lg:col-start-2 lg:row-start-1 lg:row-end-3 lg:h-full lg:min-h-0"
    >
      <DraftQueue
        {drafts}
        token={token ?? ""}
        onupdate={loadDrafts}
        ontoast={(
          kind: "success" | "error" | "info",
          message: string,
        ) => pushToast(kind, message)}
      />
    </section>
    <section
      class="flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden max-lg:min-h-[200px] max-lg:row-start-3 max-lg:row-end-4 lg:col-start-3 lg:row-start-1 lg:row-end-4"
    >
      {#if prdFilePath}
        <p class="shrink-0 text-xs leading-snug text-zinc-500">
          PRD content is read and written on the machine running <code
            class="text-zinc-400">thepm bridge</code
          > at the path above.
        </p>
      {/if}
      <div class="min-h-0 flex-1 h-full">
        <PrdEditor
          bind:content={prd}
          bind:proposed
          bind:editing={prdEditing}
          pathLabel={prdFilePath}
        />
      </div>
      <div class="flex shrink-0 flex-wrap justify-end gap-2">
        <button
          type="button"
          class="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-300"
          disabled={!bridgeConnected || !hasUiAuth}
          onclick={() => {
            void refreshPrd();
          }}>Refresh</button
        >
        <button
          type="button"
          class="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white"
          disabled={!bridgeConnected || !hasUiAuth}
          onclick={() => {
            void savePrd();
          }}>Save PRD</button
        >
      </div>
    </section>
    <section
      class="flex min-h-0 flex-col max-lg:row-start-4 max-lg:row-end-5 max-lg:min-h-0 lg:col-span-2 lg:row-start-3 lg:row-end-4"
    >
      <p class="mb-1 shrink-0 text-xs text-zinc-500">
        Agent trace (keyboard: a/r on first draft)
      </p>
      <div class="min-h-0 flex-1">
        <AgentTrace {traces} />
      </div>
    </section>
  </main>
</div>

{#if tokenModalOpen}
  <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
    <div class="w-full max-w-xl rounded-lg border border-zinc-700 bg-zinc-900 p-4">
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
