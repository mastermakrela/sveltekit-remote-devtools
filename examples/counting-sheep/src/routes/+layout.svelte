<script lang="ts">
	let { children } = $props();
</script>

<svelte:head>
	<title>Counting sheep</title>
</svelte:head>

{@render children()}

<style>
	:global(html) {
		color-scheme: dark;
		background: #14172b;
		color: #e8e6f0;
		font: 16px/1.5 ui-rounded, 'SF Pro Rounded', system-ui, sans-serif;
	}
	:global(body) {
		margin: 0;
	}
</style>
