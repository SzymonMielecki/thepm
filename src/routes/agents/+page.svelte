<script lang="ts">
  import AgentsPanel from "$lib/components/AgentsPanel.svelte";
  import LinearIssuesDelegate from "$lib/components/LinearIssuesDelegate.svelte";
  import HubBrandNav from "$lib/components/HubBrandNav.svelte";
  import ToastStack from "$lib/components/ToastStack.svelte";
  import { onDestroy, onMount } from "svelte";
  import type { PageData } from "./$types";
  import type { HubPageDataFields } from "$lib/types/hub-ui";
  import {
    clientHubTokenFromPageData,
    persistHubToken,
  } from "$lib/client/hub-token";

  let { data }: { data: PageData & HubPageDataFields } = $props();

  let token = $state("");
  let tokenDraft = $state("");
  let tokenModalOpen = $state(false);
  let muxCap = $state({ flavor: "none", session: undefined as string | undefined });
  /** False until `/api/agents` mux probe finishes (avoids flashing “no mux” before the response). */
  let muxCapReady = $state(false);
  let delegationsReloadKey = $state(0);
  let toasts = $state(
    [] as { id: number; kind: "success" | "error" | "info"; message: string }[],
  );
  let nextToastId = 1;
  let hydrated = $state(false);
  let bridgeConnected = $state(false);
  let hasUiAuth = $derived(!!token.trim());
  let delegateMuxOk = $derived(muxCap.flavor !== "none");
  let eventSrc: EventSource | null = null;

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

  async function probeBridge() {
    if (!token.trim()) {
      bridgeConnected = false;
      return;
    }
    const r = await fetch("/api/prd", { headers: authHeader() });
    bridgeConnected = r.ok;
  }

  async function loadAgentsMux() {
    if (!token.trim()) {
      muxCap = { flavor: "none", session: undefined };
      muxCapReady = true;
      return;
    }
    muxCapReady = false;
    try {
      const r = await fetch("/api/agents", { headers: authHeader() });
      if (!r.ok) return;
      const j = (await r.json()) as {
        mux?: { flavor: string; session?: string };
      };
      if (j.mux) muxCap = { flavor: j.mux.flavor, session: j.mux.session };
    } finally {
      muxCapReady = true;
    }
  }

  function connectSse() {
    eventSrc?.close();
    const u = new URL("/api/events", location.origin);
    if (token) u.searchParams.set("token", token);
    eventSrc = new EventSource(u.toString());
    eventSrc.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data) as { type: string; status?: string };
        if (e.type === "delegation" || e.type === "delegation_status") {
          delegationsReloadKey += 1;
          const term =
            e.type === "delegation" &&
            (e.status === "succeeded" || e.status === "failed");
          if (term) {
            pushToast(
              "info",
              `Delegation ${e.status ?? "updated"}`,
              4000,
            );
          }
        }
      } catch {
        /* ignore */
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
    connectSse();
    void loadAgentsMux();
    void probeBridge();
  }

  onMount(() => {
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
    connectSse();
    void loadAgentsMux();
    void probeBridge();
    hydrated = true;
  });

  onDestroy(() => {
    eventSrc?.close();
  });
</script>

<svelte:head>
  <title>Agents · thepm</title>
</svelte:head>

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
        Paste the active bridge token above (or open the dashboard URL with
        <code>?token=</code> from <code>thepm bridge</code>) to load
        Linear issues, agents, and delegations.
      </div>
    {/if}
    {#if !bridgeConnected}
      <div
        class="mt-2 rounded border border-amber-600/50 bg-amber-950/40 px-2 py-1 text-xs text-amber-100"
      >
        <strong>Code bridge</strong> is not connected. Run
        <code>thepm bridge</code> with the same hub URL, then reconnect.
      </div>
    {/if}
  </header>

  <main
    class="grid min-h-0 min-w-0 flex-1 gap-2 overflow-hidden p-2 lg:grid-cols-2 lg:grid-rows-1"
  >
    <section
      class="flex min-h-[min(40vh,20rem)] min-w-0 flex-col gap-1 overflow-hidden lg:min-h-0"
    >
      <h2 class="shrink-0 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Linear team tasks
      </h2>
      <div class="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <LinearIssuesDelegate
          token={token ?? ""}
          linearConfigured={data.flags.linear}
          frameless={true}
          autoRefreshOnMount={true}
          delegateMuxOk={delegateMuxOk}
          {bridgeConnected}
          ontoast={(kind: "success" | "error" | "info", message: string) =>
            pushToast(kind, message)}
        />
      </div>
    </section>
    <section class="flex min-h-0 min-w-0 flex-col overflow-hidden">
      <h2 class="shrink-0 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Catalog & delegations
      </h2>
      <div class="min-h-0 flex-1 overflow-hidden pt-1">
        <AgentsPanel
          token={token ?? ""}
          mux={muxCap}
          muxReady={hydrated && muxCapReady}
          reloadKey={delegationsReloadKey}
          frameless={true}
          ontoast={(kind: "success" | "error" | "info", message: string) =>
            pushToast(kind, message)}
        />
      </div>
    </section>
  </main>
</div>

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
