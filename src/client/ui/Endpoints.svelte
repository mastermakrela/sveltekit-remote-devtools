<svelte:options css="injected" />

<script lang="ts">
	// Endpoints tab: every remote function in the app, grouped by module, with its HTTP contract,
	// types and validation, plus a playground to invoke it.
	import type { RemoteFunctionEntry, RemoteKind } from '../../node/manifest.ts';
	import { store } from '../store.svelte.ts';
	import { format_type } from '../format.ts';
	import Playground from './Playground.svelte';
	import Kind from './Kind.svelte';
	import { KIND_LABEL as kind_labels, is_write } from './model.ts';

	const kinds: RemoteKind[] = ['query', 'query_batch', 'query_live', 'prerender', 'command', 'form'];

	let filter = $state('');
	let active_kinds = $state<RemoteKind[]>([]);
	let selected = $state<string | null>(null);
	let reloading = $state(false);

	const manifest = $derived(store.manifest);
	const selected_fn = $derived(selected ? (manifest?.functions.find((f) => f.id === selected) ?? null) : null);

	const kind_counts = $derived.by(() => {
		const counts: Partial<Record<RemoteKind, number>> = {};
		for (const f of manifest?.functions ?? []) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
		return counts;
	});

	const modules = $derived.by(() => {
		if (!manifest) return [];
		const needle = filter.trim().toLowerCase();
		const matches = (f: RemoteFunctionEntry) =>
			(active_kinds.length === 0 || active_kinds.includes(f.kind)) &&
			(!needle || `${f.name} ${f.file} ${kind_labels[f.kind]} ${f.id}`.toLowerCase().includes(needle));
		const filtering = needle !== '' || active_kinds.length > 0;
		return manifest.files
			.map((file) => ({ ...file, functions: manifest.functions.filter((f) => f.file === file.file && matches(f)) }))
			.filter((file) => file.functions.length > 0 || (!filtering && file.error));
	});

	function toggle_kind(kind: RemoteKind) {
		active_kinds = active_kinds.includes(kind) ? active_kinds.filter((k) => k !== kind) : [...active_kinds, kind];
	}

	async function reload() {
		reloading = true;
		await store.load_manifest();
		reloading = false;
	}

	function validation_label(fn: RemoteFunctionEntry) {
		if (fn.validation.mode === 'standard-schema') return fn.validation.vendor;
		return fn.validation.mode === 'unchecked' ? 'unchecked' : 'none';
	}
</script>

