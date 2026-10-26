---
name: remote-functions-audit
description: Audit a SvelteKit app's remote functions (query, query.batch, query.live, command, form, prerender) and propose fixes - duplicated or nearly duplicated functions, functions nothing imports, inputs without validation, N+1 query calls that should be query.batch, and .updates() the server never handles. Uses the JSON that sveltekit-remote-devtools serves during `vite dev`. Use when asked to audit, review, deduplicate or clean up remote functions or .remote.ts files.
---

# Audit SvelteKit remote functions

Needs the `sveltekit-remote-devtools` Vite plugin in the app and its dev server running (`remoteDevtools({ ui: false })` is enough). The plugin serves two JSON documents the audit reads:

- `/__remote-devtools/manifest.json`: every remote function with its kind, file, input/output types, validation and importers. Its shape is the `RemoteManifest` type exported by the package.
- `/__remote-devtools/events.json`: the last 1000 calls the server handled during this dev session.

## 1. Find the dev server

Look for the app's running Vite server instead of guessing the port: `lsof -nP -iTCP -sTCP:LISTEN | grep node`, then check the process's working directory is this app. If none is running, start `vite dev` in the background and read the URL from its banner. Vite without `--host` often binds only `[::1]`, so use the exact address the banner prints.

The runtime checks (N+1, `.updates()`) only see calls that already happened. Before running them, load the app's main pages and do the main writes: ask the user to click through, or drive a browser yourself. Say in the report which flows were covered.

## 2. Run the audit

`<this skill's dir>` is the folder holding this file. The skill also ships inside the npm package, at `node_modules/sveltekit-remote-devtools/skills/remote-functions-audit/`.

```sh
node <this skill's dir>/audit.mjs 'http://[::1]:5173'      # the origin your dev server's banner prints
node <this skill's dir>/audit.mjs 'http://[::1]:5173' 0.5  # lower the duplicate similarity bar (default 0.6)
```

Every finding is a lead, not a verdict: open the code before proposing anything. If the output says types are unavailable (TypeScript 7, or none installed), the duplicate check is skipped and the rest still works.

## 3. Act on each section

### Duplicate candidates

Pairs are only compared within one family: reads (`query*`, `prerender`) with reads, writes (`command`, `form`) with writes. The score is how much the flattened input and output types overlap (1.00 means identical; `User` counts as matching `User[]`). Pairs are also listed when their names share a noun and a synonym verb (`getUser` / `fetchUsers`).

Open both handlers. Two functions with the same shape are often different operations: `shearSheep(id)` and `removeSheep(id)` both take a `string`. That's especially true for writes, so be skeptical of a write pair unless its names or bodies say the same thing.

Classify each pair:

| Finding | Proposal |
| --- | --- |
| Same data, same source (copy-pasted query) | Keep one; point the other's importers at it. Delete the copy, or re-export it while migrating |
| One output is a subset of the other's, same source | Keep the wider one; derive the narrow view at the call site. Keep both only if the narrow one exists to avoid a costly join or to hide fields from the client (say which) |
| Two queries differing by a filter or flag (`getActiveUsers` / `getUsers`) | One query with that filter as an optional input field in its schema |
| A single-item query next to a list query over the same rows (`getUser` / `getUsers`) | Usually fine as is. If the single query runs once per row on a page, propose `query.batch` instead |
| Two writes doing the same mutation | Keep one, with the union of their validation |
| Same shape, different meaning | Leave them alone and say why in one line |

### Imported by nothing

No file imports the function, or the whole remote file. It's dead code, except for functions called only from inside their own module (another remote function refreshes them, for example), which the import graph doesn't see. Grep the name before proposing deletion. While the app runs in dev, these files still answer requests, even though they won't exist in production.

### Input not validated

The function takes an argument with `'unchecked'` instead of a schema, so anyone can send it any value. Propose a schema in the validation library the app already uses (Zod, Valibot, ArkType), drafted from the input type that `manifest.json` lists for that function (`types.input.text`) and tightened from what the handler does with each field.

### Module failed to import

Importing the module ran top-level code that threw: a database client, a seed, a missing env var. Its functions still appear, but from TypeScript alone: no schema, and `query.batch` shows up as `query`. Propose moving that work into a lazily initialized helper, so importing the module has no side effects.

### N+1 queries

A plain `query` called with 3 or more different arguments while rendering one page, either in one SSR request or in one burst of HTTP calls. Usually one call per row of a list. Propose `query.batch` with the same argument type: Kit then sends every argument from that render in one request, and the handler loads the rows in a single lookup.

### .updates() the server never handled

The client asked to refresh a query with `.updates(query(...))`, and the command or form never handled the request with `requested(query, limit)`. Kit then fails that query on the client. Either the server should accept it (`await requested(query, limit).refreshAll()`), or the client shouldn't ask.

## 4. What a merge or rename has to touch

`importedBy` on each function lists the files that import it. Grep those files for the function name and include every one in the proposal:

- **Refresh wiring.** A query's identity is its function. Every `.refresh()`, `refreshAll()`, `requested(oldFn, n)` in commands and forms, and `.updates(oldFn(...))` on the client must point at the surviving function and pass the new argument shape. A missed one silently stops refreshing; nothing fails.
- **Forms.** The schema's field names are the `name=` attributes in the markup (`form.fields.x`), so merging two forms means touching their templates.
- **URL.** A function's endpoint is `<hash of file>/<export name>`. Moving or renaming it changes the URL, so tabs opened before the deploy will call an endpoint that no longer exists.

## 5. Report

Group the findings by section. For each one you'd change: the functions with `file:line`, what you found, the proposed change (for merges, the signature of the surviving function), and the files and call sites to edit. Then list what you looked at and rejected, one line each with the reason. Make no edits unless asked.
