<svelte:options css="injected" />

<script lang="ts">
	// Invokes one remote function over HTTP, the way Kit's client would, and shows the decoded result.
	import { onDestroy } from 'svelte';
	import type { RemoteFunctionEntry } from '../../node/manifest.ts';
	import {
		build_request,
		curl_line,
		form_fields,
		form_issues,
		initial_source,
		parse_source,
		pretty,
		send,
		stream_live,
		takes_argument,
		type ArgMode,
		type LiveEvent,
		type PlaygroundRequest,
		type PlaygroundResult
	} from '../playground.ts';

	let { fn, onclose }: { fn: RemoteFunctionEntry; onclose: () => void } = $props();

	// The parent keys this component by function id, so reading the initial prop value is intended
	// svelte-ignore state_referenced_locally
	let source = $state(initial_source(fn));
	let mode = $state<ArgMode>('json');
	// svelte-ignore state_referenced_locally
	let no_arg = $state(!takes_argument(fn));
	let confirming = $state(false);
	let busy = $state(false);
	let request = $state<PlaygroundRequest | null>(null);
	let result = $state<PlaygroundResult | null>(null);
	let failure = $state<string | null>(null);
	let copied = $state(false);

	let live_events = $state<LiveEvent[]>([]);
	let live_status = $state<string | null>(null);
	let controller: AbortController | null = null;

	const is_write = $derived(fn.kind === 'command');
	const fields = $derived(fn.kind === 'form' ? form_fields(fn) : []);
	const issues = $derived(form_issues(result));
	// `address.street` and `tags[0]` belong to the `address` and `tags` inputs
	const field_of = (issue: { name: string }) => issue.name.split(/[.[]/)[0];
	const issues_of = (name: string) => issues.filter((i) => field_of(i) === name);
	const form_level_issues = $derived(issues.filter((i) => !fields.some((f) => f.name === field_of(i))));
	// off by default: a Kit form validates on the server, which is what this should show
	let browser_checks = $state(false);
	// Kit also echoes a query's own result into `q` (cache seeding); only show the other entries
	const self_key = $derived(request ? `${fn.id}/${request.payloads[0] ?? ''}` : null);
	const refreshed = $derived(Object.entries(result?.data?.q ?? {}).filter(([key]) => key !== self_key));
	const reconnected = $derived(Object.entries(result?.data?.l ?? {}));

	function reset_output() {
		request = null;
		result = null;
		failure = null;
		copied = false;
		live_events = [];
		live_status = null;
	}

	async function prepare(): Promise<PlaygroundRequest | null> {
		try {
			const arg = no_arg ? undefined : parse_source(source, mode);
			return await build_request(fn, arg);
		} catch (error) {
			failure = `Argument: ${error instanceof Error ? error.message : String(error)}`;
			return null;
		}
	}

	async function run() {
		if (is_write && !confirming) {
			confirming = true;
			return;
		}
		confirming = false;
		reset_output();
		const prepared = await prepare();
		if (!prepared) return;
		request = prepared;
		if (fn.kind === 'query_live') return connect(prepared);
		await execute(prepared);
	}

	async function execute(prepared: PlaygroundRequest) {
		busy = true;
		try {
			result = await send(fn, prepared);
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
	}

	async function connect(prepared: PlaygroundRequest) {
		controller = new AbortController();
		busy = true;
		live_status = 'connecting';
		try {
			await stream_live(
				prepared,
				controller.signal,
				(status, type) => (live_status = `HTTP ${status} ${type ?? ''}`),
				(event) => live_events.unshift(event)
			);
			live_status = `${live_status}, stream ended`;
		} catch (error) {
			if (controller?.signal.aborted) live_status = `${live_status}, stopped`;
			else failure = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
			controller = null;
		}
	}

	async function submit_form(event: SubmitEvent) {
		event.preventDefault();
		reset_output();
		request = await build_request(fn, new FormData(event.currentTarget as HTMLFormElement));
		await execute(request);
	}

	function stop() {
		controller?.abort();
	}

	// abort a running stream when the playground closes
	onDestroy(() => controller?.abort());

	async function copy(text: string) {
		await navigator.clipboard.writeText(text);
		copied = true;
		setTimeout(() => (copied = false), 1200);
	}

	function reset_source() {
		source = initial_source(fn);
	}
</script>

<section class="pg" aria-label="Playground for {fn.name}">
	<header class="pg-head">
		<button class="link" onclick={onclose}>← all endpoints</button>
		<strong>{fn.name}</strong>
		<span class="muted">{fn.file}</span>
	</header>

	<p class="contract"><b>{fn.http.method}</b> <span class="wrap">{fn.http.url}</span></p>
	<p class="muted small">{fn.http.request}</p>

	{#if fn.kind === 'form'}
		<form class="fields" novalidate={!browser_checks} onsubmit={submit_form}>
			{#each fields as field (field.key)}
				{@const field_issues = issues_of(field.name)}
				{@const invalid = field_issues.length > 0}
				<label class:check={field.type === 'checkbox'}>
					<span class="field-name">{field.name}</span>
					{#if field.type === 'select'}
						<select name={field.key} {...field.constraints} aria-invalid={invalid}>
							{#if !field.constraints.required}<option value="">(not set)</option>{/if}
							{#each field.options as option, i (i)}
								<option selected={option === field.initial}>{option}</option>
							{/each}
						</select>
					{:else if field.type === 'checkbox'}
						<input type="checkbox" name={field.key} checked={field.initial === true} aria-invalid={invalid} />
					{:else}
						<input type={field.type} name={field.key} value={field.initial} {...field.constraints} aria-invalid={invalid} />
					{/if}
					{#if field.note}<span class="hint">{field.note}</span>{/if}
					<!-- index keys: two checks can report the same message -->
					{#each field_issues as issue, i (i)}
						<span class="issue">{issue.message}</span>
					{/each}
				</label>
			{:else}
				<p class="muted small">No fields found in the schema. The form submits empty.</p>
			{/each}
			{#each form_level_issues as issue, i (i)}
				<p class="issue">{issue.name ? `${issue.name}: ` : ''}{issue.message}</p>
			{/each}
			<div class="actions">
				<button class="btn primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit'}</button>
				<label class="muted small" title="Adds required, min, max, length and pattern from the JSON Schema, which a Kit form does not do by itself">
					<input type="checkbox" bind:checked={browser_checks} /> check in the browser first
				</label>
			</div>
		</form>
		<p class="muted small">Posted as multipart form data, like a native submit, so the server's real validation answers.</p>
	{:else}
		{#if fn.kind === 'prerender' && !fn.dynamic}
			<p class="note">
				Build-time only: in production this is served from prerendered files, not callable with new arguments. Dev
				answers anyway.
			</p>
		{/if}

		<div class="arg">
			<div class="arg-bar">
				<label><input type="checkbox" bind:checked={no_arg} /> no argument</label>
				{#if !no_arg}
					<label title="Evaluates the text with new Function — lets you write new Date(), new Map(), …">
						<input
							type="checkbox"
							checked={mode === 'js'}
							onchange={(e) => (mode = e.currentTarget.checked ? 'js' : 'json')}
						/> JS expression (evaluated!)
					</label>
					<button class="link" onclick={reset_source}>reset sample</button>
				{/if}
			</div>
			{#if !no_arg}
				<textarea
					bind:value={source}
					spellcheck="false"
					rows={Math.min(Math.max(source.split('\n').length, 2), 10)}
					aria-label="Argument"
					placeholder={mode === 'json' ? 'JSON argument' : 'JS expression, e.g. { at: new Date() }'}
				></textarea>
				<p class="muted small">
					{#if fn.kind === 'query_batch'}Array: one element per batched call.{/if}
					{#if mode === 'json'}Plain JSON: ISO date strings stay strings. Switch to JS expression for Date/Map/Set.{:else}Evaluated
						in the page with <code>new Function</code>, encoded with Kit's own serializer.{/if}
				</p>
			{/if}
		</div>

		<div class="actions">
			{#if fn.kind === 'query_live' && busy}
				<button class="btn danger" onclick={stop}>Stop</button>
			{:else if confirming}
				<span class="warn">This command mutates data on the server.</span>
				<button class="btn danger" onclick={run}>Yes, send</button>
				<button class="btn" onclick={() => (confirming = false)}>Cancel</button>
			{:else}
				<button class="btn primary" onclick={run} disabled={busy}>
					{busy ? 'Sending…' : fn.kind === 'query_live' ? 'Connect' : 'Send'}
				</button>
			{/if}
		</div>
	{/if}

	{#if failure}
		<pre class="err">{failure}</pre>
	{/if}

	{#if request}
		<div class="block">
			<h4>Request</h4>
			<p class="wrap"><b>{request.method}</b> {request.url}</p>
			{#if request.payloads.some(Boolean)}
				<p class="muted small wrap">payload{request.payloads.length > 1 ? 's' : ''}: {request.payloads.join(', ')}</p>
			{/if}
			{#if request.body instanceof FormData}
				<pre>{[...request.body].map(([key, value]) => `${key} = ${typeof value === 'string' ? value : `[File ${value.name}]`}`).join('\n')}</pre>
			{:else if request.body}<pre>{request.body}</pre>{/if}
			<div class="curl">
				<code class="wrap">{curl_line(request)}</code>
				<button class="btn small" onclick={() => request && copy(curl_line(request))}>{copied ? 'copied' : 'copy curl'}</button>
			</div>
		</div>
	{/if}

	{#if result}
		<div class="block" data-result={result.type}>
			<h4>
				Response <span class="status" class:bad={result.status >= 400 || result.type === 'error'}>{result.status}</span>
				<span class="muted">{result.type} · {result.durationMs.toFixed(0)} ms</span>
			</h4>
			{#if result.type === 'error'}
				<pre class="err">{pretty(result.error)}</pre>
			{:else if result.type === 'redirect'}
				<p>Redirect to <code>{result.location}</code></p>
			{:else if result.type === 'raw'}
				<pre>{result.raw}</pre>
			{:else if result.batch}
				<ol class="batch">
					{#each result.batch as item, i (i)}
						<li class:err={!item.ok}><pre>{pretty(item.value)}</pre></li>
					{/each}
				</ol>
			{:else}
				<pre class="value">{pretty(result.data?._)}</pre>
			{/if}

			{#if refreshed.length}
				<h5>Refreshed queries ({refreshed.length})</h5>
				{#each refreshed as [key, node] (key)}
					<p class="muted small wrap">{key}</p>
					<pre class:err={node.e !== undefined}>{pretty(node.e !== undefined ? node.e : node.v)}</pre>
				{/each}
			{/if}
			{#if reconnected.length}
				<h5>Reconnected live queries ({reconnected.length})</h5>
				{#each reconnected as [key, node] (key)}
					<p class="muted small wrap">{key}</p>
					<pre>{pretty(node.e !== undefined ? node.e : node.v)}</pre>
				{/each}
			{/if}
			{#if result.data?.i?.length}
				<p class="muted small">Ignored refresh keys: {result.data.i.join(', ')}</p>
			{/if}
		</div>
	{/if}

	{#if fn.kind === 'query_live' && live_status}
		<div class="block">
			<h4>Stream <span class="muted">{live_status} · {live_events.length} messages</span></h4>
			<ol class="live">
				{#each live_events as event (event.seq)}
					<li class:err={event.type === 'error'}>
						<span class="muted small">{new Date(event.at).toLocaleTimeString()} {event.type}</span>
						<pre>{pretty(event.value)}</pre>
					</li>
				{/each}
			</ol>
		</div>
	{/if}
</section>

<style>
	.pg {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
		color: var(--skrd-fg);
	}
	.pg-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 10px;
		padding-bottom: 4px;
		border-bottom: 1px solid var(--skrd-line);
	}
	p {
		margin: 0;
	}
	b,
	strong {
		color: var(--skrd-fg-strong);
	}
	.muted {
		color: var(--skrd-dim);
	}
	.small {
		font-size: 11px;
	}
	.wrap {
		overflow-wrap: anywhere;
	}
	.contract b {
		color: var(--skrd-accent);
	}
	.note {
		color: var(--skrd-warn);
		border-left: 2px solid var(--skrd-warn);
		padding: 2px 8px;
	}
	.arg {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.arg-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		align-items: center;
	}
	.arg-bar label {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		cursor: pointer;
	}
	textarea {
		font: inherit;
		width: 100%;
		resize: vertical;
		padding: 6px;
		border: 1px solid var(--skrd-line);
		border-radius: 4px;
		background: var(--skrd-code-bg);
		color: var(--skrd-fg);
		min-height: 3em;
	}
	textarea:focus {
		outline: none;
		border-color: var(--skrd-accent);
	}
	.fields {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.fields > label {
		display: grid;
		grid-template-columns: 14ch minmax(0, 320px);
		align-items: baseline;
		gap: 2px 10px;
	}
	.fields > label.check {
		align-items: center;
	}
	.fields > label.check input {
		justify-self: start;
	}
	.field-name {
		color: var(--skrd-muted);
	}
	.fields input:not([type='checkbox']),
	.fields select {
		font: inherit;
		padding: 3px 6px;
		border: 1px solid var(--skrd-line);
		border-radius: 4px;
		background: var(--skrd-code-bg);
		color: var(--skrd-fg);
	}
	.fields input:focus,
	.fields select:focus {
		outline: none;
		border-color: var(--skrd-accent);
	}
	.fields [aria-invalid='true'] {
		border-color: var(--skrd-bad);
	}
	.issue,
	.hint {
		grid-column: 2;
		color: var(--skrd-bad);
		font-size: 11px;
	}
	.hint {
		color: var(--skrd-dim);
	}
	p.issue {
		margin: 0;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}
	.warn {
		color: var(--skrd-num);
		font-weight: 600;
	}
	.btn {
		font: 12px/1.5 var(--skrd-font-ui);
		text-transform: uppercase;
		border: 1px solid var(--skrd-line);
		background: none;
		color: var(--skrd-muted);
		border-radius: var(--skrd-radius);
		padding: 3px 10px;
		cursor: pointer;
	}
	.btn:hover:not(:disabled) {
		border-color: var(--skrd-accent);
	}
	.btn.small {
		padding: 1px 6px;
		font-size: 11px;
	}
	.btn.primary {
		border-color: var(--skrd-accent);
		color: var(--skrd-accent);
	}
	.btn.danger {
		border-color: var(--skrd-bad);
		color: var(--skrd-bad);
	}
	.btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.link {
		font: inherit;
		background: none;
		border: 0;
		padding: 0;
		color: var(--skrd-accent);
		cursor: pointer;
		text-decoration: underline;
	}
	.block {
		border: 1px solid var(--skrd-line);
		border-radius: 4px;
		padding: 6px 8px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	h4,
	h5 {
		margin: 0;
		font-size: 12px;
		color: var(--skrd-fg-strong);
	}
	h5 {
		margin-top: 4px;
	}
	.status {
		padding: 0 5px;
		border-radius: 3px;
		border: 1px solid currentColor;
		color: var(--skrd-ok);
	}
	.status.bad {
		color: var(--skrd-bad);
	}
	pre {
		margin: 0;
		padding: 5px 7px;
		background: var(--skrd-code-bg);
		color: var(--skrd-fg);
		border-radius: 3px;
		overflow: auto;
		max-height: 260px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.err,
	.err pre {
		color: var(--skrd-bad);
	}
	.curl {
		display: flex;
		gap: 6px;
		align-items: flex-start;
		background: var(--skrd-code-bg);
		padding: 4px 6px;
		border-radius: 3px;
	}
	.curl code {
		flex: 1;
		font-size: 11px;
		color: var(--skrd-muted);
	}
	.batch,
	.live {
		margin: 0;
		padding-left: 22px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.live {
		max-height: 260px;
		overflow: auto;
	}
</style>
