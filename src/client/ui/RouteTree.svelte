<svelte:options css="injected" />

<script module lang="ts">
	import type { RemoteFunctionEntry, RemoteManifest } from '../../node/manifest.ts';

	export type Mode = 'declared' | 'imported';
	/** What the sidebar picked: `dir:<path>`, `file:<path>` or `fn:<id>`, read in the mode it was picked in */
	export type Selection = { mode: Mode; key: string } | null;

	/** The tree's files: modules that declare functions, or files that import them */
	export function leaves_of(manifest: RemoteManifest, mode: Mode) {
		if (mode === 'declared') {
			const by_file = Map.groupBy(manifest.functions, (fn) => fn.file);
			return manifest.files.map((f) => ({ path: f.file, fns: by_file.get(f.file) ?? [] }));
		}
		const uses = manifest.functions.flatMap((fn) => fn.importedBy.map((file) => ({ file, fn })));
		return [...Map.groupBy(uses, (use) => use.file)].map(([path, of_file]) => ({ path, fns: of_file.map((use) => use.fn) }));
	}

	/** Ids under a selection, resolved against the current manifest so a rebuilt manifest keeps it accurate */
	export function selected_ids(manifest: RemoteManifest, selection: NonNullable<Selection>): string[] {
		const split = selection.key.indexOf(':');
		const [kind, value] = [selection.key.slice(0, split), selection.key.slice(split + 1)];
		if (kind === 'fn') return [value];
		const inside = leaves_of(manifest, selection.mode).filter((l) => (kind === 'file' ? l.path === value : l.path.startsWith(`${value}/`)));
		return [...new Set(inside.flatMap((l) => l.fns.map((f) => f.id)))];
	}
</script>

<script lang="ts">
	// Sidebar of the full page: remote functions as a file tree, either by the module that declares them or by
	// the files that import them. Folder chains with a single child collapse into one row, like trees.software.
	import { SvelteSet } from 'svelte/reactivity';
	import { is_write } from './model.ts';

	let { manifest, selection = $bindable(null) }: { manifest: RemoteManifest; selection?: Selection } = $props();

	interface Dir {
		name: string;
		path: string;
		dirs: Dir[];
		files: Array<{ name: string; path: string; fns: RemoteFunctionEntry[] }>;
	}

	let mode = $state<Mode>('declared');
	let filter = $state('');
	const collapsed = new SvelteSet<string>();

	const leaves = $derived(leaves_of(manifest, mode));

	const tree = $derived.by(() => {
		const needle = filter.trim().toLowerCase();
		const root: Dir = { name: '', path: '', dirs: [], files: [] };
		for (const leaf of leaves) {
			const fns = needle && !leaf.path.toLowerCase().includes(needle) ? leaf.fns.filter((f) => f.name.toLowerCase().includes(needle)) : leaf.fns;
			if (fns.length === 0) continue;
			const parts = leaf.path.split('/');
			let dir = root;
			for (const part of parts.slice(0, -1)) {
				const path = dir.path ? `${dir.path}/${part}` : part;
				let next = dir.dirs.find((d) => d.path === path);
				if (!next) dir.dirs.push((next = { name: part, path, dirs: [], files: [] }));
				dir = next;
			}
			dir.files.push({ name: parts.at(-1)!, path: leaf.path, fns });
		}
		return flatten(root);
	});

	function flatten(dir: Dir): Dir {
		let current = dir;
		while (current.files.length === 0 && current.dirs.length === 1 && current.path) {
			const [only] = current.dirs;
			current = { ...only, name: `${current.name}/${only.name}` };
		}
		return { ...current, dirs: current.dirs.map(flatten) };
	}

	function ids_of(dir: Dir): string[] {
		return [...new Set([...dir.files.flatMap((f) => f.fns.map((fn) => fn.id)), ...dir.dirs.flatMap(ids_of)])];
	}

	/** `src/routes/sheep/[id]/+page.svelte` → `/sheep/[id]`, for files that belong to a route */
	function route_of(path: string) {
		const match = path.match(/(?:^|\/)routes(\/.*)?\/\+(?:page|layout|server)[^/]*$/);
		return match ? match[1] || '/' : null;
	}

	function select(key: string) {
		selection = selection?.key === key ? null : { mode, key };
	}

	function switch_mode(next: Mode) {
		mode = next;
		selection = null;
	}

	function toggle(path: string) {
		if (collapsed.has(path)) collapsed.delete(path);
		else collapsed.add(path);
	}

	const total = $derived(manifest.functions.length);
</script>

