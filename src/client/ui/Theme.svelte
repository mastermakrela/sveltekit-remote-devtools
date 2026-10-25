<svelte:options css="injected" />

<script lang="ts">
	// Colour and type tokens shared by the floating panel, the Vite DevTools dock and the full page.
	// A component rather than a stylesheet: inside the dock's shadow root only component CSS gets injected.
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="skrd-theme">{@render children()}</div>

<style>
	.skrd-theme {
		display: contents;
		/* svelte.dev site-kit tokens, converted to px (see DESIGN.md) */
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
	}
	@media (prefers-color-scheme: dark) {
		.skrd-theme {
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
	.skrd-theme :global(*) {
		box-sizing: border-box;
	}
</style>
