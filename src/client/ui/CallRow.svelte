<svelte:options css="injected" />

<script lang="ts">
	// One client-side remote call: a summary row, the single-flight refresh tree (commands and forms),
	// and an expandable detail view with decoded argument, result, raw envelope and the server twin.
	import { store, type ClientCall } from '../store.svelte.ts';
	import Kind from './Kind.svelte';
	import Value from './Value.svelte';
	import { arg_preview, fmt_ms, fmt_time, is_write, preview, refresh_tree, server_args, server_result, short_file } from './model.ts';

	let { call }: { call: ClientCall } = $props();

	let expanded = $state(false);
	let raw = $state(false);

	const fn = $derived(store.function_of(call.id));
	const tree = $derived(is_write(call.kind) ? refresh_tree(call) : []);
	const data = $derived(call.response?.data);
	const failed = $derived(
		call.status === 'failed' || call.response?.type === 'error' || (call.httpStatus !== undefined && call.httpStatus >= 400)
	);
	const has_arg = $derived(call.arg !== undefined || call.kind === 'query' || call.kind === 'command');
	const arg_text = $derived.by(() => {
		if (call.argError) return '⚠ undecodable';
		if (call.form) return `FormData(${call.form.length})`;
		if (call.kind === 'form' && call.arg === undefined) return '';
		if (call.kind === 'query_batch' && Array.isArray(call.arg)) return call.arg.map((a) => preview(a, 30)).join(', ');
		return call.arg === undefined ? '' : preview(call.arg, 50);
	});

	const STATE_TEXT = {
		refreshed: 'refreshed',
		error: 'refresh failed',
		ignored: 'ignored by server',
		unhandled: 'requested, not handled → query failed',
		skipped: 'not refreshed (the call failed)',
		registered: 'registered, no value in response'
	} as const;
</script>

