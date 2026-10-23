// Renderer of the Vite DevTools dock entry (`custom-render`, registered in node/plugin.ts). It runs in the
// page realm, so the panel shares the app's Kit client and the store `main.ts` connected.
import { mount, unmount } from 'svelte';
import Panel from './ui/Panel.svelte';

/** The part of `@devframes/hub`'s `DockClientScriptContext` we use */
interface DockContext {
	current: {
		domElements: { panel?: HTMLElement | null };
		events: { on(event: 'dom:panel:mounted', listener: (panel: HTMLElement) => void): unknown };
	};
}

export default function setup({ current }: DockContext) {
	let panel: ReturnType<typeof mount> | undefined;
	const attach = (target: HTMLElement) => {
		if (panel) unmount(panel);
		panel = mount(Panel, { target, props: { docked: true } });
	};
	if (current.domElements.panel) attach(current.domElements.panel);
	current.events.on('dom:panel:mounted', attach);
}
