// Vite plugin (dev only). Responsibilities:
// - serve a manifest of every remote function at `/__remote-devtools/manifest.json`
// - replace `$app/server` inside remote modules with a shim that captures schemas and traces calls
// - inject the client tap into SvelteKit's client entry and mount the devtool UI
// - forward server-side call events to the browser over the Vite HMR channel
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchForWorkspaceRoot, type Alias, type Plugin, type RunnableDevEnvironment, type ViteDevServer } from 'vite';
import { discover_remotes, posix, remote_module_pattern } from './discover.ts';
import { canonical, type HttpContract, type RemoteKind, type RemoteManifest, type RemoteFunctionEntry } from './manifest.ts';
import { to_validation, type CapturedValidator } from './schema.ts';
import { EMIT_SYMBOL, SCHEMA_SYMBOL, shim_source } from './shim.ts';
// typescript is an optional peer: load the extractor only when types are wanted
import type { TypeExtractor } from './types.ts';

export const MANIFEST_PATH = '/__remote-devtools/manifest.json';
export const EVENTS_PATH = '/__remote-devtools/events.json';
/** How many server-side call events to keep for late-joining pages (SSR calls happen before the browser connects) */
const EVENT_BUFFER = 1000;
export const WS_SERVER_EVENT = 'sveltekit-remote-devtools:server-call';
export const WS_MANIFEST_EVENT = 'sveltekit-remote-devtools:manifest';

const SHIM_ID = 'virtual:sveltekit-remote-devtools/app-server';
const VIRTUAL_PREFIX = 'virtual:sveltekit-remote-devtools/';
const CONFIG_ID = `${VIRTUAL_PREFIX}config`;

export interface RemoteDevtoolsOptions {
	/** Mount the floating panel in the browser (default true). The manifest endpoint is always served. */
	ui?: boolean;
	/** Extract input/output types with the TypeScript checker (default true; costs ~0.5s on first request) */
	types?: boolean;
}

/**
 * The subset of SvelteKit's validated config we rely on (exposed as `api.options` on its setup plugin).
 * Kit 2 nests it under `kit` and has no `files.src` (only `files.routes`); Kit 3 flattens it.
 */
interface KitOptions {
	appDir: string;
	paths: { base: string };
	moduleExtensions: string[];
	files: { src?: string; routes?: string };
}

/**
 * The slice of `@vitejs/devtools-kit`'s plugin hook we use, typed locally so the package needs no dependency on
 * it: Vite ignores the `devtools` key unless `@vitejs/devtools` is installed and `devtools` is enabled.
 */
interface ViteDevtoolsHook {
	devtools?: {
		setup(context: {
			docks: {
				register(entry: { id: string; title: string; icon: string; type: 'custom-render'; renderer: { importFrom: string } }): unknown;
			};
		}): void;
	};
}

interface RemoteInternals {
	type: RemoteKind;
	id: string;
	name: string;
	dynamic?: boolean;
}

/** Kit type alias → kind, for modules that could not be imported */
const alias_kinds: Record<string, RemoteKind> = {
	RemoteQueryFunction: 'query',
	RemoteLiveQueryFunction: 'query_live',
	RemoteCommand: 'command',
	RemoteForm: 'form',
	RemotePrerenderFunction: 'prerender'
};
const kit_client_entry_pattern = /\/@sveltejs\/kit\/src\/runtime\/client\/entry\.js(\?.*)?$/;
const validator_key = Symbol.for(SCHEMA_SYMBOL);
const emit_key = Symbol.for(EMIT_SYMBOL);

function http_contract(kind: RemoteKind, url: string): HttpContract {
	const payload = 'base64url(devalue.stringify(arg))';
	const result = '{ type: "result", data: devalue.stringify({ _: output, ...refreshes }) }';
	switch (kind) {
		case 'query':
			return { method: 'GET', url: `${url}?payload=<payload>`, request: `payload = ${payload}`, response: result };
		case 'query_live':
			return { method: 'GET', url: `${url}?payload=<payload>`, request: `payload = ${payload}`, response: 'text/event-stream of { type: "result", result }' };
		case 'query_batch':
			return { method: 'POST', url, request: `JSON { payloads: ${payload}[] }`, response: result };
		case 'command':
			return { method: 'POST', url, request: `JSON { payload: ${payload}, refreshes: string[] }`, response: result };
		case 'form':
			return { method: 'POST', url, request: 'form-encoded body (multipart / urlencoded, or Kit binary form when enhanced)', response: result };
		case 'prerender':
			return { method: 'GET', url: `${url}/<payload>`, request: `payload = ${payload} as a path segment`, response: result };
	}
}