<li class="call" class:write={is_write(call.kind)} class:failed>
	<button class="row" aria-expanded={expanded} onclick={() => (expanded = !expanded)}>
		<span class="caret" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
		<span class="time">{fmt_time(call.at)}</span>
		<span class="kindcell"><Kind kind={call.kind} /></span>
		<span class="sig">
			<span class="name">{call.name}</span><span class="paren">(</span><span class="arg">{arg_text}</span><span class="paren">)</span>
		</span>
		<span class="file" title={fn?.file}>{short_file(fn?.file)}</span>
		<span class="status">
			{#if call.status === 'pending'}
				<span class="spinner" aria-label="pending"></span>
			{:else if call.status === 'failed'}
				<span class="bad">failed</span>
			{:else if call.stream}
				<span class="ok">{call.httpStatus} stream</span>
			{:else if call.response?.type === 'error'}
				<span class="bad">{call.httpStatus} error</span>
			{:else if data?.redirect}
				<span class="warn">{call.httpStatus} redirect</span>
			{:else}
				<span class={failed ? 'bad' : 'ok'}>{call.httpStatus}</span>
			{/if}
		</span>
		<span class="dur">
			{fmt_ms(call.durationMs)}{#if call.server}<span class="srv" title="server handler time">&nbsp;· srv {fmt_ms(call.server.durationMs)}</span>{/if}
		</span>
	</button>

	{#if tree.length > 0 || (call.children?.length ?? 0) > 0}
		<ul class="tree" aria-label="single-flight refresh">
			{#each tree as node (node.key)}
				<li class="node {node.state}">
					<span class="branch" aria-hidden="true">↳</span>
					<span class="target">
						<span class="name">{node.name}</span><span class="paren">(</span><span class="arg">{node.argError ? '⚠' : arg_preview(node.arg, 40)}</span><span class="paren">)</span>
					</span>
					<span class="chips">
						{#if node.requested}<span class="chip client" title="client asked via .updates(...)">.updates()</span>{/if}
						{#if node.server}<span class="chip server" title="registered on the server via refresh() / set() / refreshAll()">server</span>{/if}
						{#if node.server && !node.requested}<span class="chip init" title="the client did not ask for this refresh">server-initiated</span>{/if}
						{#if node.live}<span class="chip">live</span>{/if}
					</span>
					<span class="outcome">
						{#if node.state === 'refreshed'}
							<span class="arrow">→</span>
							<span class="nv"><Value value={node.value} /></span>
						{:else if node.state === 'error'}
							<span class="bad">✗ {preview(node.error, 60)}</span>
						{:else if call.status === 'pending'}
							<span class="dim">waiting…</span>
						{:else}
							<span class={node.state === 'unhandled' ? 'bad' : 'dim'}>{STATE_TEXT[node.state]}</span>
						{/if}
					</span>
				</li>
			{/each}
			{#each call.children ?? [] as child (child.serverSeq)}
				<li class="node rerun">
					<span class="branch" aria-hidden="true">⟳</span>
					<span class="target">
						<span class="dim">server re-ran</span>
						<span class="name">{child.name}</span><span class="paren">(</span><span class="arg">{arg_preview(server_args(child), 40)}</span><span class="paren">)</span>
					</span>
					<span class="chips"></span>
					<span class="outcome">
						<span class={child.outcome === 'ok' ? 'dim' : 'bad'}>{child.outcome === 'ok' ? fmt_ms(child.durationMs) : `✗ ${child.error?.message}`}</span>
					</span>
				</li>
			{/each}
		</ul>
	{/if}

	{#if expanded}
		<div class="details">
			<dl>
				<dt>request</dt>
				<dd><span class="method">{call.method}</span> {call.url}</dd>
				<dt>page</dt>
				<dd>{call.pathname}</dd>
				<dt>function</dt>
				<dd>{call.id}{#if fn} <span class="dim">· {fn.file}</span>{/if}</dd>
				<dt>argument</dt>
				<dd>
					{#if call.argError}
						<span class="bad">{call.argError}</span>
					{:else if call.form}
						<Value value={Object.fromEntries(call.form)} open />
					{:else if has_arg}
						<Value value={call.arg} open />
					{:else if call.server}
						<span class="dim">not captured client-side; as the server handler received it:</span>
						<Value value={server_args(call.server)} open />
					{:else}
						<span class="dim">not captured</span>
					{/if}
				</dd>
				<dt>result</dt>
				<dd>
					{#if call.status === 'pending'}
						<span class="dim">pending…</span>
					{:else if call.error}
						<span class="bad">{call.error}</span>
					{:else if call.responseError}
						<span class="bad">could not decode response: {call.responseError}</span>
					{:else if call.stream}
						<span class="dim">streamed ({call.stream}); values are not captured</span>
					{:else if call.response?.type === 'error'}
						<Value value={call.response.error} open />
					{:else if data?.redirect}
						redirect → {data.redirect}
					{:else if data}
						<Value value={data._} open />
					{:else}
						<span class="dim">no body</span>
					{/if}
				</dd>
				<dt>timing</dt>
				<dd>
					round-trip {fmt_ms(call.durationMs)}
					{#if call.server}
						· server handler {fmt_ms(call.server.durationMs)} ({call.server.outcome}{call.server.error ? `: ${call.server.error.message}` : ''}) · request #{call.server.requestId}
					{:else}
						<span class="dim">· no server trace matched</span>
					{/if}
				</dd>
				{#if call.server}
					<dt>server saw</dt>
					<dd>
						<Value label="args" value={server_args(call.server)} />
						<Value label="result" value={server_result(call.server)} />
					</dd>
				{/if}
				{#if data?.r !== undefined || data?.i}
					<dt>flags</dt>
					<dd>
						{#if data?.r}r: explicit server refreshes{/if}
						{#if data?.i}· i: {data.i.length} ignored{/if}
					</dd>
				{/if}
				{#if call.response?.raw}
					<dt>raw</dt>
					<dd>
						<button class="link" aria-expanded={raw} onclick={() => (raw = !raw)}>{raw ? 'hide' : 'show'} devalue envelope</button>
						{#if raw}<pre>{call.response.raw}</pre>{/if}
					</dd>
				{/if}
			</dl>
		</div>
	{/if}
</li>

<style>
	.call {
		list-style: none;
		border-bottom: 1px solid var(--skrd-line);
	}
	.call.write {
		background: var(--skrd-write-bg);
	}
	.row {
		display: grid;
		grid-template-columns: 10px 12ch 12ch minmax(0, 1fr) minmax(0, 24ch) 10ch 22ch;
		gap: 8px;
		align-items: center;
		width: 100%;
		padding: 3px 8px;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.row:hover {
		background: var(--skrd-hover);
	}
	.row:focus-visible,
	.link:focus-visible {
		outline: 1px solid var(--skrd-accent);
		outline-offset: -1px;
	}
	.caret,
	.time,
	.paren,
	.dim,
	.branch {
		color: var(--skrd-dim);
	}
	.time {
		font-variant-numeric: tabular-nums;
	}
	.sig,
	.target {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.name {
		color: var(--skrd-fg-strong);
		font-weight: 600;
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
	.status,
	.dur {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.srv {
		color: var(--skrd-dim);
	}
	.ok {
		color: var(--skrd-ok);
	}
	.bad {
		color: var(--skrd-bad);
	}
	.warn {
		color: var(--skrd-warn);
	}
	.spinner {
		display: inline-block;
		width: 9px;
		height: 9px;
		border: 2px solid var(--skrd-dim);
		border-top-color: var(--skrd-accent);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.tree {
		margin: 0 0 4px;
		padding: 0 8px 2px calc(8px + 10px + 24ch + 24px);
	}
	.node {
		list-style: none;
		display: grid;
		grid-template-columns: 1.5ch minmax(0, max-content) auto minmax(0, 1fr);
		gap: 6px;
		align-items: baseline;
		line-height: 18px;
	}
	.outcome {
		display: flex;
		gap: 4px;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.nv {
		flex: 1;
		min-width: 0;
	}
	.arrow {
		color: var(--skrd-ok);
	}
	.node.unhandled .branch,
	.node.error .branch {
		color: var(--skrd-bad);
	}
	.node.ignored .target {
		opacity: 0.6;
	}
	.chips {
		display: flex;
		gap: 3px;
		white-space: nowrap;
	}
	.chip {
		padding: 0 4px;
		border-radius: 3px;
		font-size: 10px;
		line-height: 14px;
		background: var(--skrd-chip);
		color: var(--skrd-muted);
	}
	.chip.client {
		color: var(--skrd-blue);
	}
	.chip.server {
		color: var(--skrd-accent);
	}
	.chip.init {
		color: var(--skrd-warn);
	}

	.details {
		padding: 4px 8px 8px calc(10px + 8px + 8px);
		background: var(--skrd-detail-bg);
		border-top: 1px dashed var(--skrd-line);
	}
	dl {
		display: grid;
		grid-template-columns: 10ch minmax(0, 1fr);
		gap: 2px 10px;
		margin: 0;
	}
	dt {
		color: var(--skrd-dim);
		line-height: 18px;
	}
	dd {
		margin: 0;
		min-width: 0;
		line-height: 18px;
		overflow-wrap: anywhere;
	}
	.method {
		color: var(--skrd-accent);
		font-weight: 600;
	}
	.link {
		padding: 0;
		border: 0;
		background: none;
		color: var(--skrd-accent);
		font: inherit;
		cursor: pointer;
	}
	pre {
		margin: 4px 0 0;
		padding: 6px;
		max-height: 200px;
		overflow: auto;
		background: var(--skrd-code-bg);
		border-radius: 4px;
		white-space: pre-wrap;
		word-break: break-all;
		font: inherit;
		font-size: 11px;
	}

	@container skrd (max-width: 600px) {
		.row {
			grid-template-columns: 10px auto minmax(0, 1fr) auto;
			grid-template-areas:
				'caret kind time status'
				'. sig sig sig'
				'. file file dur';
			row-gap: 0;
		}
		.caret {
			grid-area: caret;
		}
		.kindcell {
			grid-area: kind;
		}
		.sig {
			grid-area: sig;
		}
		.status {
			grid-area: status;
		}
		.time {
			grid-area: time;
			font-size: 10px;
		}
		.file {
			grid-area: file;
			font-size: 10px;
		}
		.dur {
			grid-area: dur;
			font-size: 10px;
		}
		.tree {
			padding-left: 26px;
		}
		.node {
			grid-template-columns: 1.5ch auto minmax(0, 1fr);
			row-gap: 0;
			padding-bottom: 2px;
		}
		.target {
			grid-column: 2 / -1;
		}
		.chips {
			grid-column: 2;
		}
		.outcome {
			grid-column: 3;
		}
		.details {
			padding-left: 12px;
		}
		dl {
			grid-template-columns: minmax(0, 1fr);
		}
		dt {
			margin-top: 4px;
		}
	}
</style>
