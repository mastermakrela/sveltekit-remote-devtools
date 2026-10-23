// Entry of the in-page devtool. Imported lazily by tap.js once the page has loaded.
import { mount } from 'svelte';
import { docked } from 'virtual:sveltekit-remote-devtools/config';
import Panel from './ui/Panel.svelte';
import { store } from './store.svelte.ts';

const HOST_ID = 'sveltekit-remote-devtools';

if (!document.getElementById(HOST_ID)) {
	const host = document.createElement('div');
	host.id = HOST_ID;
	document.body.appendChild(host);
	store.connect();
	if (docked) {
		// Vite DevTools injects its dock with `transformIndexHtml`, which SvelteKit never runs, so load it here.
		// The dock then mounts the panel through `dock.ts`.
		const script = document.createElement('script');
		script.type = 'module';
		script.src = '/__devtools/embedded.js';
		document.body.appendChild(script);
	} else {
		mount(Panel, { target: host });
	}
}
