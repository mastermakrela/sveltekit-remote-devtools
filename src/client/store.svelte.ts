// Reactive event store for the devtool: client-side calls (from the fetch tap), server-side calls
// (from the shim, over the Vite HMR channel), and the manifest. Decoding of payloads lives here.
import * as devalue from 'devalue';
import { app, live_query_map, query_map } from 'virtual:sveltekit-remote-devtools/kit-client';
import { base, app_dir, events_path, manifest_path, ws_manifest_event, ws_server_event } from 'virtual:sveltekit-remote-devtools/config';
import type { RemoteManifest } from '../node/manifest.ts';

const prefix = `${base}/${app_dir}/remote/`;

/** The app's transport decoders; read per call because Kit sets `app` in `start()` */
export function app_decoders(): Record<string, (value: unknown) => unknown> {
	return app?.decoders ?? {};
}

/** Per-list cap (oldest dropped), same size as the dev server's event buffer: a long session must not grow without bound */
const MAX_ENTRIES = 1000;

// Same revivers Kit uses for remote arguments (see runtime/shared.js). Stable across Kit 2.27+ and 3.
function arg_revivers(): Record<string, (value: unknown) => unknown> {
	const parse = (data: string) => devalue.parse(data, revivers);
	const revivers: Record<string, (value: unknown) => unknown> = {
		...app_decoders(),
		__skrao: (v) => v,
		__skram: (v) => new Map((v as Array<[string, string]>).map(([k, val]) => [parse(k), parse(val)])),
		__skras: (v) => new Set((v as string[]).map(parse)),
		__skraf: (v) => v
	};
	return revivers;
}

export function decode_payload(payload: string | null | undefined): unknown {
	if (!payload) return undefined;
	const json = new TextDecoder().decode(
		Uint8Array.from(atob(payload.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0))
	);
	return devalue.parse(json, arg_revivers());
}

/** Decodes the `data` string of a remote function response envelope */
export function decode_response_data(data: string): RemoteFunctionData {
	return devalue.parse(data, {
		...app_decoders()
	}) as RemoteFunctionData;
}

/** Parses a devalue string produced by the server shim's safe_stringify */
export function decode_server_value(text: string): unknown {
	try {
		return devalue.parse(text, {
			...app_decoders(),
			File: (v) => v,
			Unknown: (v) => v
		});
	} catch (error) {
		return { undecodable: String(error), raw: text };
	}
}

export interface RemoteFunctionData {
	/** the function's own result */
	_?: unknown;
	/** refreshed queries, keyed by `id/payload` */
	q?: Record<string, { v?: unknown; e?: unknown }>;
	/** reconnected live queries */
	l?: Record<string, { v?: unknown; e?: unknown }>;
	/** prerender data */
	p?: Record<string, { v?: unknown; e?: unknown }>;
	/** refresh keys the server ignored */
	i?: string[];
	/** true when explicit single-flight refreshes happened */
	r?: boolean;
	redirect?: string;
}

export type CallKind = 'query' | 'query_batch' | 'query_live' | 'command' | 'form' | 'prerender' | 'unknown';

export interface ClientCall {
	seq: number;
	id: string;
	hash: string;
	name: string;
	kind: CallKind;
	method: string;
	url: string;
	pathname: string;
	at: number;
	status: 'pending' | 'done' | 'failed';
	httpStatus?: number;
	durationMs?: number;
	/** decoded argument(s) */
	arg: unknown;
	argError?: string;
	/** keys the client asked to refresh (`.updates(...)`) */
	requested: string[];
	/** form entries, when the body was FormData */
	form: Array<[string, string]> | null;
	/** decoded response envelope */
	response?: { type: string; data?: RemoteFunctionData; error?: unknown; raw?: string };
	responseError?: string;
	error?: string;
	stream?: string;
	/** server-side trace of this same request, matched by correlation id */
	server?: ServerCall;
	/** other server calls made during the same request (queries re-run for refreshes) */
	children?: ServerCall[];
}

export interface ServerCall {
	type: 'server-call';
	id: string | null;
	name: string | null;
	kind: CallKind | null;
	origin: 'http' | 'ssr';
	requestUrl: string | null;
	pathname: string | null;
	correlation: string | null;
	/** groups every call made while serving one HTTP request (a page render, or a remote call) */
	requestId: number | null;
	method: string | null;
	args: { text: string; truncated: boolean };
	result: { text: string; truncated: boolean } | null;
	error: { message: string; status: number | null } | null;
	outcome: 'ok' | 'error';
	durationMs: number;
	at: number;
	/** keys refreshed on the server (`refresh()`, `set()`, `refreshAll()`) */
	refreshed: string[];
	/** keys the client asked to refresh */
	requested: string[];
	/** local sequence, assigned on arrival */
	seq: number;
	/** sequence assigned by the dev server (monotonic across pages) */
	serverSeq: number;
	/** `query.live`: one id per iterator; each yielded value replaces the previous event of the stream */
	stream?: string;
	/** `query.live`: how many values the stream has yielded so far */
	updates?: number;
	/** `query.batch`: errors thrown by the resolver, by argument index */
	batchErrors?: Record<number, string>;
}

