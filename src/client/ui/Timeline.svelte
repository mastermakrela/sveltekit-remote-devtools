<svelte:options css="injected" />

<script lang="ts">
	// Chronological view: SSR renders (grouped per request) and client calls, newest at the bottom.
	import { store } from '../store.svelte.ts';
	import CallRow from './CallRow.svelte';
	import SsrGroup from './SsrGroup.svelte';
	import { navigations, short_file, ssr_groups, type TimelineEntry } from './model.ts';

	let filter = $state('');
	/** the scroll container, set by the `follow` attachment (not reactive: only event handlers read it) */
	let list: HTMLDivElement | null = null;
	/** follow new entries unless the user scrolled up */
	let stick = $state(true);

	function matches(needle: string, ...haystack: Array<string | null | undefined>) {
		return haystack.some((h) => h?.toLowerCase().includes(needle));
	}

	const entries = $derived.by((): TimelineEntry[] => {
		const needle = filter.trim().toLowerCase();
		const groups = ssr_groups(store.server)
			.filter((g) => g.calls.some((c) => c.serverSeq > store.cleared.server))
			.filter(
				(g) =>
					!needle ||
					matches(needle, g.pathname) ||
					g.calls.some((c) => matches(needle, c.name, c.id, short_file(c.id ? store.function_of(c.id)?.file : null)))
			);
		const calls = store.client
			.filter((c) => c.seq > store.cleared.client)
			.filter((c) => !needle || matches(needle, c.name, c.id, c.pathname, store.function_of(c.id)?.file))
			.map((call) => ({ type: 'client' as const, key: `c${call.seq}`, at: call.at, call }));
		return [...groups, ...calls].sort((a, b) => a.at - b.at);
	});

	/** "navigated to /x" separators, keyed by the entry they precede */
	const separators = $derived(navigations(entries));

	const total = $derived(store.client.filter((c) => c.seq > store.cleared.client).length);
	const pending = $derived(store.client.filter((c) => c.status === 'pending').length);

	function onscroll() {
		if (!list) return;
		stick = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
	}

	/** keeps the newest entry in view; re-runs whenever entries change or a pending call settles */
	function follow(node: HTMLDivElement) {
		list = node;
		void entries.length;
		void pending;
		if (stick) node.scrollTop = node.scrollHeight;
	}

	function to_bottom() {
		stick = true;
		if (list) list.scrollTop = list.scrollHeight;
	}
</script>

<div class="timeline">
	<div class="toolbar">
		<input type="search" placeholder="filter: name, id, file, /path" aria-label="Filter timeline" bind:value={filter} />
		<span class="count">{total} client {total === 1 ? 'call' : 'calls'}{pending ? ` · ${pending} pending` : ''}</span>
		<button onclick={() => store.clear_timeline()} title="Hide everything so far (the Live tab keeps last-known values)">clear</button>
	</div>
	<div class="list" {@attach follow} {onscroll}>
		{#if entries.length === 0}
			<p class="empty">
				{#if filter}
					Nothing matches the filter.
				{:else if store.cleared.client || store.cleared.server}
					Cleared. New calls appear here as they happen.
				{:else}
					No remote calls yet. Interact with the page — calls appear here as they happen.
				{/if}
			</p>
		{:else}
			<ol>
				{#each entries as entry (entry.key)}
					{#if separators[entry.key]}
						<li class="nav">navigated to <b>{separators[entry.key]}</b></li>
					{/if}
					{#if entry.type === 'ssr'}
						<SsrGroup group={entry} />
					{:else}
						<CallRow call={entry.call} />
					{/if}
				{/each}
			</ol>
		{/if}
	</div>
	{#if !stick}
		<button class="jump" onclick={to_bottom}>↓ newest</button>
	{/if}
</div>

<style>
	.timeline {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}
	.toolbar {
		display: flex;
		gap: 8px;
		align-items: center;
		padding: 4px 8px;
		border-bottom: 1px solid var(--skrd-line);
		background: var(--skrd-toolbar-bg);
	}
	input {
		flex: 1;
		min-width: 0;
		max-width: 320px;
		padding: 2px 6px;
		border: 1px solid var(--skrd-line);
		border-radius: var(--skrd-radius);
		background: var(--skrd-code-bg);
		color: inherit;
		font: inherit;
	}
	input:focus {
		outline: 1px solid var(--skrd-accent);
		border-color: var(--skrd-accent);
	}
	.count {
		margin-left: auto;
		color: var(--skrd-dim);
		white-space: nowrap;
	}
	.toolbar button,
	.jump {
		padding: 2px 8px;
		border: 1px solid var(--skrd-line);
		border-radius: var(--skrd-radius);
		background: none;
		color: var(--skrd-muted);
		font: 12px/1.5 var(--skrd-font-ui);
		text-transform: uppercase;
		cursor: pointer;
	}
	.toolbar button:hover,
	.jump:hover {
		background: var(--skrd-hover);
	}
	.list {
		flex: 1;
		min-height: 0;
		overflow: auto;
		overscroll-behavior: contain;
	}
	ol {
		margin: 0;
		padding: 0;
	}
	.nav {
		list-style: none;
		padding: 2px 8px;
		color: var(--skrd-dim);
		font-size: 11px;
		text-align: center;
		border-bottom: 1px solid var(--skrd-line);
		background: repeating-linear-gradient(90deg, transparent 0 6px, var(--skrd-line) 6px 7px) center / 100% 1px no-repeat;
	}
	.nav b {
		color: var(--skrd-accent);
		font-weight: 600;
	}
	.empty {
		margin: 0;
		padding: 16px 8px;
		color: var(--skrd-dim);
	}
	.jump {
		position: absolute;
		right: 12px;
		bottom: 8px;
		background: var(--skrd-accent);
		color: var(--skrd-on-accent);
		border: 0;
	}
	.jump:hover {
		background: var(--skrd-accent);
		filter: brightness(1.1);
	}
</style>
