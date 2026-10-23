// Ambient declarations for the virtual modules the Vite plugin resolves (see node/plugin.ts).

declare module 'virtual:sveltekit-remote-devtools/config' {
	export const base: string;
	export const app_dir: string;
	export const kit_version: string;
	export const manifest_path: string;
	export const events_path: string;
	export const ws_server_event: string;
	export const ws_manifest_event: string;
	/** Vite DevTools is enabled: the panel mounts into its dock (`dock.ts`) instead of floating */
	export const docked: boolean;
}

/** SvelteKit's `src/runtime/client/client.js`, imported by absolute path so it is the app's own instance */
declare module 'virtual:sveltekit-remote-devtools/kit-client' {
	/** `undefined` until Kit's `start()` has run, which can be after the panel loads */
	export const app: { decoders?: Record<string, (value: unknown) => unknown>; hooks?: { transport?: unknown } } | undefined;
	export const query_map: Map<string, Map<string, { proxy_count: number; resource: unknown }>>;
	export const live_query_map: Map<string, Map<string, { proxy_count: number; resource: unknown }>>;
	export const query_responses: Record<string, { v?: unknown; e?: unknown }>;
}

/** SvelteKit's `src/runtime/shared.js` */
declare module 'virtual:sveltekit-remote-devtools/kit-shared' {
	/** Kit 3 takes one argument; Kit 2 takes `(value, transport)` */
	export function stringify_remote_arg(value: unknown, transport?: unknown): string;
	export function stringify_command_arg(value: unknown, transport?: unknown): Promise<string>;
	export function create_remote_key(id: string, payload: string): string;
	export function split_remote_key(key: string): { id: string; payload: string };
}
