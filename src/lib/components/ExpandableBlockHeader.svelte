<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    title,
    expanded = false,
    onexpand,
    onclose,
    trailing,
  }: {
    title: string;
    expanded?: boolean;
    onexpand: () => void;
    onclose: () => void;
    trailing?: Snippet;
  } = $props();
</script>

<div class="flex min-h-7 shrink-0 items-center justify-between gap-2">
  {#if expanded}
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <span class="truncate text-xs font-medium text-zinc-100">{title}</span>
      <button
        type="button"
        class="inline-flex shrink-0 items-center justify-center rounded border border-zinc-600 p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        aria-label="Exit expanded view"
        onclick={onclose}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  {:else}
    <button
      type="button"
      class="group flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left outline-none ring-offset-2 ring-offset-zinc-950 focus-visible:ring-2 focus-visible:ring-zinc-500 transition-colors duration-150 hover:bg-zinc-800/40"
      onclick={onexpand}
    >
      <span class="truncate text-xs font-medium text-zinc-400">{title}</span>
      <span
        class="inline-flex shrink-0 w-auto h-auto text-zinc-500"
        aria-hidden="true"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M8 3H5a2 2 0 0 0-2 2v3" />
          <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
          <path d="M3 16v3a2 2 0 0 0 2 2h3" />
          <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        </svg>
      </span>
    </button>
  {/if}
  {#if trailing}
    {@render trailing()}
  {/if}
</div>