export interface LiveQuery {
	id: string;
	payload: string;
	arg: unknown;
	live: boolean;
	proxies: number;
}

function parse_url(url: string): { id: string; hash: string; name: string; payload: string | null; extra: string | null } {
	const u = new URL(url, location.origin);
	const rest = u.pathname.slice(u.pathname.indexOf(prefix) + prefix.length);
	const [hash, name, extra] = rest.split('/');
	return { id: `${hash}/${name}`, hash, name, payload: u.searchParams.get('payload'), extra: extra ?? null };
}

export function split_key(key: string): { id: string; payload: string } {
	const i = key.lastIndexOf('/');
	return { id: key.slice(0, i), payload: key.slice(i + 1) };
}

class DevtoolsStore {
	client = $state<ClientCall[]>([]);
	server = $state<ServerCall[]>([]);
	manifest = $state<RemoteManifest | null>(null);
	manifestError = $state<string | null>(null);
	live = $state<LiveQuery[]>([]);
	open = $state(false);
	/** wall-clock time and page the devtool connected at: identifies which SSR render produced this page */
	connected_at = 0;
	connected_path = '';
	/** timeline "clear": entries at or below these sequence numbers are hidden (data is kept for the Live tab) */
	cleared = $state({ client: 0, server: 0 });
	#server_seq = 0;

	kind_of(id: string): CallKind {
		return this.manifest?.functions.find((f) => f.id === id)?.kind ?? 'unknown';
	}

	function_of(id: string) {
		return this.manifest?.functions.find((f) => f.id === id) ?? null;
	}

	/** Called by the tap on request and response */
	ingest(record: TapRecord, phase: 'request' | 'response') {
		let call = this.client.find((c) => c.seq === record.seq);
		if (!call) {
			const { id, hash, name, payload, extra } = parse_url(record.url);
			call = {
				seq: record.seq,
				id,
				hash,
				name,
				kind: this.kind_of(id),
				method: record.method,
				url: record.url,
				pathname: record.pathname,
				at: record.at,
				status: record.status,
				arg: undefined,
				requested: [],
				form: record.form
			};
			try {
				if (record.body && record.method === 'POST' && !record.form) {
					const body = JSON.parse(record.body) as { payload?: string; payloads?: string[]; refreshes?: string[] };
					call.arg = body.payloads ? body.payloads.map(decode_payload) : decode_payload(body.payload);
					call.requested = body.refreshes ?? [];
					if (body.payloads) call.kind = 'query_batch';
				} else if (extra) {
					call.arg = decode_payload(extra);
				} else {
					call.arg = decode_payload(payload);
				}
			} catch (error) {
				call.argError = String(error);
			}
			this.client.push(call);
			if (this.client.length > MAX_ENTRIES) this.client.shift();
		}
		if (phase === 'response') {
			call.status = record.status;
			call.httpStatus = record.httpStatus;
			call.durationMs = record.durationMs;
			call.error = record.error;
			if (record.responseText) {
				try {
					const envelope = JSON.parse(record.responseText) as { type: string; data?: string; error?: unknown };
					call.response = {
						type: envelope.type,
						data: envelope.data ? decode_response_data(envelope.data) : undefined,
						error: envelope.error,
						raw: record.responseText
					};
				} catch (error) {
					call.responseError = String(error);
				}
			} else if (record.contentType?.includes('text/event-stream')) {
				call.stream = record.contentType;
			}
			this.refresh_live();
		}
	}