{#snippet chevron(open: boolean)}
	<svg class="chev" class:open viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
{/snippet}

{#snippet folder(dir: Dir)}
	{@const open = filter !== '' || !collapsed.has(dir.path)}
	{@const ids = ids_of(dir)}
	<li>
		<div class="row" class:selected={selection?.key === `dir:${dir.path}`}>
			<button class="twist" aria-expanded={open} aria-label="{open ? 'Collapse' : 'Expand'} {dir.name}" onclick={() => toggle(dir.path)}>
				{@render chevron(open)}
			</button>
			<button class="label" onclick={() => select(`dir:${dir.path}`)} title={dir.path}>
				<span class="name">{#each dir.name.split('/') as part, i (i)}{#if i}<span class="sep">/</span>{/if}{part}{/each}</span>
				<span class="count">{ids.length}</span>
			</button>
		</div>
		{#if open}
			<ul>
				{#each dir.dirs as child (child.path)}{@render folder(child)}{/each}
				{#each dir.files as file (file.path)}{@render leaf(file)}{/each}
			</ul>
		{/if}
	</li>
{/snippet}

{#snippet leaf(file: Dir['files'][number])}
	{@const open = filter !== '' || !collapsed.has(file.path)}
	{@const route = route_of(file.path)}
	<li>
		<div class="row" class:selected={selection?.key === `file:${file.path}`}>
			<button class="twist" aria-expanded={open} aria-label="{open ? 'Collapse' : 'Expand'} {file.name}" onclick={() => toggle(file.path)}>
				{@render chevron(open)}
			</button>
			<button class="label" onclick={() => select(`file:${file.path}`)} title={file.path}>
				<span class="name file">{file.name}</span>
				{#if route}<span class="route">{route}</span>{/if}
				<span class="count">{file.fns.length}</span>
			</button>
		</div>
		{#if open}
			<ul>
				{#each file.fns as fn (fn.id)}
					<li>
						<div class="row" class:selected={selection?.key === `fn:${fn.id}`}>
							<button class="label fn" onclick={() => select(`fn:${fn.id}`)} title="{fn.kind} in {fn.file}">
								<span class="dot" class:write={is_write(fn.kind)} aria-hidden="true"></span>
								<span class="name">{fn.name}</span>
								{#if mode === 'imported'}<span class="route">{fn.file.split('/').at(-1)}</span>{/if}
							</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</li>
{/snippet}

<nav class="tree" aria-label="Remote functions by file">
	<div class="modes" role="group" aria-label="Group by">
		<button aria-pressed={mode === 'declared'} onclick={() => switch_mode('declared')}>Declared in</button>
		<button aria-pressed={mode === 'imported'} onclick={() => switch_mode('imported')}>Imported in</button>
	</div>
	<input class="search" type="search" bind:value={filter} placeholder="Search files and functions" aria-label="Search files and functions" />
	<div class="row all" class:selected={selection === null}>
		<button class="label" onclick={() => (selection = null)}>
			<span class="name">All functions</span><span class="count">{total}</span>
		</button>
	</div>
	<ul class="root">
		{#each tree.dirs as dir (dir.path)}{@render folder(dir)}{/each}
		{#each tree.files as file (file.path)}{@render leaf(file)}{/each}
	</ul>
	{#if tree.dirs.length === 0 && tree.files.length === 0}
		<p class="empty">
			{filter ? 'No file or function matches.' : mode === 'imported' ? 'No file imports a remote function yet.' : 'No remote modules found.'}
		</p>
	{/if}
</nav>

<style>
	.tree {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
		font: 13px/1.4 var(--skrd-font-ui);
		color: var(--skrd-fg);
	}
	.modes {
		display: flex;
		padding: 2px;
		border-radius: var(--skrd-radius);
		background: var(--skrd-chip);
	}
	.modes button {
		flex: 1;
		font: inherit;
		font-size: 12px;
		padding: 3px 6px;
		border: 0;
		border-radius: 3px;
		background: none;
		color: var(--skrd-muted);
		cursor: pointer;
	}
	.modes button[aria-pressed='true'] {
		background: var(--skrd-bg);
		color: var(--skrd-fg-strong);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
	}
	.search {
		font: inherit;
		font-size: 12px;
		padding: 4px 8px;
		border: 1px solid var(--skrd-line);
		border-radius: var(--skrd-radius);
		background: var(--skrd-code-bg);
		color: var(--skrd-fg);
	}
	.search:focus {
		outline: none;
		border-color: var(--skrd-accent);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	ul ul {
		/* indent guide under the parent's chevron */
		margin-left: 11px;
		padding-left: 6px;
		border-left: 1px solid var(--skrd-line);
	}
	.row {
		display: flex;
		align-items: center;
		height: 26px;
		border-radius: var(--skrd-radius);
	}
	.row:hover {
		background: var(--skrd-hover);
	}
	.row.selected {
		background: color-mix(in srgb, var(--skrd-accent) 12%, transparent);
	}
	.row.selected .name {
		color: var(--skrd-accent);
	}
	button {
		font: inherit;
		color: inherit;
		background: none;
		border: 0;
		cursor: pointer;
	}
	button:focus-visible {
		outline: 1px solid var(--skrd-accent);
		outline-offset: -1px;
		border-radius: var(--skrd-radius);
	}
	.twist {
		flex: none;
		display: grid;
		place-items: center;
		width: 22px;
		height: 100%;
		padding: 0;
		color: var(--skrd-dim);
	}
	.chev {
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		transition: transform 0.12s;
	}
	.chev.open {
		transform: rotate(90deg);
	}
	.label {
		flex: 1;
		min-width: 0;
		height: 100%;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 6px 0 2px;
		text-align: left;
	}
	.all .label,
	.label.fn {
		padding-left: 8px;
	}
	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--skrd-fg-strong);
	}
	.name.file {
		color: var(--skrd-fg);
	}
	.fn .name {
		font: 12px/1.4 var(--skrd-font-mono);
	}
	.sep {
		color: var(--skrd-dim);
		padding: 0 1px;
	}
	.route {
		flex: none;
		font: 11px/1.4 var(--skrd-font-mono);
		color: var(--skrd-dim);
	}
	.count {
		margin-left: auto;
		flex: none;
		font-size: 11px;
		color: var(--skrd-dim);
	}
	.dot {
		flex: none;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--skrd-blue);
	}
	.dot.write {
		background: var(--skrd-accent);
	}
	.empty {
		margin: 4px 8px;
		color: var(--skrd-dim);
		font-size: 12px;
	}
	@media (prefers-reduced-motion: reduce) {
		.chev {
			transition: none;
		}
	}
</style>
