<script lang="ts">
  import { page } from "$app/state";

  const onHub = $derived(page.url.pathname === "/");
  const onAgents = $derived(page.url.pathname.startsWith("/agents"));
</script>

<div class="flex flex-wrap items-center gap-2">
  <a
    href="/"
    class="text-lg font-semibold tracking-tight text-zinc-100 hover:text-white"
    >thepm</a
  >
  <nav
    class="flex rounded-lg border border-zinc-700 bg-zinc-900/80 p-0.5 text-xs"
    aria-label="Primary views"
  >
    <a
      href="/"
      class="rounded px-2 py-1 no-underline {onHub
        ? 'bg-zinc-700 text-white'
        : 'text-zinc-400 hover:text-zinc-200'}"
      aria-current={onHub ? "page" : undefined}>Hub</a
    >
    <a
      href="/agents"
      class="rounded px-2 py-1 no-underline {onAgents
        ? 'bg-zinc-700 text-white'
        : 'text-zinc-400 hover:text-zinc-200'}"
      aria-current={onAgents ? "page" : undefined}>Agents</a
    >
  </nav>
</div>
