<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { browser } from "$app/environment";
  import { startPcm16kCapture, type PcmCapture } from "$lib/client/pcm-capture";
  import {
    hubTokenToSsePathSegment,
    hubTokenToWsSubprotocol,
  } from "$lib/client/hub-ws";
  import TranscriptFeed from "$lib/components/TranscriptFeed.svelte";
  import type { PageData } from "./$types";
  import type { HubPageDataFields } from "$lib/types/hub-ui";
  import {
    initMobileHubToken,
    persistMobileHubToken,
  } from "$lib/client/hub-token";

  let { data }: { data: PageData & HubPageDataFields } = $props();

  // Never read localStorage during SSR (Node may stub it without getItem).
  let token = $state("");
  let status = $state("idle") as "idle" | "listening" | "error";
  let err = $state("");
  let transcriptLines: { speakerId: string | null; text: string; t: number }[] =
    $state([]);
  let eventSrc: EventSource | null = null;
  /** Polling is a backstop: SSE is fragile through some PWA / proxy / EventSource paths. */
  let pollId: ReturnType<typeof setInterval> | null = null;
  let feedError = $state("");
  let pendingManual: string | null = null;
  let tokenDraft = $state("");
  let tokenModalOpen = $state(false);
  let notice = $state("");
  let hasUiAuth = $derived(!!token.trim());

  const wsPath = "/api/audio/stream";
  let session = $state("");
  let ws: WebSocket | null = null;
  let pcm: PcmCapture | null = null;

  function showNotice(
    text: string,
    kind: "ok" | "err" = "ok",
    timeoutMs = 2800,
  ) {
    if (!browser) return;
    if (kind === "err") {
      err = text;
      setTimeout(() => {
        if (err === text) err = "";
      }, timeoutMs);
    } else {
      notice = text;
      setTimeout(() => {
        if (notice === text) notice = "";
      }, timeoutMs);
    }
  }

  function authHeader() {
    return { Authorization: token ? `Bearer ${token}` : "" } as Record<
      string,
      string
    >;
  }

  function openTokenModal() {
    tokenDraft = token;
    tokenModalOpen = true;
  }

  function saveTokenFromModal() {
    token = tokenDraft.trim();
    persistMobileHubToken(token);
    tokenModalOpen = false;
    showNotice(
      token ? "Bridge token saved." : "Bridge token cleared.",
    );
  }

  async function loadTranscripts() {
    if (!hasUiAuth) {
      feedError = "Open from a bridge session URL or provide the active bridge token";
      return;
    }
    feedError = "";
    const r = await fetch("/api/transcripts", { headers: authHeader() });
    if (r.ok) {
      const j = (await r.json()) as {
        lines: { speakerId: string | null; text: string; t: number }[];
      };
      transcriptLines = j.lines.slice(-200);
    } else if (r.status === 401) {
      feedError = "Bridge token rejected (check it matches an active bridge connection).";
    } else {
      let detail = "";
      try {
        const j = (await r.json()) as { error?: string; hint?: string };
        if (typeof j.error === "string") detail = j.error;
        if (typeof j.hint === "string")
          detail = detail ? `${detail} ${j.hint}` : j.hint;
      } catch {
        /* plain text or empty body */
      }
      feedError = detail
        ? `Transcript request failed (${r.status}): ${detail}`
        : `Transcript request failed (${r.status})`;
    }
  }

  function appendTranscriptLine(speakerId: string | null, text: string) {
    transcriptLines = [
      ...transcriptLines,
      { speakerId, text, t: Date.now() },
    ].slice(-200);
  }

  function startTranscriptPoll() {
    if (pollId) {
      clearInterval(pollId);
      pollId = null;
    }
    if (!browser) return;
    if (!hasUiAuth) return;
    pollId = setInterval(() => {
      void loadTranscripts();
    }, 3500);
  }

  function connectSse() {
    if (!browser) return;
    eventSrc?.close();
    if (!hasUiAuth) return;
    let src: string;
    if (!token.trim()) {
      src = new URL("/api/events", location.origin).toString();
    } else {
      // Path-based token: EventSource has no `Authorization`; `?token=` can be dropped by proxies.
      const u = new URL(location.origin);
      u.pathname = "/api/events/hub/" + hubTokenToSsePathSegment(token);
      src = u.toString();
    }
    eventSrc = new EventSource(src);
    eventSrc.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data) as { type: string; [k: string]: unknown };
        if (e.type === "transcript") {
          feedError = "";
          appendTranscriptLine(e.speakerId as string | null, e.text as string);
        }
      } catch {
        // ignore
      }
    };
    eventSrc.onerror = () => {
      if (hasUiAuth) {
        feedError =
          "Live SSE failed (transcript still refreshes on a short poll). If this persists, reload the app.";
      }
    };
  }

  async function reconnectFeed() {
    await loadTranscripts();
    connectSse();
    startTranscriptPoll();
    if (feedError) {
      return;
    }
    showNotice("Live transcript connected.");
  }

  function sendAudioChunk(b64: string) {
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: b64,
        commit: false,
        sample_rate: 16000,
      }),
    );
  }

  function sendWaveformLevels(levels: number[]) {
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "waveform", levels }));
  }

  function connectWs() {
    if (!browser) return;
    ws?.close();
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const q = new URLSearchParams();
    if (token) q.set("token", token);
    if (session) q.set("session", session);
    const finalUrl = `${scheme}://${location.host}${wsPath}?${q.toString()}`;

    const sub = token.trim()
      ? ([hubTokenToWsSubprotocol(token)] as string[])
      : undefined;
    ws = sub ? new WebSocket(finalUrl, sub) : new WebSocket(finalUrl);
    ws.binaryType = "arraybuffer";
    ws.onmessage = (ev) => {
      try {
        const j = JSON.parse(ev.data as string) as {
          type: string;
          sessionId?: string;
          error?: string;
        };
        if (j.type === "session" && j.sessionId) {
          session = j.sessionId;
          localStorage.setItem("pmSession", j.sessionId);
        } else if (j.type === "stt_upstream_error") {
          err = j.error ?? "Speech-to-text error from provider";
        } else if (j.type === "stt_unavailable" || j.type === "error") {
          err = j.error ?? String(ev.data);
          status = "error";
        } else if (j.type === "final_acked" || j.type === "config_acked") {
          err = "";
          if (j.type === "final_acked" && pendingManual) {
            appendTranscriptLine(null, pendingManual);
            pendingManual = null;
          }
        } else if (j.type === "final_failed" && j.error) {
          pendingManual = null;
          err = j.error;
          status = "error";
        }
      } catch {
        // binary
      }
    };
    ws.onerror = () => {
      err = "WebSocket error";
      status = "error";
    };
    ws.onclose = (ev) => {
      if (ev.code === 4001) {
        err =
          "Hub rejected the token. Use the active bridge token from `thepm bridge` output.";
        status = "error";
      }
    };
  }

  /** Open hub WebSocket and wait (like Record) but do not use the mic — for manual line only. */
  async function ensureWsForManual(): Promise<boolean> {
    if (!browser) return false;
    if (ws?.readyState === WebSocket.OPEN) return true;
    if (!hasUiAuth) {
      err = "Bridge session or bridge token required";
      status = "error";
      return false;
    }
    if (browser) {
      session = localStorage.getItem("pmSession") || session;
    }
    connectWs();
    try {
      await new Promise<void>((res, rej) => {
        const t = setTimeout(() => rej(new Error("WS timeout")), 8000);
        if (!ws) {
          clearTimeout(t);
          rej(new Error("no ws"));
          return;
        }
        ws.addEventListener("open", () => {
          clearTimeout(t);
          res();
        });
        ws.addEventListener("error", () => {
          clearTimeout(t);
          rej(new Error("ws"));
        });
      });
    } catch (e) {
      err = (e as Error).message;
      status = "error";
      return false;
    }
    return true;
  }

  async function start() {
    err = "";
    status = "listening";
    if (browser) {
      session = localStorage.getItem("pmSession") || session;
    }
    if (!hasUiAuth) {
      err = "Bridge session or bridge token required";
      status = "error";
      return;
    }
    void reconnectFeed();
    connectWs();
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error("WS timeout")), 8000);
      if (!ws) {
        clearTimeout(t);
        rej(new Error("no ws"));
        return;
      }
      ws.addEventListener("open", () => {
        clearTimeout(t);
        res();
      });
      ws.addEventListener("error", () => {
        clearTimeout(t);
        rej(new Error("ws"));
      });
    }).catch((e) => {
      err = (e as Error).message;
      status = "error";
    });
    if (err) return;
    try {
      const m = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: 1 },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      pcm = await startPcm16kCapture(m, sendAudioChunk, sendWaveformLevels);
    } catch (e) {
      err = (e as Error).message || "Microphone error";
      status = "error";
      return;
    }
    showNotice("Recording started.");
  }

  function stop() {
    pcm?.stop();
    pcm = null;
    ws?.close();
    ws = null;
    status = "idle";
    showNotice("Recording stopped.", "ok", 2000);
  }

  function cleanupCapture() {
    pcm?.stop();
    pcm = null;
    ws?.close();
    ws = null;
    status = "idle";
  }

  /** Text fallback when STT is unavailable (still routes through hub). */
  async function sendText() {
    const t = (document.getElementById("manual-t") as HTMLInputElement | null)
      ?.value;
    if (!t?.trim()) {
      err = "Enter text to send";
      return;
    }
    const ok = await ensureWsForManual();
    if (!ok || !ws || ws.readyState !== WebSocket.OPEN) {
      err = err || "Could not connect to hub";
      return;
    }
    err = "";
    pendingManual = t.trim();
    ws.send(
      JSON.stringify({
        type: "final",
        text: t,
        sessionId: session || undefined,
      }),
    );
    (document.getElementById("manual-t") as HTMLInputElement).value = "";
    showNotice("Manual line sent.");
  }

  async function copyHubToken() {
    if (!token.trim()) return;
    try {
      await navigator.clipboard.writeText(token);
      showNotice("Bridge token copied.");
    } catch (e) {
      err = `Could not copy token: ${(e as Error).message || "clipboard unavailable"}`;
    }
  }

  onMount(() => {
    try {
      token = initMobileHubToken(data);
      const fromQuery = new URL(location.href).searchParams.get("token");
      if (fromQuery && fromQuery.trim()) {
        token = fromQuery.trim();
      }
      persistMobileHubToken(token);
      session = localStorage.getItem("pmSession") || "";
    } catch {
      // private mode / blocked
    }
    if (hasUiAuth) {
      void reconnectFeed();
    }
  });

  onDestroy(() => {
    if (pollId) {
      clearInterval(pollId);
      pollId = null;
    }
    eventSrc?.close();
    eventSrc = null;
    cleanupCapture();
  });
