// Playground plumbing: argument samples, encoding through Kit's own serializers, and the HTTP calls
// for each remote function kind. Requests go through the page's global `fetch`, so the tap records
// playground calls in the Timeline like any other call.
import * as devalue from 'devalue';
import { app } from 'virtual:sveltekit-remote-devtools/kit-client';
import { stringify_command_arg, stringify_remote_arg } from 'virtual:sveltekit-remote-devtools/kit-shared';
import { base, app_dir, kit_version } from 'virtual:sveltekit-remote-devtools/config';
import type { RemoteFunctionEntry, TypeNode } from '../node/manifest.ts';
import { app_decoders, decode_response_data, decode_server_value, type RemoteFunctionData } from './store.svelte.ts';

// ---------------------------------------------------------------------------------------------------
// Samples

interface JsonSchema {
	type?: string | string[];
	const?: unknown;
	default?: unknown;
	enum?: unknown[];
	anyOf?: JsonSchema[];
	oneOf?: JsonSchema[];
	allOf?: JsonSchema[];
	properties?: Record<string, JsonSchema>;
	required?: string[];
	items?: JsonSchema | JsonSchema[];
	prefixItems?: JsonSchema[];
	minItems?: number;
	minimum?: number;
	maximum?: number;
	exclusiveMinimum?: number;
	minLength?: number;
	maxLength?: number;
	pattern?: string;
	format?: string;
	nullable?: boolean;
}

const SAFE_BOUND = 1e9;

/** A plausible value for a JSON Schema: const → default → enum[0] → by type. */
export function sample_from_schema(schema: JsonSchema, depth = 0): unknown {
	if (depth > 8) return null;
	if ('const' in schema) return schema.const;
	if ('default' in schema) return schema.default;
	if (schema.enum?.length) return schema.enum[0];
	const alternatives = schema.anyOf ?? schema.oneOf;
	if (alternatives?.length) {
		const first = alternatives.find((s) => s.type !== 'null') ?? alternatives[0];
		return sample_from_schema(first, depth + 1);
	}
	if (schema.allOf?.length) {
		return Object.assign({}, ...schema.allOf.map((s) => sample_from_schema(s, depth + 1)));
	}
	const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
	const type = types.find((t) => t !== 'null') ?? types[0] ?? (schema.properties ? 'object' : undefined);
	switch (type) {
		case 'object': {
			const out: Record<string, unknown> = {};
			for (const [key, sub] of Object.entries(schema.properties ?? {})) out[key] = sample_from_schema(sub, depth + 1);
			return out;
		}
		case 'array': {
			if (schema.prefixItems) return schema.prefixItems.map((s) => sample_from_schema(s, depth + 1));
			if (Array.isArray(schema.items)) return schema.items.map((s) => sample_from_schema(s, depth + 1));
			const count = Math.min(Math.max(schema.minItems ?? 1, 1), 3);
			return schema.items ? Array.from({ length: count }, () => sample_from_schema(schema.items as JsonSchema, depth + 1)) : [];
		}
		case 'string':
			return sample_string(schema);
		case 'number':
		case 'integer': {
			const min = schema.minimum ?? schema.exclusiveMinimum;
			// zod emits ±MAX_SAFE_INTEGER bounds for `.int()`; ignore bounds that are not meaningful
			if (min === undefined || Math.abs(min) > SAFE_BOUND) return type === 'integer' ? 1 : 1.5;
			return schema.exclusiveMinimum !== undefined ? min + 1 : min;
		}
		case 'boolean':
			return false;
		case 'null':
			return null;
		default:
			return null;
	}
}

function sample_string(schema: JsonSchema): string {
	switch (schema.format) {
		case 'uuid':
			return '00000000-0000-4000-8000-000000000000';
		case 'email':
			return 'user@example.com';
		case 'date-time':
			return new Date(0).toISOString();
		case 'date':
			return '2026-01-01';
		case 'uri':
		case 'url':
			return 'https://example.com';
	}
	return 'x'.repeat(Math.min(Math.max(schema.minLength ?? 0, 0), 32));
}

