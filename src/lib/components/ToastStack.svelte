<script lang="ts">
  import { fly, fade } from "svelte/transition";

  type Toast = {
    id: number;
    kind: "success" | "error" | "info";
    message: string;
  };

  let {
    toasts = [] as Toast[],
    ondismiss = (_id: number) => {},
  } = $props();
</script>

<div
  class="pointer-events-none fixed bottom-3 left-1/2 z-50 flex w-[min(32rem,calc(100vw-1.5rem))] -translate-x-1/2 flex-col gap-2"
>
  {#each toasts as toast (toast.id)}
    <div
      class={`pointer-events-auto rounded border px-3 py-2 text-sm shadow-lg ${
        toast.kind === "success"
          ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-100"
          : toast.kind === "error"
            ? "border-rose-500/60 bg-rose-500/15 text-rose-100"
            : "border-zinc-500/50 bg-zinc-900 text-zinc-100"
      }`}
      role="status"
      aria-live="polite"
      in:fly={{ y: 20, duration: 180 }}
      out:fade={{ duration: 150 }}
    >
      <div class="flex items-start gap-2">
        <p class="min-w-0 flex-1">{toast.message}</p>
        <button
          type="button"
          class="rounded border border-current/40 px-1.5 py-0.5 text-xs opacity-80 hover:opacity-100"
          onclick={() => ondismiss(toast.id)}>Dismiss</button
        >
      </div>
    </div>
  {/each}
</div>
