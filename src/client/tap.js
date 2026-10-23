// The fetch tap. Injected at the very top of SvelteKit's client entry, so it runs before hydration
// issues the first remote call. Deliberately import-free: in Kit 3 the entry sets its payload *after*
// this module evaluates, so importing anything from Kit here would initialise it too early.
//
// It records every request to `<base>/<appDir>/remote/…` — raw, undecoded — into a global buffer and
// notifies listeners. Decoding (devalue + the app's transport) and the UI happen in `main.ts`, which is
// imported lazily once the page has loaded.

const prefix = globalThis.__SK_REMOTE_DEVTOOLS_PREFIX__ ?? '/_app/remote/';

/**
 * @typedef {object} TapRecord
 * @property {number} seq
 * @property {string} url
 * @property {string} method
 * @property {string | null} body raw request body when it was a string
 * @property {Array<[string, string]> | null} form entries when the body was FormData (files summarised)
 * @property {string} pathname page the call was made from
 * @property {number} started performance.now() at request time
 * @property {number} at Date.now() at request time
 * @property {'pending' | 'done' | 'failed'} status
 * @property {number} [httpStatus]
 * @property {number} [durationMs]
 * @property {string | null} [contentType]
 * @property {string | null} [responseText] JSON body (cloned) for non-streaming responses
 * @property {string} [error]
 */

/** @type {{ records: TapRecord[]; listeners: Set<(record: TapRecord, phase: 'request' | 'response') => void>; seq: number; installed: boolean }} */
const store = (globalThis.__SK_REMOTE_DEVTOOLS__ ??= { records: [], listeners: new Set(), seq: 0, installed: false });

function emit(record, phase) {
	for (const listener of store.listeners) {
		try {
			listener(record, phase);
		} catch {}
	}
}

/** @param {FormData} data */
function summarise_form(data) {
	/** @type {Array<[string, string]>} */
	const entries = [];
	for (const [key, value] of data) {
		entries.push([key, typeof value === 'string' ? value : `[File ${value.name}, ${value.size} bytes, ${value.type || 'unknown type'}]`]);
	}
	return entries;
}

if (!store.installed) {
	store.installed = true;
	const original = globalThis.fetch;

	globalThis.fetch = function (input, init) {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		if (typeof url !== 'string' || !url.includes(prefix)) return original.call(this, input, init);

		const seq = ++store.seq;
		// Correlation id for the server-side trace of this same call. Only added when we control the init
		// object; Kit always calls fetch(url, init) so a Request input is the rare case.
		if (!(input instanceof Request)) {
			const headers = new Headers(init?.headers);
			headers.set('x-remote-devtools-call', String(seq));
			init = { ...init, headers };
		}

		const body = init?.body;
		/** @type {TapRecord} */
		const record = {
			seq,
			url,
			method: (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase(),
			body: typeof body === 'string' ? body : null,
			form:
				typeof FormData !== 'undefined' && body instanceof FormData
					? summarise_form(body)
					: body instanceof Blob || body instanceof ArrayBuffer
						? [['(binary form body)', `${body instanceof Blob ? body.size : body.byteLength} bytes — see the server's view`]]
						: null,
			pathname: location.pathname + location.search,
			started: performance.now(),
			at: Date.now(),
			status: 'pending'
		};
		// only kept for the devtool to replay when it mounts; afterwards it gets every record through `listeners`
		if (store.listeners.size === 0) store.records.push(record);
		emit(record, 'request');

		return original.call(this, input, init).then(
			async (response) => {
				record.httpStatus = response.status;
				record.durationMs = performance.now() - record.started;
				record.contentType = response.headers.get('content-type');
				if (record.contentType?.includes('application/json')) {
					// clone() so the app's own read of the body is unaffected; streams (query.live) are left alone
					try {
						record.responseText = await response.clone().text();
					} catch {}
				}
				record.status = 'done';
				emit(record, 'response');
				return response;
			},
			(error) => {
				record.durationMs = performance.now() - record.started;
				record.status = 'failed';
				record.error = String(error);
				emit(record, 'response');
				throw error;
			}
		);
	};

	// Mount the devtool after the page has settled: by then Kit has initialised its client runtime,
	// which main.ts imports by absolute path to share the same module instance.
	const boot = () => setTimeout(() => import('virtual:sveltekit-remote-devtools/main'), 50);
	if (document.readyState === 'complete') boot();
	else window.addEventListener('load', boot, { once: true });
}
