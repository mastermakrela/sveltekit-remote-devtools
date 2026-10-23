// Pure view-model helpers for the Timeline and Live tabs: grouping, refresh trees, last-known values
// and compact value previews. No components here — they derive from these.
import { decode_payload, decode_server_value, split_key, store } from '../store.svelte.ts';
import type { CallKind, ClientCall, LiveQuery, ServerCall } from '../store.svelte.ts';

export const KIND_LABEL: Record<CallKind, string> = {
	query: 'query',
	query_batch: 'query.batch',
	query_live: 'query.live',
	command: 'command',
	form: 'form',
	prerender: 'prerender',
	unknown: '?'
};

export function is_write(kind: CallKind | null) {
	return kind === 'command' || kind === 'form';
}

export function fmt_ms(ms: number | undefined | null) {
	if (ms == null) return '';
	if (ms < 1) return `${ms.toFixed(2)} ms`;
	if (ms < 100) return `${ms.toFixed(1)} ms`;
	return `${Math.round(ms)} ms`;
}

export function fmt_time(at: number) {
	const d = new Date(at);
	const pad = (n: number, w = 2) => String(n).padStart(w, '0');
	return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** Manifest file path relative to `src/`, for compact display */
export function short_file(file: string | undefined | null) {
	if (!file) return '';
	return file.replace(/^.*?src\/(routes\/)?/, '');
}

/** Name of a remote function id (`hash/name`), from the manifest when available */
export function name_of(id: string) {
	return store.function_of(id)?.name ?? id.slice(id.indexOf('/') + 1);
}

/** Comparison key for decoded arguments. Dates become ISO strings, Maps/Sets their entries. */
export function stable(value: unknown): string {
	return (
		JSON.stringify(value, (_key, v: unknown) => {
			if (v instanceof Map) return { __map: [...v] };
			if (v instanceof Set) return { __set: [...v] };
			if (v === undefined) return '__undefined';
			return v;
		}) ?? 'undefined'
	);
}

// ---------------------------------------------------------------------------------------------------
// Value previews

/** Shapes the server shim (and decode_server_value) produce for values devalue can't represent */
export type Special =
	| { tag: 'class'; name: string; rest: Record<string, unknown> }
	| { tag: 'function'; name: string }
	| { tag: 'iterable'; name: string }
	| { tag: 'promise' }
	| { tag: 'unserializable'; message: string }
	| { tag: 'undecodable'; message: string; raw: string }
	| { tag: 'truncated'; preview: string }
	| { tag: 'file'; name: string; size: number; type: string };

function plain(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

export function special(value: unknown): Special | null {
	if (typeof File !== 'undefined' && value instanceof File) return { tag: 'file', name: value.name, size: value.size, type: value.type };
	if (!plain(value)) return null;
	const keys = Object.keys(value);
	const only = (key: string) => keys.length === 1 && keys[0] === key;
	if (typeof value.class === 'string') {
		const { class: name, ...rest } = value;
		return { tag: 'class', name, rest };
	}
	if (only('function') && typeof value.function === 'string') return { tag: 'function', name: value.function };
	if (only('iterable') && typeof value.iterable === 'string') return { tag: 'iterable', name: value.iterable };
	if (only('promise') && value.promise === true) return { tag: 'promise' };
	if (only('unserializable')) return { tag: 'unserializable', message: String(value.unserializable) };
	if (keys.length === 2 && 'undecodable' in value && 'raw' in value) {
		return { tag: 'undecodable', message: String(value.undecodable), raw: String(value.raw) };
	}
	if (keys.length === 2 && value.truncated === true && typeof value.preview === 'string') return { tag: 'truncated', preview: value.preview };
	return null;
}

export function describe_special(s: Special): string {
	switch (s.tag) {
		case 'class':
			return `${s.name} {…}`;
		case 'function':
			return `ƒ ${s.name}()`;
		case 'iterable':
			return `${s.name} (iterable)`;
		case 'promise':
			return 'Promise';
		case 'unserializable':
			return `⚠ unserializable: ${s.message}`;
		case 'undecodable':
			return `⚠ undecodable: ${s.message}`;
		case 'truncated':
			return '⚠ truncated (> 64 KB)';
		case 'file':
			return `File ${JSON.stringify(s.name)} ${fmt_bytes(s.size)}${s.type ? ` ${s.type}` : ''}`;
	}
}

export function fmt_bytes(n: number) {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** One-line preview of any decoded value, at most roughly `max` characters */
export function preview(value: unknown, max = 60): string {
	const out = preview_inner(value, max, 0);
	return out.length > max ? out.slice(0, max - 1) + '…' : out;
}

function preview_inner(value: unknown, max: number, depth: number): string {
	if (value === undefined) return 'undefined';
	if (value === null) return 'null';
	if (typeof value === 'string') return JSON.stringify(value.length > max ? value.slice(0, max) + '…' : value);
	if (typeof value === 'bigint') return `${value}n`;
	if (typeof value !== 'object') return String(value);
	const s = special(value);
	if (s) return describe_special(s);
	if (value instanceof Date) return isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
	if (value instanceof RegExp) return String(value);
	if (value instanceof URL) return `URL ${value.href}`;
	if (value instanceof Error) return `${value.name}: ${value.message}`;
	if (value instanceof Map) return `Map(${value.size})`;
	if (value instanceof Set) return `Set(${value.size})`;
	if (depth > 1) return Array.isArray(value) ? `[…${value.length}]` : '{…}';
	if (Array.isArray(value)) {
		const items = value.slice(0, 5).map((v) => preview_inner(v, max, depth + 1));
		return `[${items.join(', ')}${value.length > 5 ? `, …${value.length - 5}` : ''}]`;
	}
	const entries = Object.entries(value);
	const body = entries
		.slice(0, 5)
		.map(([k, v]) => `${k}: ${preview_inner(v, max, depth + 1)}`)
		.join(', ');
	const name = plain(value) ? '' : `${value.constructor?.name ?? 'Object'} `;
	return `${name}{${body}${entries.length > 5 ? ', …' : ''}}`;
}

// ---------------------------------------------------------------------------------------------------
// Timeline

export interface SsrGroup {
	type: 'ssr';
	key: string;
	requestId: number | null;
	pathname: string;
	at: number;
	calls: ServerCall[];
	totalMs: number;
	/** the render that produced the page the devtool is running in */
	current: boolean;
	/** rendered after the devtool connected (another tab, or a render not followed by a reload) */
	later: boolean;
}

export type TimelineEntry = SsrGroup | { type: 'client'; key: string; at: number; call: ClientCall };

export function ssr_groups(server: ServerCall[]): SsrGroup[] {
	const by_request = new Map<string, ServerCall[]>();
	for (const call of server) {
		if (call.origin !== 'ssr') continue;
		const key = `ssr-${call.requestId ?? `seq${call.serverSeq}`}`;
		let list = by_request.get(key);
		if (!list) by_request.set(key, (list = []));
		list.push(call);
	}
	const groups: SsrGroup[] = [...by_request].map(([key, calls]) => ({
		type: 'ssr',
		key,
		requestId: calls[0].requestId,
		pathname: calls[0].pathname ?? '?',
		// events are emitted when a handler settles: its start is the earliest point of the render we know
		at: Math.min(...calls.map((c) => c.at - c.durationMs)),
		calls,
		totalMs: calls.reduce((sum, c) => sum + c.durationMs, 0),
		current: false,
		later: false
	}));
	groups.sort((a, b) => a.at - b.at);
	const connected = store.connected_at || Infinity;
	let current: SsrGroup | undefined;
	for (const g of groups) {
		if (g.at > connected) g.later = true;
		else if (g.pathname === store.connected_path) current = g;
	}
	if (current) current.current = true;
	return groups;
}

// ---------------------------------------------------------------------------------------------------
// Refresh tree

/**
 * - refreshed / error: the response carries a new value (or error) for the key (`data.q` / `data.l`)
 * - ignored: the server listed the key in `data.i`
 * - unhandled: the client asked for it via `.updates()`, the server neither refreshed nor ignored it —
 *   Kit's client then fails that query instance (400 "Requested update was not handled…")
 * - skipped: requested, but the call itself failed, so Kit processed no refreshes
 * - registered: known from the server trace, but no value in the response (yet)
 */
export type RefreshState = 'refreshed' | 'error' | 'ignored' | 'unhandled' | 'skipped' | 'registered';

export interface RefreshNode {
	key: string;
	id: string;
	name: string;
	arg: unknown;
	argError?: string;
	/** asked for by the client via `.updates(...)` */
	requested: boolean;
	/** registered on the server via `refresh()` / `set()` / `refreshAll()` */
	server: boolean;
	live: boolean;
	state: RefreshState;
	value?: unknown;
	error?: unknown;
}

export function refresh_tree(call: ClientCall): RefreshNode[] {
	const data = call.response?.data;
	const q = data?.q ?? {};
	const l = data?.l ?? {};
	const ignored = new Set(data?.i ?? []);
	const requested = new Set(call.requested);
	const registered = new Set(call.server?.refreshed ?? []);
	const done = call.status !== 'pending' && call.response?.type === 'result';
	const keys = [...new Set([...call.requested, ...registered, ...Object.keys(q), ...Object.keys(l), ...ignored])];
	return keys.map((key): RefreshNode => {
		const { id, payload } = split_key(key);
		let arg: unknown;
		let argError: string | undefined;
		try {
			arg = decode_payload(payload);
		} catch (error) {
			argError = String(error);
		}
		const entry = q[key] ?? l[key];
		let state: RefreshState;
		if (entry) state = entry.e !== undefined ? 'error' : 'refreshed';
		else if (ignored.has(key)) state = 'ignored';
		else if (requested.has(key) && done) state = 'unhandled';
		else if (!registered.has(key) && call.status !== 'pending') state = 'skipped';
		else state = 'registered';
		return {
			key,
			id,
			name: name_of(id),
			arg,
			argError,
			requested: requested.has(key),
			server: registered.has(key),
			live: key in l,
			state,
			value: entry?.v,
			error: entry?.e
		};
	});
}

export function server_args(call: ServerCall) {
	return decode_server_value(call.args.text);
}

export function server_result(call: ServerCall) {
	return call.result ? decode_server_value(call.result.text) : undefined;
}

// ---------------------------------------------------------------------------------------------------
// Live: last known value of a cached query instance

export interface Known {
	at: number;
	source: string;
	value?: unknown;
	error?: unknown;
}

function batch_item(item: unknown): { value?: unknown; error?: unknown } | null {
	if (!plain(item)) return null;
	if (item.type === 'result') return { value: item.data };
	if (item.type === 'error') return { error: item.error };
	return null;
}

/** Most recent value seen for `id/payload`: client responses (own result or refresh) or SSR events */
export function last_known(id: string, payload: string, arg: unknown): Known | null {
	const key = `${id}/${payload}`;
	const want = stable(arg);
	const candidates: Known[] = [];

	for (const call of store.client) {
		const data = call.response?.data;
		if (!data) continue;
		const at = call.at + (call.durationMs ?? 0);
		const entry = data.q?.[key] ?? data.l?.[key];
		if (entry) {
			// Kit also echoes a query's own result into `q` (cache seeding): that is the call itself, not a refresh
			const source = call.id === id ? `call #${call.seq}` : `refreshed by ${call.name}() #${call.seq}`;
			candidates.push({ at, source, value: entry.v, error: entry.e });
			continue;
		}
		if (call.id !== id || call.response?.type !== 'result') continue;
		if (call.kind === 'query_batch' && Array.isArray(call.arg) && Array.isArray(data._)) {
			const index = call.arg.findIndex((a) => stable(a) === want);
			const item = index >= 0 ? batch_item(data._[index]) : null;
			if (item) candidates.push({ at, source: `batched call #${call.seq}`, ...item });
		} else if (stable(call.arg) === want) {
			candidates.push({ at, source: `call #${call.seq}`, value: data._ });
		}
	}

	// the client never sees the values a live query streams over HTTP, so those come from the server too
	for (const call of store.server) {
		if ((call.origin !== 'ssr' && !call.stream) || call.id !== id || call.outcome !== 'ok' || !call.result) continue;
		const source = call.origin === 'ssr' ? `SSR ${call.pathname ?? ''}` : `streamed value ${call.updates}`;
		if (call.kind === 'query_batch') {
			const args = server_args(call);
			const index = Array.isArray(args) ? args.findIndex((a) => stable(a) === want) : -1;
			if (index === -1) continue;
			const error = call.batchErrors?.[index];
			candidates.push({ at: call.at, source, ...(error ? { error } : { value: (server_result(call) as unknown[])[index] }) });
		} else if (stable(server_args(call)) === want) {
			candidates.push({ at: call.at, source, value: server_result(call) });
		}
	}

	return candidates.reduce<Known | null>((best, k) => (!best || k.at >= best.at ? k : best), null);
}

/** Timeline entry keys that follow a page change, mapped to the new pathname ("navigated to /x") */
export function navigations(entries: TimelineEntry[]): Record<string, string> {
	const out: Record<string, string> = {};
	let last: string | null = null;
	for (const entry of entries) {
		const path = entry.type === 'ssr' ? entry.pathname : entry.call.pathname;
		if (entry.type === 'client' && last !== null && path !== last) out[entry.key] = path;
		last = path;
	}
	return out;
}

/** Live query instances grouped by function id, in cache order */
export function group_live(live: LiveQuery[]): Array<{ id: string; queries: LiveQuery[] }> {
	const groups: Array<{ id: string; queries: LiveQuery[] }> = [];
	for (const q of live) {
		const group = groups.find((g) => g.id === q.id);
		if (group) group.queries.push(q);
		else groups.push({ id: q.id, queries: [q] });
	}
	return groups;
}

/** Preview of a call argument: empty for argument-less calls, so they read as `fn()` */
export function arg_preview(value: unknown, max = 50) {
	return value === undefined ? '' : preview(value, max);
}
