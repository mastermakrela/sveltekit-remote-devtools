// Source of the virtual module that replaces `$app/server` *inside remote modules only* (SSR, dev only).
//
// Two jobs:
// 1. Schema capture. SvelteKit closes over the schema in `create_validator`, so it is not reachable
//    from `fn.__`. The shim pins the validator onto the returned function/object under a global symbol,
//    which the manifest builder (same Node process) reads back.
// 2. Call tracing. Every handler is wrapped so that each invocation — whether it came in over HTTP or
//    was called directly during SSR — emits an event to the devtool. The event carries the decoded
//    argument, the result, timing, and (for commands/forms) which queries were refreshed in the same
//    request: `state.remote.explicit` holds the single-flight refreshes registered by `.refresh()`
//    / `.set()` / `refreshAll()`, and `state.remote.requested` what the client asked for via `.updates()`.
//    The snapshot is taken synchronously the moment the handler settles, because Kit's
//    `collect_remote_data` drains `explicit` right after.
//
// Handler shapes are preserved: `form` handlers receive `(data, issue)`, `query.batch` receives `args[]`,
// `query.live` returns an (async) iterable that must not be awaited. The wrapper forwards arguments and
// returns the original value untouched.

export const SCHEMA_SYMBOL = 'sveltekit-remote-devtools.validator';
export const EMIT_SYMBOL = 'sveltekit-remote-devtools.emit';

/** @param devalue_path absolute path of the app's devalue copy (a bare `devalue` import doesn't resolve under pnpm's strict layout) */
export const shim_source = (devalue_path: string) => `
import * as kit from '$app/server';
import { get_request_store } from '@sveltejs/kit/internal/server';
import * as devalue from ${JSON.stringify(devalue_path)};
export * from '$app/server';

const validator_key = Symbol.for(${JSON.stringify(SCHEMA_SYMBOL)});
const emit_key = Symbol.for(${JSON.stringify(EMIT_SYMBOL)});

// query(fn) | query(schema, fn) | query('unchecked', fn) — only a 2nd function argument means "has validator"
const validator_of = (a, b) => (typeof b === 'function' ? a : null);

const MAX_CHARS = 64 * 1024;

const builtin = new Set([Object, Array, Date, Map, Set, RegExp, Error, URL, Uint8Array, ArrayBuffer]);

/** devalue with reducers that never throw on app classes, Files, or other exotic values */
function safe_stringify(value) {
	try {
		const text = devalue.stringify(value, {
			File: (v) => (typeof File !== 'undefined' && v instanceof File ? { name: v.name, size: v.size, type: v.type } : undefined),
			Unknown: (v) => {
				if (typeof v === 'function') return { function: v.name || 'anonymous' };
				if (typeof v !== 'object' || v === null) return undefined;
				const ctor = v.constructor;
				if (!ctor || builtin.has(ctor) || Object.getPrototypeOf(v) === null) return undefined;
				if (typeof v[Symbol.asyncIterator] === 'function' || typeof v[Symbol.iterator] === 'function') return { iterable: ctor.name };
				if (typeof v.then === 'function') return { promise: true };
				return { class: ctor.name, ...Object.fromEntries(Object.entries(v)) };
			}
		});
		return text.length > MAX_CHARS ? { text: devalue.stringify({ truncated: true, preview: text.slice(0, 2000) }), truncated: true } : { text, truncated: false };
	} catch (error) {
		return { text: devalue.stringify({ unserializable: String(error?.message ?? error) }), truncated: false };
	}
}

// One id per incoming HTTP request (a page render or a remote call), so the devtool can group the
// remote functions that ran inside the same request. Keyed on the Request object Kit hands out.
const request_ids = new WeakMap();
let next_request_id = 0;
function request_id_of(request) {
	if (!request || typeof request !== 'object') return null;
	let id = request_ids.get(request);
	if (id === undefined) request_ids.set(request, (id = ++next_request_id));
	return id;
}

function snapshot(state) {
	const remote = state?.remote;
	const refreshed = remote?.explicit ? [...remote.explicit.keys()] : [];
	// Map<id, Set<payload>> built from the refreshes list the client sent
	const requested = remote?.requested ? [...remote.requested].flatMap(([id, payloads]) => [...payloads].map((p) => id + '/' + p)) : [];
	return { refreshed, requested };
}

/** Wraps a handler so each invocation is reported to the devtool once it settles. */
function trace(get_remote, fn) {
	if (typeof fn !== 'function') return fn;
	return function traced(...args) {
		const emit = globalThis[emit_key];
		if (!emit) return fn.apply(this, args);

		const started = performance.now();
		let store = null;
		try {
			store = get_request_store();
		} catch {}
		const event = store?.event;
		const state = store?.state;
		const headers = event?.request?.headers;
		const remote = get_remote();
		const __ = remote?.__ ?? {};

		const finish = (outcome, value, error) => {
			try {
				emit({
					type: 'server-call',
					id: __.id || null,
					name: __.name || null,
					kind: __.type || null,
					origin: event?.isRemoteRequest ? 'http' : 'ssr',
					// event.url throws inside queries by design, request.url does not
					requestUrl: event?.request?.url ?? null,
					pathname: headers?.get('x-sveltekit-pathname') ?? (event?.request?.url ? new URL(event.request.url).pathname : null),
					correlation: headers?.get('x-remote-devtools-call') ?? null,
					requestId: request_id_of(event?.request),
					method: event?.request?.method ?? null,
					// only the data argument: form handlers also receive the issue helper (a proxy that recurses forever)
					args: safe_stringify(args[0]),
					result: outcome === 'ok' ? safe_stringify(value) : null,
					error: error ? { message: String(error?.message ?? error), status: error?.status ?? null } : null,
					outcome,
					durationMs: performance.now() - started,
					at: Date.now(),
					...snapshot(state)
				});
			} catch {}
		};

		let result;
		try {
			result = fn.apply(this, args);
		} catch (error) {
			finish('error', undefined, error);
			throw error;
		}
		if (result && typeof result.then === 'function') {
			return result.then(
				(value) => {
					finish('ok', value);
					return value;
				},
				(error) => {
					finish('error', undefined, error);
					throw error;
				}
			);
		}
		finish('ok', result);
		return result;
	};
}

/** Rewrites (validate_or_fn, maybe_fn) so the handler — wherever it sits — is traced. */
function wrap_args(get_remote, a, b) {
	return typeof b === 'function' ? [a, trace(get_remote, b)] : [trace(get_remote, a), b];
}

function tag(remote, validator) {
	Object.defineProperty(remote, validator_key, { value: validator });
	return remote;
}

function make(factory, a, b, ...rest) {
	let remote;
	const [ta, tb] = wrap_args(() => remote, a, b);
	remote = tb === undefined ? factory(ta, ...rest) : factory(ta, tb, ...rest);
	return tag(remote, validator_of(a, b));
}

export function query(a, b) {
	return make(kit.query, a, b);
}
Object.defineProperty(query, 'batch', { value: (a, b) => make(kit.query.batch, a, b), enumerable: true });
Object.defineProperty(query, 'live', { value: (a, b) => make(kit.query.live, a, b), enumerable: true });

export function command(a, b) {
	return make(kit.command, a, b);
}

export function form(a, b) {
	return make(kit.form, a, b);
}

export function prerender(a, b, c) {
	// prerender(fn, options) | prerender(schema, fn, options)
	return typeof b === 'function' ? make(kit.prerender, a, b, c) : make(kit.prerender, a, undefined, b);
}
`;
