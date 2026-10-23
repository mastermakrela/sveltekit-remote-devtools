<svelte:options css="injected" />

<script lang="ts">
	// Collapsible, one-line-per-leaf tree for decoded remote values (devalue output, incl. Date/Map/Set,
	// and the `{class}` / `{unserializable}` / … shapes the server shim substitutes for exotic values).
	import Value from './Value.svelte';
	import { describe_special, preview, special } from './model.ts';

	interface Props {
		value: unknown;
		label?: string;
		depth?: number;
		open?: boolean;
	}

	let { value, label, depth = 0, open = false }: Props = $props();

	const LONG = 160;
	const PAGE = 100;

	// `open` is only the initial expansion; the user toggles afterwards
	// svelte-ignore state_referenced_locally
	let expanded = $state(open);
	let full = $state(false);
	let limit = $state(PAGE);

	type Child = { label: string; value: unknown };

	const s = $derived(special(value));

	const children = $derived.by((): Child[] | null => {
		if (s?.tag === 'class') return Object.entries(s.rest).map(([k, v]) => ({ label: k, value: v }));
		if (s || typeof value !== 'object' || value === null) return null;
		if (value instanceof Date || value instanceof RegExp || value instanceof URL) return null;
		if (value instanceof Error) return null;
		if (Array.isArray(value)) return value.map((v, i) => ({ label: String(i), value: v }));
		if (value instanceof Map) return [...value].map(([k, v]) => ({ label: preview(k, 40), value: v }));
		if (value instanceof Set) return [...value].map((v, i) => ({ label: String(i), value: v }));
		return Object.entries(value).map(([k, v]) => ({ label: k, value: v }));
	});

	const tone = $derived.by(() => {
		if (s) return s.tag === 'unserializable' || s.tag === 'undecodable' || s.tag === 'truncated' ? 'warn' : 'special';
		if (value === undefined || value === null) return 'nil';
		if (typeof value === 'string') return 'str';
		if (typeof value === 'number' || typeof value === 'bigint') return 'num';
		if (typeof value === 'boolean') return 'bool';
		if (value instanceof Date) return 'date';
		return 'obj';
	});

	const summary = $derived.by(() => {
		if (s?.tag === 'class') return `${s.name} ${preview(s.rest, 60)}`;
		if (value instanceof Map) return `Map(${value.size}) ${preview(Object.fromEntries([...value].map(([k, v]) => [preview(k, 20), v])), 60)}`;
		if (value instanceof Set) return `Set(${value.size}) ${preview([...value], 60)}`;
		if (Array.isArray(value)) return `Array(${value.length}) ${preview(value, 60)}`;
		return preview(value, 70);
	});

	const leaf = $derived.by(() => {
		if (s) return describe_special(s);
		if (typeof value === 'string') return JSON.stringify(full ? value : value.slice(0, LONG));
		return preview(value, 200);
	});

	const long = $derived(typeof value === 'string' && value.length > LONG);
</script>

<div class="v" style:--depth={depth}>
	{#if children && children.length > 0}
		<button class="line toggle" aria-expanded={expanded} onclick={() => (expanded = !expanded)}>
			<span class="caret" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
			{#if label !== undefined}<span class="key">{label}:</span>{/if}
			<span class="summary">{summary}</span>
		</button>
		{#if expanded}
			{#each children.slice(0, limit) as child, i (i)}
				<Value label={child.label} value={child.value} depth={depth + 1} />
			{/each}
			{#if children.length > limit}
				<button class="line more" style:--depth={depth + 1} onclick={() => (limit += PAGE)}>
					… {children.length - limit} more
				</button>
			{/if}
		{/if}
	{:else}
		<div class="line">
			<span class="caret" aria-hidden="true"></span>
			{#if label !== undefined}<span class="key">{label}:</span>{/if}
			{#if children}
				<span class="obj">{Array.isArray(value) ? '[]' : value instanceof Map ? 'Map(0)' : value instanceof Set ? 'Set(0)' : '{}'}</span>
			{:else}
				<span class={tone} title={s?.tag === 'undecodable' ? s.raw : s?.tag === 'truncated' ? s.preview : undefined}>{leaf}</span>
				{#if long}
					<button class="more inline" onclick={() => (full = !full)}>
						{full ? 'less' : `… +${(value as string).length - LONG} chars`}
					</button>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.v {
		--indent: calc(var(--depth) * 12px);
		min-width: 0;
	}
	.line {
		display: flex;
		gap: 4px;
		align-items: baseline;
		width: 100%;
		min-width: 0;
		padding: 0 0 0 var(--indent);
		margin: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		line-height: 18px;
	}
	.line > span:last-child,
	.summary {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.toggle {
		cursor: pointer;
		border-radius: 3px;
	}
	.toggle:hover {
		background: var(--skrd-hover);
	}
	.toggle:focus-visible,
	.more:focus-visible {
		outline: 1px solid var(--skrd-accent);
		outline-offset: -1px;
	}
	.caret {
		flex: none;
		width: 10px;
		color: var(--skrd-dim);
	}
	.key {
		flex: none;
		color: var(--skrd-key);
	}
	.summary {
		color: var(--skrd-muted);
	}
	.str {
		color: var(--skrd-str);
		white-space: pre-wrap !important;
		word-break: break-all;
	}
	.num,
	.bool {
		color: var(--skrd-num);
	}
	.nil {
		color: var(--skrd-dim);
		font-style: italic;
	}
	.date {
		color: var(--skrd-date);
	}
	.special {
		color: var(--skrd-date);
		font-style: italic;
	}
	.warn {
		color: var(--skrd-warn);
	}
	.obj {
		color: var(--skrd-muted);
	}
	.more {
		cursor: pointer;
		color: var(--skrd-accent);
		padding-left: calc(var(--indent) + 14px);
	}
	.more.inline {
		flex: none;
		width: auto;
		padding: 0 4px;
		border: 0;
		background: none;
		font: inherit;
	}
</style>