	ingest_server(event: Omit<ServerCall, 'seq'>) {
		if (this.server.some((s) => s.serverSeq === event.serverSeq)) return;
		const previous = event.stream ? this.server.findIndex((s) => s.stream === event.stream) : -1;
		const call: ServerCall = { ...event, seq: previous === -1 ? ++this.#server_seq : this.server[previous].seq };
		if (previous !== -1) this.server.splice(previous, 1);
		this.server.push(call);
		this.server.sort((a, b) => a.serverSeq - b.serverSeq);
		if (this.server.length > MAX_ENTRIES) this.server.shift();
		if (call.correlation) {
			// Every server call made during one HTTP request shares the correlation id: the function itself
			// plus the queries re-run for single-flight refreshes. Only the former is the client call's twin.
			// The correlation id is a per-tab counter, so an event buffered from an earlier page load (or
			// another tab) can carry the same number: only match events that finished after the request began.
			const seq = Number(call.correlation);
			const client = this.client.find((c) => c.seq === seq && call.at >= c.at - 1000);
			if (client && call.id === client.id) client.server = call;
			// reassign rather than `(children ??= []).push()`: `??=` yields the raw array, not the $state proxy
			else if (client) client.children = [...(client.children ?? []), call];
		}
		this.refresh_live();
	}

	/** Snapshot of Kit's client query cache. Reads only keys and counts: touching `.current` would start fetches. */
	refresh_live() {
		const next: LiveQuery[] = [];
		const collect = (map: Map<string, Map<string, { proxy_count?: number }>>, live: boolean) => {
			for (const [id, entries] of map) {
				for (const [payload, entry] of entries) {
					let arg: unknown;
					try {
						arg = decode_payload(payload);
					} catch (error) {
						arg = { undecodable: String(error) };
					}
					next.push({ id, payload, arg, live, proxies: entry.proxy_count ?? 0 });
				}
			}
		};
		collect(query_map as never, false);
		collect(live_query_map as never, true);
		// Every consumer (Live tab: last-known values) re-derives on assignment, and this runs every 2s: skip no-ops
		const same = (a: LiveQuery, b: LiveQuery) => a.id === b.id && a.payload === b.payload && a.live === b.live && a.proxies === b.proxies;
		if (next.length !== this.live.length || next.some((q, i) => !same(q, this.live[i]))) this.live = next;
	}

	/** SSR calls of this page's render happened before the HMR client connected: fetch them from the buffer */
	async load_server_events() {
		try {
			const response = await fetch(events_path);
			const events = (await response.json()) as Array<Omit<ServerCall, 'seq'>>;
			// keep everything from the last minute before this page started loading, plus all later events
			const cutoff = performance.timeOrigin - 60_000;
			for (const event of events) if (event.at >= cutoff) this.ingest_server(event);
		} catch (error) {
			console.warn('[sveltekit-remote-devtools] could not load server events', error);
		}
	}

	async load_manifest() {
		try {
			const response = await fetch(manifest_path);
			const json = (await response.json()) as RemoteManifest | { error: string };
			if ('error' in json) {
				this.manifestError = json.error;
			} else {
				this.manifest = json;
				this.manifestError = null;
				for (const call of this.client) if (call.kind === 'unknown') call.kind = this.kind_of(call.id);
			}
		} catch (error) {
			this.manifestError = String(error);
		}
	}

	/** Hides everything currently in the timeline; the Live tab keeps using it for last-known values. */
	clear_timeline() {
		this.cleared = {
			client: this.client.at(-1)?.seq ?? 0,
			server: this.server.reduce((max, s) => Math.max(max, s.serverSeq), 0)
		};
	}

	connect() {
		this.connected_at = performance.timeOrigin + performance.now();
		this.connected_path = location.pathname;
		const tap = (globalThis as { __SK_REMOTE_DEVTOOLS__?: TapStore }).__SK_REMOTE_DEVTOOLS__;
		if (tap) {
			for (const record of tap.records) {
				this.ingest(record, 'request');
				if (record.status !== 'pending') this.ingest(record, 'response');
			}
			tap.listeners.add((record, phase) => this.ingest(record, phase));
		}
		const hot = import.meta.hot;
		if (hot) {
			hot.on(ws_server_event, (event: Omit<ServerCall, 'seq'>) => this.ingest_server(event));
			hot.on(ws_manifest_event, () => void this.load_manifest());
		}
		void this.load_manifest();
		void this.load_server_events();
		this.refresh_live();
		setInterval(() => this.refresh_live(), 2000);
	}
}

export interface TapRecord {
	seq: number;
	url: string;
	method: string;
	body: string | null;
	form: Array<[string, string]> | null;
	pathname: string;
	started: number;
	at: number;
	status: 'pending' | 'done' | 'failed';
	httpStatus?: number;
	durationMs?: number;
	contentType?: string | null;
	responseText?: string;
	error?: string;
}

interface TapStore {
	records: TapRecord[];
	listeners: Set<(record: TapRecord, phase: 'request' | 'response') => void>;
	seq: number;
	installed: boolean;
}

export const store = new DevtoolsStore();
(globalThis as { __SK_REMOTE_DEVTOOLS_STORE__?: DevtoolsStore }).__SK_REMOTE_DEVTOOLS_STORE__ = store;
