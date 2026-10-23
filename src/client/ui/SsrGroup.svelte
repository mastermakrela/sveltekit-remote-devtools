<svelte:options css="injected" />

<script lang="ts">
	// Remote functions that ran while the server rendered one page (one SSR request).
	import Kind from './Kind.svelte';
	import Value from './Value.svelte';
	import { arg_preview, fmt_ms, fmt_time, server_args, server_result, short_file, type SsrGroup } from './model.ts';
	import { store } from '../store.svelte.ts';

	let { group }: { group: SsrGroup } = $props();
</script>

<li class="group" class:current={group.current}>
	<details open={group.current}>
		<summary>
			<span class="caret" aria-hidden="true"></span>
			<span class="time">{fmt_time(group.at)}</span>
			<span class="badge">SSR</span>
			<span class="path">{group.pathname}</span>
			<span class="meta">· {group.calls.length} {group.calls.length === 1 ? 'call' : 'calls'} · {fmt_ms(group.totalMs)}</span>
			{#if group.current}
				<span class="tag">this page</span>
			{:else if group.later}
				<span class="tag other" title="rendered after this devtool connected: another tab or a reload">other render</span>
			{:else}
				<span class="tag other" title="from the dev server's event buffer">earlier render</span>
			{/if}
		</summary>
		<ul>
			{#each group.calls as call (call.serverSeq)}
				{@const fn = call.id ? store.function_of(call.id) : null}
				<li class="call">
					<div class="row">
						<Kind kind={call.kind} />
						<span class="sig">
							<span class="name">{call.name}</span><span class="paren">(</span><span class="arg">{arg_preview(server_args(call), 50)}</span><span class="paren">)</span>
						</span>
						<span class="file" title={fn?.file}>{short_file(fn?.file)}</span>
						<span class="dur">{fmt_ms(call.durationMs)}</span>
					</div>
					<div class="value">
						{#if call.outcome === 'error'}
							<span class="bad">✗ {call.error?.status ?? ''} {call.error?.message}</span>
						{:else}
							<Value label="→" value={server_result(call)} />
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	</details>
</li>

<style>
	.group {
		list-style: none;
		border-bottom: 1px solid var(--skrd-line);
		background: var(--skrd-ssr-bg);
	}
	.group:not(.current) {
		opacity: 0.75;
	}
	summary {
		display: flex;
		gap: 8px;
		align-items: center;
		padding: 3px 8px;
		cursor: pointer;
		list-style: none;
		white-space: nowrap;
		overflow: hidden;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary:hover {
		background: var(--skrd-hover);
	}
	summary:focus-visible {
		outline: 1px solid var(--skrd-accent);
		outline-offset: -1px;
	}
	.caret {
		width: 10px;
		flex: none;
		color: var(--skrd-dim);
	}
	.caret::before {
		content: '▸';
	}
	details[open] .caret::before {
		content: '▾';
	}
	.time {
		color: var(--skrd-dim);
		font-variant-numeric: tabular-nums;
	}
	.badge {
		padding: 0 5px;
		border-radius: 3px;
		border: 1px solid currentColor;
		color: var(--skrd-blue);
		font-size: 10px;
		line-height: 15px;
		font-weight: 600;
	}
	.path {
		flex: 0 1 auto;
		min-width: 5ch;
		color: var(--skrd-fg-strong);
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta {
		flex: none;
		color: var(--skrd-muted);
	}
	.tag {
		flex: none;
		margin-left: auto;
		padding: 0 5px;
		border-radius: 3px;
		font-size: 10px;
		line-height: 15px;
		background: var(--skrd-chip);
		color: var(--skrd-ok);
	}
	.tag.other {
		background: var(--skrd-chip);
		color: var(--skrd-dim);
	}
	ul {
		margin: 0;
		padding: 0 8px 4px 26px;
	}
	.call {
		list-style: none;
		padding: 1px 0;
	}
	.row {
		display: grid;
		grid-template-columns: 12ch minmax(0, 1fr) minmax(0, 24ch) 10ch;
		gap: 8px;
		align-items: center;
	}
	.sig {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.name {
		color: var(--skrd-fg-strong);
		font-weight: 600;
	}
	.paren {
		color: var(--skrd-dim);
	}
	.arg {
		color: var(--skrd-str);
	}
	.file {
		color: var(--skrd-dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		direction: rtl;
		text-align: left;
	}
	.dur {
		text-align: right;
		color: var(--skrd-muted);
		font-variant-numeric: tabular-nums;
	}
	.value {
		padding-left: calc(12ch + 8px);
	}
	.bad {
		color: var(--skrd-bad);
	}
	@container skrd (max-width: 600px) {
		summary .time {
			display: none;
		}
		.row {
			grid-template-columns: 12ch minmax(0, 1fr) auto;
		}
		.file {
			display: none;
		}
		.value {
			padding-left: 12px;
		}
		ul {
			padding-left: 12px;
		}
	}
</style>
