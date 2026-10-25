// Entry of the full-page explorer served at `/__remote-devtools/` (see node/plugin.ts). No Kit app runs on this
// page: the store only loads the manifest and follows its updates.
import { mount } from 'svelte';
import Explorer from './ui/Explorer.svelte';
import { store } from './store.svelte.ts';

store.connect();
mount(Explorer, { target: document.body });
