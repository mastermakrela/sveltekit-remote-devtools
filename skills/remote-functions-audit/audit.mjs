#!/usr/bin/env node
// Audits a SvelteKit app's remote functions from what sveltekit-remote-devtools serves during `vite dev`.
// Usage: node audit.mjs <dev server origin, e.g. http://[::1]:5173> [min duplicate score, default 0.6]

import { fileURLToPath } from 'node:url';

/** Flattens a manifest TypeNode into `path:kind` leaves. `[]` and `?` are dropped so `User` ~ `User[]` and optional ~ required */
function leaves(node, path, out) {
	if (!node) return out;
	switch (node.kind) {
		case 'object':
			if (!node.properties.length) out.add(`${path}:{}`);
			for (const p of node.properties) leaves(p.type, `${path}.${p.name}`, out);
			return out;
		case 'array':
			return leaves(node.element, path, out);
		case 'union': {
			// `T | undefined` is how TypeScript spells an optional property
			const defined = node.types.filter((t) => !(t.kind === 'primitive' && ['undefined', 'null'].includes(t.name)));
			if (defined.length === 1) return leaves(defined[0], path, out);
			out.add(`${path}:${defined.every((t) => t.kind === 'literal') ? 'enum' : 'union'}`);
			return out;
		}
		case 'primitive':
			out.add(`${path}:${node.name}`);
			return out;
		case 'builtin':
			out.add(`${path}:${node.name}`);
			return out;
		default:
			out.add(`${path}:${node.kind}`);
			return out;
	}
}

const jaccard = (a, b) => {
	let both = 0;
	for (const x of a) if (b.has(x)) both++;
	return both / (a.size + b.size - both || 1);
};

// Synonym verbs share a class, so `getUser` ~ `fetchUsers` and `addSheep` ~ `createSheep`, but never `addSheep` ~ `removeSheep`
const VERBS = { read: 'get|fetch|load|list|find|read|query|select|all', create: 'create|add|insert|new', update: 'update|edit|save|set|rename', delete: 'delete|remove|destroy' };
const stem = (name) => {
	for (const [verb, words] of Object.entries(VERBS)) {
		const match = name.match(new RegExp(`^(${words})(?=[A-Z_]|$)_?(.*)$`));
		if (match) return `${verb} ${match[2].toLowerCase().replace(/ies$/, 'y').replace(/s$/, '')}`;
	}
	return `${name.toLowerCase().replace(/ies$/, 'y').replace(/s$/, '')}`;
};

/** @param {import('sveltekit-remote-devtools').RemoteManifest} manifest */
export function duplicates(manifest, min = 0.6) {
	const fns = manifest.functions.map((f) => ({
		f,
		family: ['command', 'form'].includes(f.kind) ? 'write' : 'read',
		typed: !!(f.types.input || f.types.output),
		leaves: leaves(f.types.output?.tree, 'out', leaves(f.types.input?.tree, 'in', new Set())),
		stem: stem(f.name)
	}));
	const pairs = [];
	for (let i = 0; i < fns.length; i++) {
		for (let j = i + 1; j < fns.length; j++) {
			const [a, b] = [fns[i], fns[j]];
			if (a.family !== b.family || !a.typed || !b.typed) continue;
			const score = jaccard(a.leaves, b.leaves);
			const why = [];
			if (a.f.signature === b.f.signature) why.push('exact signature');
			else if (score >= min) why.push('similar shape');
			if (a.stem === b.stem) why.push(`name stem "${a.stem}"`);
			if (why.length) pairs.push({ score: Math.round(score * 100) / 100, family: a.family, why, a: a.f, b: b.f });
		}
	}
	return {
		pairs: pairs.sort((x, y) => y.score - x.score),
		untyped: fns.filter((x) => !x.typed).map((x) => x.f.id)
	};
}

/** A plain `query` called with 3+ different arguments in one burst: one SSR request, or one page within 100 ms over HTTP */
export function n_plus_one(events) {
	const bursts = [];
	const open = new Map();
	for (const e of events.filter((e) => e.kind === 'query').sort((a, b) => a.at - b.at)) {
		const key = e.origin === 'ssr' ? `ssr ${e.requestId} ${e.id}` : `http ${e.pathname} ${e.id}`;
		const burst = open.get(key);
		if (burst && (e.origin === 'ssr' || e.at - burst.last <= 100)) {
			burst.args.add(e.args);
			burst.last = e.at;
		} else {
			const fresh = { id: e.id, origin: e.origin, pathname: e.pathname, args: new Set([e.args]), last: e.at };
			open.set(key, fresh);
			bursts.push(fresh);
		}
	}
	return bursts.filter((b) => b.args.size >= 3).map(({ id, origin, pathname, args }) => ({ id, origin, pathname, calls: args.size }));
}