/** Fallback sample from the TypeScript structural type tree */
export function sample_from_type(node: TypeNode, depth = 0): unknown {
	if (depth > 8) return null;
	switch (node.kind) {
		case 'primitive':
			switch (node.name) {
				case 'string':
					return '';
				case 'number':
					return 0;
				case 'boolean':
					return false;
				case 'bigint':
					return 0;
				default:
					return null;
			}
		case 'literal':
			return node.value;
		case 'union': {
			const first = node.types.find((t) => !(t.kind === 'primitive' && (t.name === 'undefined' || t.name === 'null')));
			return first ? sample_from_type(first, depth + 1) : null;
		}
		case 'intersection':
			return Object.assign({}, ...node.types.map((t) => sample_from_type(t, depth + 1)));
		case 'array':
			return [sample_from_type(node.element, depth + 1)];
		case 'tuple':
			return node.elements.map((t) => sample_from_type(t, depth + 1));
		case 'object': {
			const out: Record<string, unknown> = {};
			for (const p of node.properties) if (!p.optional) out[p.name] = sample_from_type(p.type, depth + 1);
			return out;
		}
		case 'builtin':
			return node.name === 'Date' ? new Date(0).toISOString() : null;
		case 'opaque':
			return null;
	}
}

/** Whether the function takes an argument at all */
export function takes_argument(fn: RemoteFunctionEntry): boolean {
	if (fn.validation.mode !== 'none') return true;
	const text = fn.types.input?.text;
	return text !== undefined && text !== 'void' && text !== 'undefined';
}

/** Initial editor text for a function */
export function initial_source(fn: RemoteFunctionEntry): string {
	if (!takes_argument(fn)) return '';
	let sample: unknown = undefined;
	if (fn.validation.mode === 'standard-schema' && fn.validation.jsonSchema) {
		sample = sample_from_schema(fn.validation.jsonSchema as JsonSchema);
	} else if (fn.types.input) {
		sample = sample_from_type(fn.types.input.tree);
	}
	if (sample === undefined) return '';
	// query.batch takes one argument per call; the playground sends several at once
	if (fn.kind === 'query_batch') sample = [sample];
	return JSON.stringify(sample, null, 2);
}

// ---------------------------------------------------------------------------------------------------
// Forms

export interface FormField {
	/** property name, as Kit reports it in `issue.name` */
	name: string;
	/** the input's `name` attribute in Kit's format (`parse_form_key`): `<n:|b:>name`, plus `/<form id>` since Kit 3 */
	key: string;
	type: 'text' | 'email' | 'number' | 'checkbox' | 'select' | 'file';
	options: string[];
	initial: string | boolean;
	/** native constraints from the JSON Schema; only enforced when browser checks are on */
	constraints: Record<string, string | number | boolean | undefined>;
	/** set when the value can't be built with one input (arrays, nested objects) */
	note?: string;
}

function kit_at_least(major: number, minor: number) {
	const [M, m] = kit_version.split('.').map(Number);
	return M > major || (M === major && m >= minor);
}

/** `anyOf: [X, null]` → X, `anyOf` of `const`s → `enum` */
function plain(prop: JsonSchema): JsonSchema {
	const alternatives = (prop.anyOf ?? prop.oneOf)?.filter((a) => a.type !== 'null' && a.type !== 'undefined');
	if (!alternatives) return prop;
	if (alternatives.every((a) => 'const' in a)) return { ...prop, enum: alternatives.map((a) => a.const) };
	return alternatives.length === 1 ? { default: prop.default, ...alternatives[0] } : prop;
}

/** The input type in JSON Schema terms, for forms without a schema the manifest could convert */
function schema_of(node: TypeNode): JsonSchema {
	switch (node.kind) {
		case 'primitive':
			return { type: node.name };
		case 'literal':
			return { const: node.value };
		case 'union':
			return { anyOf: node.types.map(schema_of) };
		case 'object':
			return {
				type: 'object',
				properties: Object.fromEntries(node.properties.map((p) => [p.name, schema_of(p.type)])),
				required: node.properties.filter((p) => !p.optional).map((p) => p.name)
			};
		case 'array':
		case 'tuple':
			return { type: 'array' };
		case 'builtin':
			return node.name === 'File' ? { type: 'string', format: 'binary' } : {};
		default:
			return {};
	}
}

