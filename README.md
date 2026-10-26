# sveltekit-remote-devtools

See it in action on the [landing page](https://mastermakrela.github.io/sveltekit-remote-devtools/).

Dev-only devtool for SvelteKit [remote functions](https://svelte.dev/docs/kit/remote-functions). Drops a floating panel into your app during `vite dev` that shows:

- **Endpoints**: every `query`, `query.batch`, `query.live`, `command`, `form` and `prerender` in the project, with its URL, HTTP contract, input/output TypeScript types, JSON Schema (Zod, Valibot, or any Standard JSON Schema vendor), duplicate-signature and same-name findings, plus a playground to call any of them. Forms get a real form built from their schema, posted like a native submit, so you see the server's validation issues per field. The same list opens as a full page at `/__remote-devtools/`, with a file tree to find functions by the module that declares them or the files that import them.
- **Timeline**: every remote call, decoded. Payloads are `base64url(devalue)` on the wire and unreadable in the Network tab; here you see the argument, the result, the SSR calls that ran while the page rendered, and for commands and forms the single-flight refresh tree: which queries the client asked to refresh (`.updates(...)`), which the server refreshed itself (`refresh()` / `refreshAll()`), which were ignored, and the new values.
- **Live**: the queries Kit currently holds in its client cache for this page, with their arguments and last known values.

Works with SvelteKit 2.27+ (tested on 2.70 and 3.1), Vite 6.3+, Svelte 5, any package manager. Input/output types need TypeScript 5 or 6 in the app (TypeScript 7 has no compiler API yet); without it everything else still works.

## Install

```sh
bun add -D sveltekit-remote-devtools   # or: pnpm add -D / npm i -D
```

```ts
// vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import { remoteDevtools } from 'sveltekit-remote-devtools';

export default defineConfig({
	plugins: [sveltekit(), remoteDevtools()]
});
```

Run `vite dev`, open any page, click the `● remote` pill bottom-right (or press Alt+Shift+R). Nothing is added to production builds (`apply: 'serve'`).

Options: `remoteDevtools({ ui: false })` keeps only the JSON endpoints; `types: false` skips the TypeScript checker.

With [Vite DevTools](https://devtools.vite.dev) enabled (`bun add -d @vitejs/devtools`, then `devtools: true` in `vite.config`), the panel moves into its dock as "Remote functions" instead of floating. The plugin also loads the dock itself, because Vite DevTools injects it with `transformIndexHtml`, which SvelteKit never runs. The dock renders in the page, not an iframe, so every tab works there as well. The look follows [DESIGN.md](DESIGN.md).

Endpoints served by the dev server:

- `/__remote-devtools/`: the Endpoints tab as a full page with a file tree (not with `ui: false`)
- `/__remote-devtools/manifest.json`: the endpoint inventory (regenerated when a file in `src` changes)
- `/__remote-devtools/events.json?since=<seq>`: the last 1000 server-side call events

The two JSON endpoints are meant for scripts and coding agents too. The manifest's shape is the `RemoteManifest` type, exported from the package and documented in [`src/node/manifest.ts`](src/node/manifest.ts). Fields worth querying:

- `duplicates` and `sameName`: functions that share one input/output signature, or one export name
- `functions[].importedBy`: an empty list means nothing imports the function
- `functions[].validation.mode`: `"unchecked"` means the input is never validated
- `functions[].types.input` / `.output`: the TypeScript types, as text and as a JSON tree

```sh
curl -s 'http://[::1]:5173/__remote-devtools/manifest.json' | jq '.duplicates'
```

Use the address your dev server's banner prints.

### Agent skills

[`skills/`](skills) has a skill for coding agents that works from these endpoints:

- [`remote-functions-audit`](skills/remote-functions-audit/SKILL.md): finds duplicated or nearly duplicated functions, functions nothing imports, inputs without validation, N+1 query calls that should be `query.batch`, and `.updates()` the server never handles, then proposes fixes

```sh
bunx skills add mastermakrela/sveltekit-remote-devtools   # or: pnpm dlx / npx
```

## How it works

Everything is a Vite plugin; SvelteKit itself is not patched.

| Need | Mechanism |
| --- | --- |
| Which remote functions exist, their URLs | Walk `src` with Kit's own `/[/.]remote\.[^/]+$/` pattern, hash the path with Kit's djb2, import each module through the SSR module runner and read `fn.__` (type, id, name) |
| Input schema with constraints | Inside remote modules only, `$app/server` is swapped for a shim that forwards to the real functions and pins the schema on the returned object. Converted to JSON Schema via `~standard.jsonSchema` (Zod 4, ArkType…) or `@valibot/to-json-schema` |
| TypeScript input/output types | One `ts.Program` over the remote files; Kit's public aliases (`RemoteQueryFunction<Input, Output, Validated>` etc.) carry them as type arguments |
| Every call, decoded, including SSR | The same shim wraps each handler. On settle it emits an event with the argument, result, duration, `event.isRemoteRequest` (HTTP vs SSR), the page pathname, a per-request id, and a synchronous snapshot of `state.remote.explicit` (server-initiated refreshes) and `state.remote.requested` (client-requested ones). Events go to the browser over the Vite HMR channel and into a ring buffer for pages that connect later |
| Calls made by the browser | A tiny import-free `fetch` wrapper prepended to Kit's client entry (`transform` hook), so it runs before hydration. It records requests to `<base>/<appDir>/remote/*`, clones JSON responses, and adds an `x-remote-devtools-call` header so the server trace can be matched to the client call |
| Kit's live query cache | The panel imports Kit's `runtime/client/client.js` by absolute path with the same `?v=` query Vite gives Kit's own imports, so it reads the app's real `query_map` instance. Only keys and proxy counts are read: touching a Query's getters would start fetches |

The panel is Svelte 5, compiled by the host app's own Svelte plugin (the package ships `.svelte` source under `src/client`), mounted into `<div id="sveltekit-remote-devtools">`.

## Caveats

- Importing a remote module through the SSR runner registers it with Kit: after the manifest builds, orphan modules answer in dev although they would not exist in production. The Endpoints tab marks files that nothing imports.
- Importing runs top-level code (database clients and friends) for every remote module, once.
- `fn.__`, the setup plugin's `api.options`, the hash function and `state.remote` are Kit internals. They are stable across 2.27–3.0-next today but can change in any release.
- Result capture on the server truncates values above 64 KB and summarises class instances and Files.

## Development

```sh
bun run build   # tsc → dist (the Vite plugin; the UI is shipped as source). Also runs on pack/publish
bun run check   # tsc + svelte-check
```
