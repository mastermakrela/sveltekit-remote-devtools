<svelte:options css="injected" />

<script lang="ts">
	// Kind badge: reads (query family) in blue, writes (command, form) in the accent, prerender muted.
	import type { CallKind } from '../store.svelte.ts';
	import { KIND_LABEL } from './model.ts';

	let { kind }: { kind: CallKind | null } = $props();
</script>

<span class="kind {kind ?? 'unknown'}">{KIND_LABEL[kind ?? 'unknown']}</span>

<style>
	.kind {
		flex: none;
		display: inline-block;
		box-sizing: border-box;
		min-width: 12ch;
		padding: 0 5px;
		border-radius: 2px;
		border: 1px solid currentColor;
		font-size: 10px;
		line-height: 15px;
		text-align: center;
		white-space: nowrap;
		color: var(--skrd-muted);
	}
	/* reads blue, writes accent, prerender stays muted (DESIGN.md) */
	.query,
	.query_batch,
	.query_live {
		color: var(--skrd-blue);
	}
	.command,
	.form {
		color: var(--skrd-accent);
	}
</style>
