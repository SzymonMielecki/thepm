<script lang="ts">
  let {
    content = $bindable(""),
    proposed = $bindable(""),
    pathLabel = "",
    editing = $bindable(false),
    frameless = false,
  } = $props();
</script>

<div
  class="flex min-h-0 flex-col overflow-hidden rounded-lg h-full {frameless
    ? ''
    : 'border border-zinc-800'}"
>
  <div
    class="min-w-0 border-b border-zinc-800 px-2 py-1.5 text-xs break-all text-zinc-500"
    title={pathLabel || undefined}
  >
    {pathLabel ? `PRD at ${pathLabel}` : "Source (PRD.md)"}
  </div>
  <textarea
    class="min-h-0 flex-1 resize-none bg-zinc-950 p-2 font-mono text-xs text-zinc-200 outline-none"
    bind:value={content}
    onfocus={() => {
      editing = true;
    }}
    onblur={() => {
      editing = false;
    }}
  ></textarea>
</div>