export function remoteDevtools(options: RemoteDevtoolsOptions = {}): Array<Plugin & ViteDevtoolsHook> {
	const ui = options.ui ?? true;
	const extract_types = options.types ?? true;

	const package_dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	const client_dir = path.join(package_dir, 'src', 'client');

	let root = process.cwd();
	let kit: KitOptions;
	let kit_dir = '';
	let kit_version = 'unknown';
	let devalue_path = 'devalue';
	/** Vite DevTools is on: the UI mounts as one of its docks instead of as a floating panel */
	let docked = false;
	let vite_base = '/';
	let subpath_imports: Record<string, string> = {};
	let aliases: Alias[] = [];
	let server: ViteDevServer;
	let extractor: TypeExtractor | undefined;
	let cached: Promise<RemoteManifest> | undefined;
	const events: Array<Record<string, unknown>> = [];
	let event_seq = 0;

	const src_dir = () => kit.files.src ?? (kit.files.routes ? path.dirname(kit.files.routes) : 'src');

	async function build_manifest(): Promise<RemoteManifest> {
		let t = performance.now();
		const discovered = discover_remotes(root, src_dir(), kit.moduleExtensions, subpath_imports, aliases);
		const discoverMs = performance.now() - t;

		// Not `isRunnableDevEnvironment`: it is an instanceof check, false when the package resolves its own copy of
		// Vite (linked installs).
		const ssr = server.environments.ssr as Partial<RunnableDevEnvironment>;
		if (!ssr.runner) throw new Error('sveltekit-remote-devtools needs a runnable SSR environment');

		t = performance.now();
		const runtime = new Map<string, Array<[string, RemoteInternals, CapturedValidator]>>();
		const errors = new Map<string, string>();
		for (const remote of discovered) {
			try {
				// Side effect worth knowing: importing a remote module through the SSR runner is exactly what
				// registers it with SvelteKit in dev, so after this its endpoints answer even if no page imports it.
				const mod: Record<string, { __?: RemoteInternals; [validator_key]?: CapturedValidator }> =
					await ssr.runner.import(remote.absolute);
				runtime.set(
					remote.file,
					Object.entries(mod)
						.filter(([, value]) => value?.__?.type)
						.map(([name, value]) => [name, value.__!, value[validator_key] ?? null])
				);
			} catch (error) {
				errors.set(remote.file, error instanceof Error ? error.message : String(error));
			}
		}
		const importMs = performance.now() - t;

		t = performance.now();
		let types = new Map<string, RemoteFunctionEntry['types']>();
		let types_error: string | undefined;
		if (extract_types) {
			try {
				extractor ??= new (await import('./types.ts')).TypeExtractor(root);
				types = extractor.extract(discovered.map((r) => r.file));
			} catch (error) {
				types_error = error instanceof Error ? error.message : String(error);
			}
		}
		const typescriptMs = performance.now() - t;

		const functions: RemoteFunctionEntry[] = [];
		for (const remote of discovered) {
			const prefix = `${remote.file}#`;
			// A module that failed to import still has exports TypeScript can see: fall back to the type
			// aliases so the inventory stays complete (kind inferred, no schema).
			const entries: Array<[string, RemoteInternals, CapturedValidator, 'runtime' | 'static']> =
				runtime.get(remote.file)?.map(([name, internals, validator]) => [name, internals, validator, 'runtime' as const]) ??
				[...types]
					.filter(([key, t]) => key.startsWith(prefix) && t.alias && alias_kinds[t.alias])
					.map(([key, t]) => [key.slice(prefix.length), { type: alias_kinds[t.alias!], id: '', name: key.slice(prefix.length) }, null, 'static' as const]);

			for (const [name, internals, validator, source] of entries) {
				const id = `${remote.hash}/${name}`;
				const url = `${kit.paths.base}/${kit.appDir}/remote/${id}`;
				const fn_types = types.get(`${remote.file}#${name}`) ?? { alias: null, input: null, validated: null, output: null };
				const family = ['command', 'form'].includes(internals.type) ? 'write' : 'read';
				functions.push({
					id,
					hash: remote.hash,
					name,
					file: remote.file,
					kind: internals.type,
					dynamic: internals.type === 'prerender' ? !!internals.dynamic : undefined,
					http: http_contract(internals.type, url),
					validation: await to_validation(validator),
					types: fn_types,
					signature: `${family} ${canonical(fn_types.input?.tree)} → ${canonical(fn_types.output?.tree)}`,
					source
				});
			}
		}

		const group = (key: (f: RemoteFunctionEntry) => string) => {
			const groups = Map.groupBy(functions, key);
			return [...groups].filter(([, fns]) => fns.length > 1).map(([k, fns]) => ({ key: k, ids: fns.map((f) => f.id) }));
		};

		return {
			generatedAt: new Date().toISOString(),
			kit: { version: kit_version, appDir: kit.appDir, base: kit.paths.base },
			timings: { discoverMs, importMs, typescriptMs },
			typesError: types_error,
			files: discovered.map((r) => ({ file: r.file, hash: r.hash, importedBy: r.importedBy, error: errors.get(r.file) })),
			functions,
			duplicates: group((f) => f.signature).map(({ key, ids }) => ({ signature: key, ids })),
			sameName: group((f) => f.name).map(({ key, ids }) => ({ name: key, ids }))
		};
	}

	return [
		{
			name: 'sveltekit-remote-devtools:app-server-shim',
			apply: 'serve',
			enforce: 'pre',
			resolveId: {
				filter: { id: new RegExp(`^${SHIM_ID}$`) },
				handler: () => '\0' + SHIM_ID
			},
			load: {
				filter: { id: new RegExp(`^\\0${SHIM_ID}$`) },
				handler: () => shim_source(devalue_path)
			},
			transform: {
				filter: { id: remote_module_pattern, code: '$app/server' },
				handler(code) {
					if (this.environment.config.consumer !== 'server') return;
					return { code: code.replace(/(['"])\$app\/server\1/g, `'${SHIM_ID}'`), map: null };
				}
			}
		},
		{
			name: 'sveltekit-remote-devtools',
			apply: 'serve',
			config(config) {
				// The UI sources live in this package, which may sit outside the app's workspace (a linked
				// package). Vite refuses to serve files outside `server.fs.allow`, so widen it — keeping the
				// default workspace root, which an explicit `allow` would otherwise replace.
				const allow = config.server?.fs?.allow ?? [searchForWorkspaceRoot(config.root ?? process.cwd())];
				return { server: { fs: { allow: [...allow, package_dir] } } };
			},
			devtools: {
				setup(context) {
					if (!ui) return;
					context.docks.register({
						id: 'sveltekit-remote-devtools',
						title: 'Remote functions',
						icon: 'simple-icons:svelte',
						// rendered in the page realm (not an iframe), so the panel shares Kit's client.js with the app
						type: 'custom-render',
						// a URL, not the bare id: the hub reads `virtual:` as a URL scheme and skips Vite's resolution
						renderer: { importFrom: `${vite_base}@id/${VIRTUAL_PREFIX}dock` }
					});
				}
			},
			configResolved(config) {
				root = config.root;
				docked = !!config.devtools && config.devtools.enabled;
				vite_base = config.base;
				const setup = config.plugins.find((p) => p.name === 'vite-plugin-sveltekit-setup');
				const options = (setup?.api as { options?: KitOptions & { kit?: KitOptions } } | undefined)?.options;
				kit = options?.kit ?? options ?? {
					appDir: '_app',
					paths: { base: '' },
					moduleExtensions: ['.js', '.ts'],
					files: { src: 'src' }
				};
				const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
				subpath_imports = pkg.imports ?? {};
				aliases = config.resolve.alias;

				// Resolve Kit and devalue from the app, following symlinks: the devtool imports Kit's client
				// runtime by absolute path so it shares the *same module instance* as the app (query_map etc.).
				const require = createRequire(path.join(root, 'package.json'));
				kit_dir = fs.realpathSync(path.dirname(require.resolve('@sveltejs/kit/package.json')));
				kit_version = JSON.parse(fs.readFileSync(path.join(kit_dir, 'package.json'), 'utf8')).version;
				try {
					devalue_path = posix(fs.realpathSync(createRequire(path.join(kit_dir, 'package.json')).resolve('devalue')));
				} catch {
					devalue_path = 'devalue';
				}
			},
			resolveId(id) {
				if (!id.startsWith(VIRTUAL_PREFIX)) return;
				const name = id.slice(VIRTUAL_PREFIX.length);

				// Kit's own imports of its runtime carry Vite's `?v=<browserHash>` query (node_modules files do).
				// Without the same query the browser would load a second instance of client.js, with an empty
				// query_map. Use the optimizer's current hash: the module graph keeps ids with stale hashes after
				// a re-optimization, so it is only the fallback.
				const shared = (file: string) => {
					const abs = path.join(kit_dir, file);
					const env = this.environment as unknown as {
						moduleGraph?: { getModulesByFile(file: string): Set<{ id: string | null }> | undefined };
						depsOptimizer?: { metadata?: { browserHash?: string } };
					};
					const hash = env.depsOptimizer?.metadata?.browserHash;
					if (hash) return `${abs}?v=${hash}`;
					for (const mod of env.moduleGraph?.getModulesByFile(abs) ?? []) {
						if (mod.id?.includes('?v=')) return mod.id;
					}
					return abs;
				};

				switch (name) {
					case 'config':
						return '\0' + CONFIG_ID;
					case 'kit-client':
						return shared('src/runtime/client/client.js');
					case 'kit-shared':
						return shared('src/runtime/shared.js');
					case 'tap':
						return path.join(client_dir, 'tap.js');
					case 'main':
						return path.join(client_dir, 'main.ts');
					case 'dock':
						return path.join(client_dir, 'dock.ts');
				}
			},
			load(id) {
				if (id !== '\0' + CONFIG_ID) return;
				return [
					`export const base = ${JSON.stringify(kit.paths.base)};`,
					`export const app_dir = ${JSON.stringify(kit.appDir)};`,
					`export const kit_version = ${JSON.stringify(kit_version)};`,
					`export const manifest_path = ${JSON.stringify(MANIFEST_PATH)};`,
					`export const events_path = ${JSON.stringify(EVENTS_PATH)};`,
					`export const ws_server_event = ${JSON.stringify(WS_SERVER_EVENT)};`,
					`export const ws_manifest_event = ${JSON.stringify(WS_MANIFEST_EVENT)};`,
					`export const docked = ${docked};`
				].join('\n');
			},
			transform: {
				filter: { id: kit_client_entry_pattern },
				handler(code) {
					if (!ui || this.environment.config.consumer !== 'client') return;
					// The tap must wrap `fetch` before the first remote call (which happens during hydration),
					// and must not import anything from Kit: in Kit 3 the entry sets the payload *after* our
					// import evaluates. The prefix lets the tap recognise remote URLs without importing $app/paths.
					const prefix = `${kit.paths.base}/${kit.appDir}/remote/`;
					return {
						code: `globalThis.__SK_REMOTE_DEVTOOLS_PREFIX__ = ${JSON.stringify(prefix)};\nimport ${JSON.stringify(VIRTUAL_PREFIX + 'tap')};\n${code}`,
						map: null
					};
				}
			},
			configureServer(_server) {
				server = _server;

				// The shim (running inside the SSR module runner, same process) hands us call events. They are
				// pushed live over the HMR channel and kept in a ring buffer so a page can fetch the SSR calls
				// of its own render, which happened before its HMR client connected.
				(globalThis as Record<symbol, unknown>)[emit_key] = (data: Record<string, unknown>) => {
					const event = { ...data, serverSeq: ++event_seq };
					events.push(event);
					if (events.length > EVENT_BUFFER) events.splice(0, events.length - EVENT_BUFFER);
					server.ws.send({ type: 'custom', event: WS_SERVER_EVENT, data: event });
				};

				server.middlewares.use(EVENTS_PATH, (req, res) => {
					const since = Number(new URL(req.url ?? '/', 'http://localhost').searchParams.get('since') ?? 0);
					res.setHeader('content-type', 'application/json');
					res.end(JSON.stringify(events.filter((e) => (e.serverSeq as number) > since)));
				});

				const invalidate = (file: string) => {
					if (!file.startsWith(path.resolve(root, src_dir()))) return;
					cached = undefined;
					server.ws.send({ type: 'custom', event: WS_MANIFEST_EVENT });
				};
				server.watcher.on('change', invalidate);
				server.watcher.on('add', invalidate);
				server.watcher.on('unlink', invalidate);

				server.middlewares.use(MANIFEST_PATH, (_req, res) => {
					cached ??= build_manifest();
					cached.then(
						(manifest) => {
							res.setHeader('content-type', 'application/json');
							res.end(JSON.stringify(manifest, null, 2));
						},
						(error: Error) => {
							cached = undefined;
							res.statusCode = 500;
							res.end(JSON.stringify({ error: error.stack ?? error.message }));
						}
					);
				});
			}
		}
	];
}
