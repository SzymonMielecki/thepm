<script lang="ts">
	import '../app.css';
	let { children } = $props();
</script>

<div class="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden">
	{@render children()}
</div>