const UNSUPPORTED = 'Arrays and nested objects need one input per element; this sends the text as a single value.';

/** One input per top-level property of the form's schema (or, without one, of its input type) */
export function form_fields(fn: RemoteFunctionEntry): FormField[] {
	// Kit coerces `n:`/`b:` names since 2.48 and scopes names to the form since 3.0
	const prefixes = kit_at_least(2, 48);
	const suffix = kit_at_least(3, 0) ? `/${fn.id}` : '';
	const field = (name: string, type: FormField['type'], rest: Partial<FormField> = {}, numeric = type === 'number'): FormField => {
		const prefix = !prefixes ? '' : numeric ? 'n:' : type === 'checkbox' ? 'b:' : '';
		return { name, key: `${prefix}${name}${suffix}`, type, options: [], initial: type === 'checkbox' ? false : '', constraints: {}, ...rest };
	};

	const declared = fn.validation.mode === 'standard-schema' ? (fn.validation.jsonSchema as JsonSchema | null) : null;
	const tree = fn.types.input?.tree;
	const schema = declared?.properties ? declared : tree?.kind === 'object' ? schema_of(tree) : null;
	return Object.entries(schema?.properties ?? {}).map(([name, raw]) => {
		const prop = plain(raw);
		const types = Array.isArray(prop.type) ? prop.type : [prop.type];
		const required = schema?.required?.includes(name);
		const initial = String(prop.default ?? '');
		if (prop.enum) {
			const numeric = prop.enum.every((v) => typeof v === 'number');
			return field(name, 'select', { options: prop.enum.map(String), initial, constraints: { required } }, numeric);
		}
		if (types.includes('boolean')) return field(name, 'checkbox', { initial: prop.default === true });
		if (types.includes('number') || types.includes('integer')) {
			const step = types.includes('integer') ? 1 : 'any';
			return field(name, 'number', { initial, constraints: { required, min: prop.minimum, max: prop.maximum, step } });
		}
		if (prop.format === 'binary') return field(name, 'file', { constraints: { required } });
		if (types.includes('array') || types.includes('object')) return field(name, 'text', { note: UNSUPPORTED });
		// no `pattern`: JSON Schema patterns match anywhere, HTML ones must match the whole value
		return field(name, prop.format === 'email' ? 'email' : 'text', {
			initial,
			constraints: { required, minlength: prop.minLength, maxlength: prop.maxLength }
		});
	});
}

export interface FormIssue {
	/** dotted field path, `''` for issues about the whole form */
	name: string;
	message: string;
}

/** Validation issues of a form submission (`{ _: { issues } }`), empty when it went through */
export function form_issues(result: PlaygroundResult | null): FormIssue[] {
	const output = result?.data?._ as { issues?: FormIssue[] } | undefined;
	return Array.isArray(output?.issues) ? output.issues : [];
}

// ---------------------------------------------------------------------------------------------------
// Argument parsing and encoding

export type ArgMode = 'json' | 'js';

export function parse_source(source: string, mode: ArgMode): unknown {
	if (source.trim() === '') return undefined;
	if (mode === 'json') return JSON.parse(source);
	// Explicit, opt-in dev-only evaluation so `new Date()`, `new Map()` etc. can be expressed
	return new Function(`return (${source});`)();
}

// Kit 2.x takes `(value, transport)`, Kit 3 reads the transport itself
export function encode_query_arg(value: unknown): string {
	return stringify_remote_arg.length >= 2 ? stringify_remote_arg(value, app?.hooks?.transport) : stringify_remote_arg(value);
}

export async function encode_command_arg(value: unknown): Promise<string> {
	return stringify_command_arg.length >= 2 ? stringify_command_arg(value, app?.hooks?.transport) : stringify_command_arg(value);
}

// ---------------------------------------------------------------------------------------------------
// Requests