</script>

<svelte:head>
  <title>Capture · PM</title>
  <meta name="theme-color" content="#0a0a0a" />
</svelte:head>

<div class="mx-auto max-w-md space-y-4 p-4">
  {#if notice}
    <p
      class="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-sm text-emerald-100"
      role="status"
    >
      {notice}
    </p>
  {/if}
  <h1 class="text-xl font-semibold">Table capture</h1>
  <p class="text-sm text-zinc-500">
    PWA: allow microphone. Use <code>tailscale funnel</code> for HTTPS on phones.
  </p>
  <p class="text-xs text-zinc-500">
    Bridge: {data.bridgeReady ? "connected" : "waiting"} · UI session: {data.bridgeSessionActive
      ? "active"
      : "inactive"}
  </p>

  <div class="space-y-2">
    <div class="text-xs text-zinc-500">
      <span>Bridge token</span>
      {#if !token.trim()}
        <p class="mt-1 text-zinc-500">
          Open this page from the bridge session URL printed by <code
            >thepm bridge</code
          >, or paste the active bridge token.
        </p>
      {/if}
        <div class="mt-1 flex gap-1">
          <button
            type="button"
            class="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-left text-zinc-200"
            onclick={openTokenModal}>Edit bridge token</button
          >
          <button
            type="button"
            class="shrink-0 rounded border border-zinc-600 px-2 py-1 text-zinc-300"
            disabled={!token.trim()}
            onclick={() => void copyHubToken()}
            >Copy</button
          >
        </div>
    </div>
    <button
      type="button"
      class="w-full rounded border border-zinc-600 py-1.5 text-xs text-zinc-300"
      disabled={!data.bridgeReady || !hasUiAuth}
      onclick={() => {
        void reconnectFeed();
      }}>Connect live transcript</button
    >
  </div>

  <div class="flex gap-2">
    {#if status === "idle" || status === "error"}
      <button
        type="button"
        class="flex-1 rounded-lg bg-red-600 py-4 text-lg font-semibold text-white"
        disabled={!data.bridgeReady || !hasUiAuth}
        onclick={start}
      >
        Record
      </button>
    {:else}
      <button
        type="button"
        class="flex-1 rounded-lg bg-zinc-700 py-4 text-lg font-semibold"
        disabled={!data.bridgeReady}
        onclick={stop}
      >
        Stop
      </button>
    {/if}
  </div>

  <div class="h-[min(36vh,18rem)] max-h-72 min-h-36 shrink-0 overflow-hidden">
    {#if feedError}
      <p
        class="mb-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200"
      >
        {feedError}
      </p>
    {/if}
    <TranscriptFeed lines={transcriptLines} />
  </div>

  <div class="rounded border border-zinc-800 p-2 text-sm text-zinc-500">
    Session: <span class="font-mono text-zinc-300">{session || "—"}</span>
  </div>
  {#if err}
    <p class="text-sm text-rose-400">{err}</p>
  {/if}

  <div class="border-t border-zinc-800 pt-4">
    <p class="mb-1 text-xs text-zinc-500">
      Manual line — connects automatically; no need to press Record
    </p>
    <div class="flex gap-1">
      <input
        id="manual-t"
        class="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2"
        placeholder="Say something…"
      />
      <button
        type="button"
        class="rounded border border-zinc-600 px-2"
        disabled={!data.bridgeReady || !hasUiAuth}
        onclick={sendText}>Send</button
      >
    </div>
  </div>
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
