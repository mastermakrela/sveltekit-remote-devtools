<!-- every panel component injects its CSS into its root node: the document, or the shadow root of the Vite DevTools dock -->
<svelte:options css="injected" />

<script lang="ts">
	// Shell of the devtool: a floating toggle and a resizable panel with tabs, or, `docked` inside Vite DevTools,
	// just the tabs filling the dock. Each tab is its own component and owns its state; this file only routes
	// between them and defines the theme.
	import { store } from '../store.svelte.ts';
	import Timeline from './Timeline.svelte';
	import Live from './Live.svelte';
	import Endpoints from './Endpoints.svelte';

	let { docked = false }: { docked?: boolean } = $props();

	type Tab = 'timeline' | 'live' | 'endpoints';
	let tab = $state<Tab>('timeline');

	const tabs: Array<{ id: Tab; label: string; count: () => number }> = [
		{ id: 'timeline', label: 'Timeline', count: () => store.client.length + store.server.filter((s) => s.origin === 'ssr').length },
		{ id: 'live', label: 'Live', count: () => store.live.length },
		{ id: 'endpoints', label: 'Endpoints', count: () => store.manifest?.functions.length ?? 0 }
	];

	const HEIGHT_KEY = 'sveltekit-remote-devtools:height';
	const MIN_HEIGHT = 160;
	let height = $state(Number(localStorage.getItem(HEIGHT_KEY)) || Math.min(520, Math.round(innerHeight * 0.6)));
	const pending = $derived(store.client.filter((c) => c.status === 'pending').length);

	function set_height(next: number) {
		height = Math.round(Math.max(MIN_HEIGHT, Math.min(innerHeight - 60, next)));
		localStorage.setItem(HEIGHT_KEY, String(height));
	}

	function onpointerdown(event: PointerEvent) {
		const handle = event.currentTarget as HTMLElement;
		const start_y = event.clientY;
		const start_h = height;
		handle.setPointerCapture(event.pointerId);
		const move = (e: PointerEvent) => set_height(start_h + (start_y - e.clientY));
		const up = () => {
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', up);
			handle.removeEventListener('pointercancel', up);
		};
		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', up);
		handle.addEventListener('pointercancel', up);
	}

	function onhandlekey(event: KeyboardEvent) {
		if (event.key === 'ArrowUp') set_height(height + 24);
		else if (event.key === 'ArrowDown') set_height(height - 24);
		else return;
		event.preventDefault();
	}

	function onkeydown(event: KeyboardEvent) {
		// Alt+Shift+R toggles the panel from anywhere on the page
		if (event.altKey && event.shiftKey && event.code === 'KeyR') {
			event.preventDefault();
			store.open = !store.open;
		}
	}
</script>

<svelte:window {onkeydown} />

