<svelte:options css="injected" />

<script lang="ts">
	// Kit's client query cache right now. Values are NEVER read from Kit's resources (their getters start
	// fetches): the last known value is reconstructed from the timeline and the SSR events instead.
	import { store } from '../store.svelte.ts';
	import Kind from './Kind.svelte';
	import Value from './Value.svelte';
	import { arg_preview, fmt_time, group_live, last_known, name_of, preview, short_file } from './model.ts';

	const groups = $derived(group_live(store.live).map((g) => ({ ...g, fn: store.function_of(g.id) })));
</script>

<div class="live">
	<div class="toolbar">
		<p>
			Queries currently held in Kit's client cache by this page. An entry disappears once no component
			references it any more.
		</p>
		<button onclick={() => store.refresh_live()}>refresh snapshot</button>
	</div>
	<div class="list">
		{#if groups.length === 0}
			<p class="empty">Kit's cache is empty: this page holds no query instances right now.</p>
		{/if}
		{#each groups as group (group.id)}
			<section>
				<header>
					<Kind kind={group.fn?.kind ?? (group.queries[0].live ? 'query_live' : 'query')} />
					<span class="name">{group.fn?.name ?? name_of(group.id)}</span>
					<span class="file" title={group.fn?.file}>{short_file(group.fn?.file)}</span>
					<span class="count">{group.queries.length} {group.queries.length === 1 ? 'instance' : 'instances'}</span>
				</header>
				<ul>
					{#each group.queries as q (q.payload)}
						{@const known = last_known(q.id, q.payload, q.arg)}
						<li>
							<div class="row">
								<span class="sig">
									<span class="paren">(</span><span class="arg">{arg_preview(q.arg, 60)}</span><span class="paren">)</span>
								</span>
								<span class="kind-label">{q.live ? 'live query' : 'query'}</span>
								<span class="proxies" title="components/expressions currently referencing this instance">×{q.proxies}</span>
							</div>
							<div class="value">
								{#if !known}
									<span class="dim">value unknown (hydrated before the devtool connected)</span>
								{:else if known.error !== undefined}
									<span class="bad">✗ {preview(known.error, 80)}</span>
									<span class="src">{known.source} · {fmt_time(known.at)}</span>
								{:else}
									<span class="v"><!-- read optionally: Value's derived can re-run once more while the row tears down -->
									<Value label="last known" value={known?.value} /></span>
									<span class="src">{known.source} · {fmt_time(known.at)}</span>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	</div>
</div>

<style>
	.live {
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
	.toolbar p {
		flex: 1;
		margin: 0;
		color: var(--skrd-muted);
		font-size: 11px;
	}
	button {
		flex: none;
		padding: 2px 8px;
		border: 1px solid var(--skrd-line);
		border-radius: var(--skrd-radius);
		background: none;
		color: var(--skrd-muted);
		font: 12px/1.5 var(--skrd-font-ui);
		text-transform: uppercase;
		cursor: pointer;
	}
	button:hover {
		background: var(--skrd-hover);
	}
	button:focus-visible {
		outline: 1px solid var(--skrd-accent);
	}
	.list {
		flex: 1;
		min-height: 0;
		overflow: auto;
	}
	section {
		border-bottom: 1px solid var(--skrd-line);
	}
	header {
		display: flex;
		gap: 8px;
		align-items: center;
		padding: 4px 8px;
		background: var(--skrd-toolbar-bg);
	}
	.name {
		color: var(--skrd-fg-strong);
		font-weight: 600;
	}
	.file {
		color: var(--skrd-dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.count {
		margin-left: auto;
		color: var(--skrd-dim);
		white-space: nowrap;
	}
	ul {
		margin: 0;
		padding: 0;
	}
	li {
		list-style: none;
		padding: 2px 8px 3px 24px;
	}
	li:hover {
		background: var(--skrd-hover);
	}
	li + li {
		border-top: 1px dashed var(--skrd-line);
	}
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 10ch 5ch;
		gap: 8px;
		align-items: baseline;
	}
	.sig {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.paren,
	.dim,
	.src,
	.kind-label {
		color: var(--skrd-dim);
	}
	.arg {
		color: var(--skrd-str);
	}
	.proxies {
		text-align: right;
		color: var(--skrd-accent);
		font-variant-numeric: tabular-nums;
	}
	.value {
		display: flex;
		gap: 8px;
		align-items: baseline;
		padding-left: 12px;
		min-width: 0;
	}
	.v {
		flex: 1;
		min-width: 0;
	}
	.src {
		flex: none;
		font-size: 10px;
		white-space: nowrap;
	}
	.bad {
		color: var(--skrd-bad);
		flex: 1;
	}
	.empty {
		margin: 0;
		padding: 16px 8px;
		color: var(--skrd-dim);
	}
	@container skrd (max-width: 600px) {
		.toolbar {
			flex-wrap: wrap;
		}
		.value {
			flex-wrap: wrap;
			row-gap: 0;
			padding-left: 0;
		}
		.v {
			flex-basis: 100%;
		}
		.src {
			margin-left: auto;
		}
		li {
			padding-left: 12px;
		}
	}
</style>
