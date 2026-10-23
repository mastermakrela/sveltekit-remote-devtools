// Finds remote modules the same way SvelteKit recognises them, and derives their endpoint hash.
import fs from 'node:fs';
import path from 'node:path';
import type { Alias } from 'vite';

/** Same pattern as `remote_module_pattern` in @sveltejs/kit/src/exports/vite/utils.js */
export const remote_module_pattern = /[/.]remote\.[^/]+$/;

/** djb2, base36 — copied from @sveltejs/kit/src/utils/hash.js */
export function kit_hash(value: string) {
	let hash = 5381;
	let i = value.length;
	while (i) hash = (hash * 33) ^ value.charCodeAt(--i);
	return (hash >>> 0).toString(36);
}

export const posix = (p: string) => p.split(path.sep).join('/');

function* walk(dir: string): Generator<string> {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(full);
		else yield full;
	}
}

export interface DiscoveredRemote {
	absolute: string;
	file: string;
	hash: string;
	importedBy: string[];
}

const source_extensions = ['.svelte', '.ts', '.js', '.mts', '.mjs'];
const import_specifier = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;

/**
 * @param root project root
 * @param src_dir SvelteKit `files.src` (absolute in the validated config)
 * @param module_extensions SvelteKit `moduleExtensions`
 * @param subpath_imports package.json `imports` (Kit 3 uses `#lib/*` instead of `$lib`)
 * @param aliases Vite's resolved `resolve.alias` (Kit 2's `$lib`, Kit's `alias` option, the app's own)
 */
export function discover_remotes(
	root: string,
	src_dir: string,
	module_extensions: string[],
	subpath_imports: Record<string, string>,
	aliases: Alias[]
): DiscoveredRemote[] {
	const sources = [...walk(path.resolve(root, src_dir))];

	const remotes = sources
		.filter((file) => remote_module_pattern.test(posix(file)))
		.filter((file) => module_extensions.includes(path.extname(file)))
		.map((absolute) => {
			const file = posix(path.relative(root, absolute));
			return { absolute, file, hash: kit_hash(file), importedBy: [] as string[] };
		});

	// Static "who imports this remote module" scan, so we can flag remote files that no page reaches.
	// Remote modules that are never imported are not part of the production build at all.
	const strip = (p: string) => p.replace(/\.(js|ts|mjs|mts)$/, '');
	const by_stem = new Map(remotes.map((r) => [strip(r.absolute), r]));

	for (const source of sources) {
		if (!source_extensions.some((ext) => source.endsWith(ext))) continue;
		const code = fs.readFileSync(source, 'utf8');

		for (const [, specifier] of code.matchAll(import_specifier)) {
			const resolved = resolve_specifier(root, source, specifier, subpath_imports, aliases);
			const remote = resolved && by_stem.get(strip(resolved));
			if (remote && remote.absolute !== source) {
				remote.importedBy.push(posix(path.relative(root, source)));
			}
		}
	}

	return remotes;
}

function resolve_specifier(
	root: string,
	importer: string,
	specifier: string,
	subpath_imports: Record<string, string>,
	aliases: Alias[]
) {
	if (specifier.startsWith('.')) return path.resolve(path.dirname(importer), specifier);

	for (const [pattern, target] of Object.entries(subpath_imports)) {
		if (pattern.endsWith('*') && specifier.startsWith(pattern.slice(0, -1))) {
			return path.resolve(root, target.replace('*', specifier.slice(pattern.length - 1)));
		}
		if (pattern === specifier) return path.resolve(root, target);
	}

	// Same matching as Vite's alias plugin: a string matches the whole specifier or a `find/` prefix
	for (const { find, replacement } of aliases) {
		if (typeof find === 'string' ? specifier === find || specifier.startsWith(find + '/') : find.test(specifier)) {
			return path.resolve(root, specifier.replace(find, replacement));
		}
	}

	return null;
}