export interface PlaygroundRequest {
	method: 'GET' | 'POST';
	url: string;
	headers: Record<string, string>;
	/** FormData for forms: `fetch` then sends it multipart, which Kit's form endpoint accepts like a native submit */
	body: string | FormData | null;
	/** the encoded payload(s), for display */
	payloads: string[];
}

export async function build_request(fn: RemoteFunctionEntry, arg: unknown): Promise<PlaygroundRequest> {
	const endpoint = `${base}/${app_dir}/remote/${fn.id}`;
	const headers: Record<string, string> = {
		'x-sveltekit-pathname': location.pathname,
		'x-sveltekit-search': location.search
	};
	switch (fn.kind) {
		case 'query':
		case 'query_live': {
			const payload = encode_query_arg(arg);
			if (fn.kind === 'query_live') headers.accept = 'text/event-stream';
			return { method: 'GET', url: payload ? `${endpoint}?payload=${payload}` : endpoint, headers, body: null, payloads: [payload] };
		}
		case 'prerender': {
			const payload = encode_query_arg(arg);
			return { method: 'GET', url: payload ? `${endpoint}/${payload}` : endpoint, headers, body: null, payloads: [payload] };
		}
		case 'query_batch': {
			if (!Array.isArray(arg)) throw new Error('query.batch: enter an array, one element per call');
			const payloads = arg.map(encode_query_arg);
			headers['content-type'] = 'application/json';
			return { method: 'POST', url: endpoint, headers, body: JSON.stringify({ payloads }), payloads };
		}
		case 'command': {
			const payload = await encode_command_arg(arg);
			headers['content-type'] = 'application/json';
			return { method: 'POST', url: endpoint, headers, body: JSON.stringify({ payload, refreshes: [] }), payloads: [payload] };
		}
		case 'form':
			if (!(arg instanceof FormData)) throw new Error('forms are submitted as FormData');
			return { method: 'POST', url: endpoint, headers, body: arg, payloads: [] };
	}
}

const shell_quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

export function curl_line(request: PlaygroundRequest): string {
	const parts = ['curl', '-sS'];
	if (request.method !== 'GET') parts.push('-X', request.method);
	if (request.headers.accept === 'text/event-stream') parts.push('-N');
	for (const [key, value] of Object.entries(request.headers)) {
		if (key.startsWith('x-sveltekit-')) continue;
		parts.push('-H', shell_quote(`${key}: ${value}`));
	}
	if (request.body instanceof FormData) {
		for (const [key, value] of request.body) {
			if (typeof value === 'string') parts.push('-F', shell_quote(`${key}=${value}`));
			else if (value.name) parts.push('-F', shell_quote(`${key}=@${value.name}`));
		}
	} else if (request.body !== null) parts.push('--data', shell_quote(request.body));
	parts.push(shell_quote(new URL(request.url, location.origin).href));
	return parts.join(' ');
}

export interface BatchItem {
	ok: boolean;
	value: unknown;
}

export interface PlaygroundResult {
	status: number;
	durationMs: number;
	/** envelope type, or 'raw' when the body was not the Kit JSON envelope */
	type: 'result' | 'error' | 'redirect' | 'raw';
	data?: RemoteFunctionData;
	/** query.batch: per-argument results */
	batch?: BatchItem[];
	error?: unknown;
	location?: string;
	raw?: string;
}

interface Envelope {
	type: 'result' | 'error' | 'redirect';
	data?: string;
	/** older Kit 2 versions sent the bare output here instead of `data` */
	result?: string;
	error?: unknown;
	location?: string;
}

