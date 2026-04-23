<script lang="ts">
	import '../app.css';
	let { children } = $props();
</script>

<div class="flex min-h-dvh flex-col">
	{@render children()}
</div>
