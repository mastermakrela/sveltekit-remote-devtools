<svelte:options css="injected" />

<script lang="ts">
	// The full page at `/__remote-devtools/`: every remote function as an API reference, with a file tree to
	// narrow it down by where functions are declared or imported.
	import { store } from '../store.svelte.ts';
	import Endpoints from './Endpoints.svelte';
	import RouteTree, { selected_ids, type Selection } from './RouteTree.svelte';
	import Theme from './Theme.svelte';

	let selection = $state<Selection>(null);
	const only = $derived(selection && store.manifest ? selected_ids(store.manifest, selection) : null);
</script>

<svelte:head><title>Remote functions{store.manifest ? ` (${store.manifest.functions.length})` : ''}</title></svelte:head>

<Theme>
	<div class="page">
		<aside>
			<h1>Remote functions</h1>
			{#if store.manifest}
				<RouteTree manifest={store.manifest} bind:selection />
			{/if}
		</aside>
		<main>
			<Endpoints {only} full />
		</main>
	</div>
</Theme>

<style>
	:global(html) {
		color-scheme: light dark;
	}
	:global(body) {
		margin: 0;
	}
	.page {
		display: grid;
		grid-template-columns: minmax(240px, 300px) 1fr;
		min-height: 100vh;
		background: var(--skrd-bg);
		color: var(--skrd-fg);
		font: 12px/1.6 var(--skrd-font-mono);
		-webkit-font-smoothing: antialiased;
	}
	aside {
		position: sticky;
		top: 0;
		height: 100vh;
		overflow: auto;
		padding: 16px 10px;
		border-right: 1px solid var(--skrd-line);
		background: var(--skrd-toolbar-bg);
	}
	h1 {
		margin: 0 4px 12px;
		font: 600 15px/1.3 var(--skrd-font-ui);
		color: var(--skrd-fg-strong);
	}
	main {
		min-width: 0;
		max-width: 1100px;
		padding: 16px 24px 48px;
	}
	@media (max-width: 720px) {
		.page {
			grid-template-columns: 1fr;
		}
		aside {
			position: static;
			height: auto;
			max-height: 45vh;
			border-right: 0;
			border-bottom: 1px solid var(--skrd-line);
		}
		main {
			padding: 12px;
		}
	}
</style>