export async function send(fn: RemoteFunctionEntry, request: PlaygroundRequest, signal?: AbortSignal): Promise<PlaygroundResult> {
	const started = performance.now();
	const response = await fetch(request.url, {
		method: request.method,
		headers: request.headers,
		body: request.body,
		signal
	});
	const raw = await response.text();
	const durationMs = performance.now() - started;
	let envelope: Envelope;
	try {
		envelope = JSON.parse(raw) as Envelope;
	} catch {
		return { status: response.status, durationMs, type: 'raw', raw };
	}
	const encoded = envelope.data ?? envelope.result;
	if (envelope.type === 'result' && encoded !== undefined) {
		const data = envelope.data !== undefined ? decode_response_data(encoded) : { _: decode_server_value(encoded) };
		const result: PlaygroundResult = { status: response.status, durationMs, type: 'result', data, raw };
		if (fn.kind === 'query_batch' && Array.isArray(data._)) {
			result.batch = (data._ as Array<{ type: string; data?: unknown; error?: unknown }>).map((item) =>
				item.type === 'error' ? { ok: false, value: item.error } : { ok: true, value: item.data }
			);
		}
		if (data.redirect) return { ...result, type: 'redirect', location: data.redirect };
		return result;
	}
	if (envelope.type === 'redirect') return { status: response.status, durationMs, type: 'redirect', location: envelope.location, raw };
	if (envelope.type === 'error') return { status: response.status, durationMs, type: 'error', error: envelope.error, raw };
	return { status: response.status, durationMs, type: 'raw', raw };
}

export interface LiveEvent {
	seq: number;
	at: number;
	type: 'result' | 'error' | 'redirect' | 'other';
	value: unknown;
}

/** Streams a query.live endpoint, calling `on_event` per SSE message until the stream ends or is aborted */
export async function stream_live(
	request: PlaygroundRequest,
	signal: AbortSignal,
	on_open: (status: number, contentType: string | null) => void,
	on_event: (event: LiveEvent) => void
): Promise<void> {
	const response = await fetch(request.url, { method: 'GET', headers: request.headers, signal });
	const content_type = response.headers.get('content-type');
	on_open(response.status, content_type);
	if (!response.ok || !content_type?.includes('text/event-stream') || !response.body) {
		const text = await response.text();
		let value: unknown = text;
		try {
			value = JSON.parse(text);
		} catch {}
		on_event({ seq: 0, at: Date.now(), type: 'error', value });
		return;
	}
	let seq = 0;
	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = '';
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += value;
			let index: number;
			while ((index = buffer.indexOf('\n\n')) !== -1) {
				const message = buffer.slice(0, index);
				buffer = buffer.slice(index + 2);
				const data = message
					.split('\n')
					.filter((line) => line.startsWith('data:'))
					.map((line) => line.slice(5).trimStart())
					.join('\n');
				if (!data) continue; // keep-alive comment
				const node = JSON.parse(data) as { type: string; result?: string; error?: unknown; location?: string };
				if (node.type === 'result' && node.result !== undefined) {
					on_event({ seq: ++seq, at: Date.now(), type: 'result', value: devalue.parse(node.result, app_decoders()) });
				} else if (node.type === 'error') {
					on_event({ seq: ++seq, at: Date.now(), type: 'error', value: node.error });
				} else if (node.type === 'redirect') {
					on_event({ seq: ++seq, at: Date.now(), type: 'redirect', value: node.location });
				} else {
					on_event({ seq: ++seq, at: Date.now(), type: 'other', value: node });
				}
			}
		}
	} finally {
		reader.cancel().catch(() => {});
	}
}

// ---------------------------------------------------------------------------------------------------
// Display

/** JSON-ish pretty print that keeps Date / Map / Set / bigint / undefined readable */
export function pretty(value: unknown): string {
	const seen = new WeakSet<object>();
	const text = JSON.stringify(
		value,
		function (this: Record<string, unknown>, key, v: unknown) {
			// JSON.stringify calls Date#toJSON before the replacer; read the raw value instead
			const raw = key === '' ? value : this[key];
			if (raw instanceof Date) return `Date(${Number.isNaN(raw.getTime()) ? 'Invalid' : raw.toISOString()})`;
			if (raw instanceof Map) return { 'Map()': Array.from(raw.entries()) };
			if (raw instanceof Set) return { 'Set()': Array.from(raw) };
			if (raw instanceof URL) return `URL(${raw.href})`;
			if (typeof raw === 'bigint') return `${raw}n`;
			if (raw === undefined) return 'undefined';
			if (raw instanceof Error) return { name: raw.name, message: raw.message };
			if (raw !== null && typeof raw === 'object') {
				if (seen.has(raw)) return '[Circular]';
				seen.add(raw);
			}
			return v;
		},
		2
	);
	return text ?? 'undefined';
}