/**
 * Per command/form: queries the client asked to refresh with `.updates()` that no `requested()` on the server handled.
 * Kit's `requested()` removes what it handles from `state.remote.requested`, and the event is recorded after the
 * handler ran, so whatever is left there was never handled.
 */
export function unhandled_updates(events) {
	const by_fn = new Map();
	for (const e of events) {
		if (!['command', 'form'].includes(e.kind) || e.outcome !== 'ok' || !e.requested?.length) continue;
		const queries = by_fn.get(e.id) ?? new Set();
		for (const key of e.requested) queries.add(key.split('/').slice(0, 2).join('/'));
		by_fn.set(e.id, queries);
	}
	return [...by_fn].map(([id, queries]) => ({ id, queries: [...queries] }));
}

/** @param {import('sveltekit-remote-devtools').RemoteManifest} manifest */
export function audit(manifest, events = [], min) {
	return {
		...duplicates(manifest, min),
		unused: manifest.functions.filter((f) => !f.importedBy.length).map((f) => f.id),
		unusedFiles: manifest.files.filter((f) => !f.importedBy.length).map((f) => f.file),
		unchecked: manifest.functions.filter((f) => f.validation.mode === 'unchecked').map((f) => f.id),
		failedImports: manifest.files.filter((f) => f.error).map((f) => `${f.file}: ${f.error}`),
		nPlusOne: n_plus_one(events),
		unhandledUpdates: unhandled_updates(events)
	};
}

function describe(f) {
	const n = f.importedBy.length;
	return `${f.id} (${f.kind}, ${f.file}, ${n} importer${n === 1 ? '' : 's'})`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [origin, min] = process.argv.slice(2);
	if (!origin) {
		console.error('usage: audit.mjs <dev server origin, e.g. http://[::1]:5173> [min duplicate score]');
		process.exit(1);
	}
	const get = (path) =>
		fetch(new URL(path, origin)).then((r) => {
			if (!r.ok) throw new Error(`${r.url}: HTTP ${r.status}`);
			return r.json();
		});
	const [manifest, events] = await Promise.all([get('/__remote-devtools/manifest.json'), get('/__remote-devtools/events.json')]);
	const report = audit(manifest, events, min ? Number(min) : undefined);
	const section = (title, items) => console.log(`\n## ${title} (${items.length})${items.length ? '\n' : ''}`);
	const list = (title, items) => {
		section(title, items);
		for (const item of items) console.log(`- ${item}`);
	};

	console.log(`${manifest.functions.length} functions in ${manifest.files.length} files, ${events.length} recorded calls`);
	if (manifest.typesError) console.log(`! no types, duplicates not compared: ${manifest.typesError}`);

	section('Duplicate candidates', report.pairs);
	for (const { score, family, why, a, b } of report.pairs) {
		console.log(`${score.toFixed(2)} ${family}  ${describe(a)}`);
		console.log(`           ~ ${describe(b)}`);
		console.log(`      in   ${a.types.input?.text ?? '?'}  |  ${b.types.input?.text ?? '?'}`);
		console.log(`      out  ${a.types.output?.text ?? '?'}  |  ${b.types.output?.text ?? '?'}`);
		console.log(`      why  ${why.join(', ')}\n`);
	}
	if (report.untyped.length) console.log(`no types, not compared: ${report.untyped.join(', ')}`);
	list('Imported by nothing', [...report.unusedFiles.map((f) => `${f} (whole file)`), ...report.unused]);
	list('Input not validated', report.unchecked);
	list('Module failed to import', report.failedImports);
	list(
		'N+1 queries',
		report.nPlusOne.map((b) => `${b.id}: ${b.calls} different arguments in one ${b.origin === 'ssr' ? 'SSR render' : 'burst'} of ${b.pathname}`)
	);
	list(
		'.updates() the server never handled',
		report.unhandledUpdates.map((f) => `${f.id}: ${f.queries.join(', ')}`)
	);
	if (!events.length) console.log('\nNo calls recorded yet: use the app (or reload its pages) and run again for the N+1 and .updates() checks.');
}