<div class="ep">
	{#if store.manifestError}
		<div class="error-box">
			<strong>Manifest could not be built</strong>
			<pre>{store.manifestError}</pre>
			<button class="btn" onclick={reload}>Retry</button>
		</div>
	{/if}

	{#if !manifest}
		{#if !store.manifestError}<p class="muted">Loading manifest…</p>{/if}
	{:else if selected_fn}
		{#key selected_fn.id}
			<Playground fn={selected_fn} onclose={() => (selected = null)} />
		{/key}
	{:else}
		<header class="head">
			<div class="summary">
				<span><b>{manifest.functions.length}</b> functions</span>
				<span><b>{manifest.files.length}</b> modules</span>
				<span>Kit {manifest.kit.version}</span>
				<button class="btn small" onclick={reload} disabled={reloading} title="Rebuild the manifest (also happens on file save)">
					{reloading ? 'reloading…' : '↻ reload'}
				</button>
			</div>
			<input class="search" type="search" bind:value={filter} placeholder="Filter by name, file, kind or id" aria-label="Filter endpoints" />
			<div class="chips" role="group" aria-label="Filter by kind">
				{#each kinds as kind (kind)}
					{#if kind_counts[kind]}
						<button
							class="chip"
							class:write={is_write(kind)}
							class:on={active_kinds.includes(kind)}
							aria-pressed={active_kinds.includes(kind)}
							onclick={() => toggle_kind(kind)}>{kind_labels[kind]} {kind_counts[kind]}</button
						>
					{/if}
				{/each}
			</div>
			{#if manifest.typesError}
				<p class="warn-line">Types unavailable: {manifest.typesError}</p>
			{/if}
			{#if manifest.duplicates.length || manifest.sameName.length}
				<div class="findings">
					{#each manifest.duplicates as group (group.signature)}
						<details class="finding">
							<summary><span class="badge dup">duplicate</span> {group.ids.length} endpoints share one signature</summary>
							<p class="muted small wrap">{group.signature}</p>
							<ul>
								{#each group.ids as id (id)}
									{@const f = store.function_of(id)}
									<li><button class="link" onclick={() => (selected = id)}>{f?.name ?? id}</button> <span class="muted">{f?.file}</span></li>
								{/each}
							</ul>
						</details>
					{/each}
					{#each manifest.sameName as group (group.name)}
						<details class="finding">
							<summary><span class="badge same">same name</span> {group.name} in {group.ids.length} modules</summary>
							<ul>
								{#each group.ids as id (id)}
									{@const f = store.function_of(id)}
									<li>
										<span class="muted">{f?.file}</span>
										{f ? kind_labels[f.kind] : ''}
									</li>
								{/each}
							</ul>
						</details>
					{/each}
				</div>
			{/if}
		</header>

		{#each modules as file (file.file)}
			<section class="module">
				<div class="module-head">
					<strong class="wrap">{file.file}</strong>
					<span class="muted">#{file.hash}</span>
				</div>
				{#if file.importedBy.length}
					<p class="muted small wrap">imported by {file.importedBy.join(', ')}</p>
				{:else}
					<p class="warn-line">Not imported by anything — has no endpoint in production.</p>
				{/if}
				{#if file.error}<pre class="err">{file.error}</pre>{/if}

				<ul class="fns">
					{#each file.functions as fn (fn.id)}
						<li>
							<div class="row">
								<Kind kind={fn.kind} />
								<span class="name">{fn.name}</span>
								<span class="sig wrap">
									<code>{fn.types.input?.text ?? '?'}</code> → <code>{fn.types.output?.text ?? '?'}</code>
								</span>
								<button class="btn small try" onclick={() => (selected = fn.id)}>Try</button>
							</div>
							<details class="more">
								<summary>
									<span class="method">{fn.http.method}</span>
									<span class="wrap">{fn.http.url}</span>
									<span class="val">{validation_label(fn)}</span>
								</summary>
								<dl>
									<dt>request</dt>
									<dd class="wrap">{fn.http.request}</dd>
									<dt>response</dt>
									<dd class="wrap">{fn.http.response}</dd>
									<dt>validation</dt>
									<dd>
										{#if fn.validation.mode === 'standard-schema'}
											Standard Schema ({fn.validation.vendor}){#if fn.validation.jsonSchemaSource}, JSON Schema via {fn.validation.jsonSchemaSource}{/if}
											{#if fn.validation.error}<span class="err">{fn.validation.error}</span>{/if}
										{:else if fn.validation.mode === 'unchecked'}
											'unchecked': any input reaches the handler as-is
										{:else}
											no argument accepted
										{/if}
										{#if fn.dynamic !== undefined}
											<br /><span class="muted">{fn.dynamic ? 'dynamic: callable at runtime' : 'build-time only'}</span>
										{/if}
									</dd>
									{#if fn.types.input}
										<dt>input</dt>
										<dd><pre>{format_type(fn.types.input.tree)}</pre></dd>
									{/if}
									{#if fn.types.validated && fn.types.validated.text !== fn.types.input?.text}
										<dt>handler gets</dt>
										<dd><pre>{format_type(fn.types.validated.tree)}</pre></dd>
									{/if}
									{#if fn.types.output}
										<dt>output</dt>
										<dd><pre>{format_type(fn.types.output.tree)}</pre></dd>
									{/if}
									{#if fn.validation.mode === 'standard-schema' && fn.validation.jsonSchema}
										<dt>JSON Schema</dt>
										<dd>
											<details>
												<summary class="muted">show</summary>
												<pre>{JSON.stringify(fn.validation.jsonSchema, null, 2)}</pre>
											</details>
										</dd>
									{/if}
									<dt>id</dt>
									<dd class="wrap muted">{fn.id}</dd>
								</dl>
							</details>
						</li>
					{/each}
				</ul>
			</section>
		{:else}
			<p class="muted">Nothing matches. Clear the filter to see every remote function.</p>
		{/each}
	{/if}
</div>

<style>
	.ep {
		container-type: inline-size;
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
		color: var(--skrd-fg);
	}
	p {
		margin: 0;
	}
	.muted {
		color: var(--skrd-dim);
	}
	.small {
		font-size: 11px;
	}
	.wrap {
		overflow-wrap: anywhere;
		min-width: 0;
	}
	b,
	strong {
		color: var(--skrd-fg-strong);
	}
	.head {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.summary {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 12px;
	}
	.summary .btn {
		margin-left: auto;
	}
	.search {
		font: inherit;
		padding: 4px 6px;
		border: 1px solid var(--skrd-line);
		border-radius: 4px;
		width: 100%;
		background: var(--skrd-code-bg);
		color: var(--skrd-fg);
	}
	.search:focus {
		outline: none;
		border-color: var(--skrd-accent);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.chip {
		font: 12px/1.5 var(--skrd-font-ui);
		border: 1px solid var(--skrd-line);
		background: var(--skrd-chip);
		color: var(--skrd-blue);
		border-radius: var(--skrd-radius);
		padding: 1px 8px;
		cursor: pointer;
	}
	.chip.write {
		color: var(--skrd-accent);
	}
	.chip.on {
		border-color: currentColor;
		background: var(--skrd-hover);
	}
	.findings {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.finding summary {
		cursor: pointer;
	}
	.finding ul {
		margin: 2px 0 4px;
		padding-left: 20px;
	}
	.badge {
		font-size: 10px;
		padding: 0 5px;
		border-radius: 3px;
		border: 1px solid currentColor;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.badge.dup {
		color: var(--skrd-warn);
	}
	.badge.same {
		color: var(--skrd-muted);
	}
	.warn-line {
		font-size: 11px;
		color: var(--skrd-warn);
		border-left: 2px solid var(--skrd-warn);
		padding: 0 6px;
	}
	.error-box {
		border: 1px solid var(--skrd-bad);
		padding: 6px 8px;
		border-radius: 4px;
	}
	.module {
		display: flex;
		flex-direction: column;
		gap: 3px;
		border-top: 1px solid var(--skrd-line);
		padding-top: 6px;
	}
	.module-head {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 8px;
		align-items: baseline;
	}
	.fns {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.fns > li {
		border-bottom: 1px solid var(--skrd-line);
		padding: 3px 0;
	}
	.fns > li:last-child {
		border-bottom: 0;
	}
	.row {
		display: grid;
		grid-template-columns: 12ch minmax(90px, max-content) 1fr auto;
		gap: 8px;
		align-items: baseline;
	}
	.name {
		font-weight: 600;
		color: var(--skrd-fg-strong);
		overflow-wrap: anywhere;
	}
	.sig {
		color: var(--skrd-muted);
	}
	.more {
		margin-left: calc(12ch + 8px);
	}
	.more > summary {
		cursor: pointer;
		color: var(--skrd-dim);
		font-size: 11px;
	}
	.method {
		font-weight: 600;
		color: var(--skrd-accent);
	}
	.val {
		margin-left: 6px;
		padding: 0 4px;
		border: 1px solid var(--skrd-line);
		border-radius: 3px;
		color: var(--skrd-muted);
	}
	dl {
		display: grid;
		grid-template-columns: 90px 1fr;
		gap: 3px 8px;
		margin: 4px 0 6px;
	}
	dt {
		color: var(--skrd-dim);
	}
	dd {
		margin: 0;
		min-width: 0;
	}
	pre {
		margin: 0;
		padding: 4px 6px;
		background: var(--skrd-code-bg);
		color: var(--skrd-fg);
		border-radius: 3px;
		overflow: auto;
		max-height: 220px;
		font-size: 11px;
	}
	.err {
		color: var(--skrd-bad);
	}
	.btn {
		font: 12px/1.5 var(--skrd-font-ui);
		text-transform: uppercase;
		border: 1px solid var(--skrd-line);
		background: none;
		color: var(--skrd-muted);
		border-radius: var(--skrd-radius);
		padding: 2px 8px;
		cursor: pointer;
	}
	.btn:hover {
		border-color: var(--skrd-accent);
	}
	.btn.small {
		font-size: 11px;
		padding: 1px 7px;
	}
	.try {
		color: var(--skrd-accent);
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
	@container (max-width: 560px) {
		.row {
			grid-template-columns: auto 1fr auto;
		}
		.sig {
			grid-column: 1 / -1;
			grid-row: 2;
		}
		.more {
			margin-left: 0;
		}
		dl {
			grid-template-columns: 1fr;
		}
		dd {
			margin-bottom: 4px;
		}
	}
</style>