<div class="skrd" class:docked>
	{#if !docked}
		<button
			class="skrd-toggle"
			class:on={store.open}
			onclick={() => (store.open = !store.open)}
			title="Remote functions devtool (Alt+Shift+R)"
			aria-expanded={store.open}
		>
			<span class="dot" class:busy={pending > 0} aria-hidden="true"></span>
			remote <b>{tabs[0].count()}</b>
		</button>
	{/if}
	{#if docked || store.open}
		<section class="skrd-panel" aria-label="Remote functions devtool" style:height={docked ? null : `${height}px`}>
			{#if !docked}
				<button
					class="grip"
					aria-label="Resize panel (drag, or arrow up/down)"
					title="Drag to resize"
					{onpointerdown}
					onkeydown={onhandlekey}
				></button>
			{/if}
			<nav class="skrd-tabs">
				{#each tabs as t (t.id)}
					<button class:active={tab === t.id} aria-pressed={tab === t.id} onclick={() => (tab = t.id)}>
						{t.label}<span class="n">{t.count()}</span>
					</button>
				{/each}
				{#if store.manifestError}
					<span class="err" title={store.manifestError}>manifest error</span>
				{/if}
				{#if !docked}
					<button class="skrd-close" onclick={() => (store.open = false)} aria-label="Close" title="Close (Alt+Shift+R)">×</button>
				{/if}
			</nav>
			<div class="skrd-body">
				<!-- all tabs stay mounted so playground results and scroll positions survive switching -->
				<div class="tab" hidden={tab !== 'timeline'}><Timeline /></div>
				<div class="tab" hidden={tab !== 'live'}><Live /></div>
				<div class="tab pad" hidden={tab !== 'endpoints'}><Endpoints /></div>
			</div>
		</section>
	{/if}
</div>

<style>
	.skrd {
		/* theme: svelte.dev site-kit tokens, converted to px (see DESIGN.md); every tab reads these */
		--skrd-font-ui: 'Fira Sans', -apple-system, system-ui, sans-serif;
		--skrd-font-mono: 'Fira Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
		--skrd-radius: 4px;
		--skrd-bg: hsl(0, 0%, 100%);
		--skrd-fg: hsl(0, 0%, 15%);
		--skrd-fg-strong: hsl(0, 0%, 8%);
		--skrd-muted: hsl(0, 0%, 40%);
		--skrd-dim: hsl(0, 0%, 50%);
		--skrd-line: hsl(0, 0%, 92%);
		--skrd-hover: hsl(0, 0%, 95%);
		--skrd-accent: hsl(12, 93%, 43%);
		--skrd-on-accent: hsl(0, 0%, 100%);
		--skrd-blue: hsl(204, 100%, 38%);
		--skrd-chip: hsl(0, 0%, 95%);
		--skrd-code-bg: hsl(0, 0%, 99.3%);
		--skrd-toolbar-bg: hsl(0, 0%, 98.2%);
		--skrd-detail-bg: hsl(0, 0%, 99.3%);
		--skrd-write-bg: hsla(12, 93%, 43%, 0.03);
		--skrd-ssr-bg: hsla(204, 100%, 38%, 0.04);
		--skrd-ok: hsl(130, 45%, 32%);
		--skrd-bad: hsl(0, 70%, 45%);
		--skrd-warn: hsl(38, 90%, 35%);
		--skrd-str: hsl(30, 100%, 30%);
		--skrd-num: var(--skrd-accent);
		--skrd-key: var(--skrd-muted);
		--skrd-date: var(--skrd-blue);
		--skrd-shadow: 0 0 14px rgba(0, 0, 0, 0.1);

		position: fixed;
		right: 12px;
		bottom: 12px;
		z-index: 2147483000;
		font: 12px/1.6 var(--skrd-font-mono);
		color: var(--skrd-fg);
		text-align: left;
		letter-spacing: normal;
		-webkit-font-smoothing: antialiased;
	}
	@media (prefers-color-scheme: dark) {
		.skrd {
			--skrd-bg: hsl(220, 10%, 12%);
			--skrd-fg: hsl(220, 3%, 80%);
			--skrd-fg-strong: hsl(220, 2%, 90%);
			--skrd-muted: hsl(220, 5%, 65%);
			--skrd-dim: hsl(220, 5%, 55%);
			--skrd-line: hsl(220, 15%, 22%);
			--skrd-hover: hsl(220, 15%, 21%);
			--skrd-accent: hsl(12, 94%, 62%);
			--skrd-on-accent: hsl(220, 10%, 12%);
			--skrd-blue: hsl(204, 88%, 65%);
			--skrd-chip: hsl(220, 15%, 21%);
			--skrd-code-bg: hsl(220, 8%, 10%);
			--skrd-toolbar-bg: hsl(220, 12%, 14%);
			--skrd-detail-bg: hsl(220, 8%, 10%);
			--skrd-write-bg: hsla(12, 94%, 62%, 0.04);
			--skrd-ssr-bg: hsla(204, 88%, 65%, 0.04);
			--skrd-ok: hsl(130, 35%, 62%);
			--skrd-bad: hsl(0, 80%, 70%);
			--skrd-warn: hsl(40, 80%, 62%);
			--skrd-str: hsl(41, 37%, 68%);
			--skrd-num: hsl(19, 67%, 75%);
			--skrd-shadow: 0 2px 16px rgba(0, 0, 0, 0.5);
		}
	}
	/* inside Vite DevTools the dock owns position, size and frame */
	.skrd.docked,
	.docked .skrd-panel {
		position: static;
		width: auto;
		height: 100%;
		max-height: none;
		border: 0;
		border-radius: 0;
		box-shadow: none;
	}
	.skrd :global(*) {
		box-sizing: border-box;
	}
	.skrd-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		background: var(--skrd-bg);
		color: var(--skrd-fg);
		border: 1px solid var(--skrd-line);
		border-radius: 999px;
		padding: 4px 12px 4px 10px;
		cursor: pointer;
		font: 13px/1.5 var(--skrd-font-ui);
		box-shadow: var(--skrd-shadow);
	}
	.skrd-toggle:hover,
	.skrd-toggle.on {
		border-color: var(--skrd-accent);
	}
	.skrd-toggle b {
		color: var(--skrd-fg-strong);
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--skrd-ok);
	}
	.dot.busy {
		background: var(--skrd-warn);
		animation: pulse 0.8s ease-in-out infinite alternate;
	}
	@keyframes pulse {
		to {
			opacity: 0.3;
		}
	}
	.skrd-panel {
		container: skrd / inline-size;
		position: fixed;
		right: 12px;
		bottom: 48px;
		width: min(980px, calc(100vw - 24px));
		max-height: calc(100vh - 60px);
		display: flex;
		flex-direction: column;
		background: var(--skrd-bg);
		border: 1px solid var(--skrd-line);
		border-radius: var(--skrd-radius);
		box-shadow: var(--skrd-shadow);
		overflow: hidden;
	}
	.grip {
		flex: none;
		display: block;
		width: 100%;
		padding: 0;
		border: 0;
		height: 6px;
		cursor: ns-resize;
		touch-action: none;
		background: linear-gradient(var(--skrd-dim), var(--skrd-dim)) center / 36px 2px no-repeat;
		opacity: 0.5;
	}
	.grip:hover,
	.grip:focus-visible {
		opacity: 1;
		outline: none;
	}
	.skrd-tabs {
		flex: none;
		display: flex;
		align-items: stretch;
		padding: 0 4px;
		border-bottom: 1px solid var(--skrd-line);
		font: 13px/1.5 var(--skrd-font-ui);
	}
	.skrd-tabs button {
		display: flex;
		align-items: center;
		gap: 6px;
		background: none;
		color: var(--skrd-muted);
		border: 0;
		border-bottom: 1px solid transparent;
		margin-bottom: -1px;
		padding: 8px 10px;
		cursor: pointer;
		font: inherit;
	}
	.skrd-tabs button:hover {
		color: var(--skrd-fg-strong);
	}
	.skrd-tabs button:focus-visible {
		outline: 1px solid var(--skrd-accent);
		outline-offset: -1px;
	}
	.skrd-tabs button.active {
		color: var(--skrd-fg-strong);
		border-bottom-color: var(--skrd-accent);
	}
	.n {
		padding: 0 5px;
		border-radius: 2px;
		background: var(--skrd-chip);
		color: var(--skrd-dim);
		font-size: 11px;
		line-height: 16px;
	}
	.err {
		align-self: center;
		color: var(--skrd-bad);
		font-size: 11px;
	}
	.skrd-tabs .skrd-close {
		margin-left: auto;
		font-size: 16px;
		padding: 0 8px;
	}
	.skrd-body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: auto;
	}
	.tab {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.tab[hidden] {
		display: none;
	}
	.pad {
		padding: 8px;
		overflow: auto;
	}
	@container skrd (max-width: 420px) {
		.skrd-tabs button {
			padding: 5px 7px;
		}
	}
</style>
