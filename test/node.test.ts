import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Kit's own hash: kit_hash is a copy, and a different hash means every endpoint URL in the manifest is wrong
import { hash } from '../node_modules/@sveltejs/kit/src/utils/hash.js';
import { discover_remotes, importers, kit_hash } from '../src/node/discover.ts';
import { canonical } from '../src/node/manifest.ts';

test('kit_hash matches Kit', () => {
	for (const file of ['src/routes/a.remote.ts', 'src/lib/users.remote.ts', 'src/routes/[id]/data.remote.js']) {
		expect(kit_hash(file)).toBe(hash(file));
	}
});

test('discover_remotes finds importers through relative paths, #imports and aliases', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skrd-'));
	const write = (file: string, text: string) => {
		fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		fs.writeFileSync(path.join(root, file), text);
	};
	write('src/lib/a.remote.ts', '');
	write('src/lib/b.remote.ts', '');
	write('src/lib/c.remote.ts', '');
	write('src/lib/orphan.remote.ts', '');
	write('src/routes/+page.svelte', `<script>import { x } from './local.remote'; import { y } from '#lib/b.remote'; import { z } from '$lib/c.remote';</script>`);
	write('src/routes/local.remote.ts', '');

	const found = discover_remotes(root, 'src', ['.ts'], { '#lib/*': './src/lib/*' }, [
		{ find: '$lib', replacement: path.join(root, 'src/lib') }
	]);
	const by_file = Object.fromEntries(found.map((r) => [path.basename(r.file), importers(r)]));
	fs.rmSync(root, { recursive: true });

	expect(by_file).toEqual({
		'a.remote.ts': [],
		'b.remote.ts': ['src/routes/+page.svelte'],
		'c.remote.ts': ['src/routes/+page.svelte'],
		'orphan.remote.ts': [],
		'local.remote.ts': ['src/routes/+page.svelte']
	});
});

test('discover_remotes records which exports each importer binds', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skrd-'));
	const write = (file: string, text: string) => {
		fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		fs.writeFileSync(path.join(root, file), text);
	};
	write('src/routes/data.remote.ts', '');
	write('src/routes/a/+page.svelte', `<script>import { getA, getB as b, type Thing } from '../data.remote';</script>`);
	write('src/routes/b/+page.svelte', `<script>import * as remote from '../data.remote';</script>`);
	write('src/routes/c/+page.ts', `export const load = () => import('../data.remote');`);
	write('src/routes/d/+page.ts', `import type { Only } from '../data.remote';`);
	write('src/routes/e/+page.svelte', `<script>\nimport {\n\tgetC,\n\tgetD\n} from '../data.remote';\n</script>`);
	write('src/routes/f/+page.svelte', `<script>\nimport {\n\tgetE, // in the header\n\t/* getOld, */ getF\n} from '../data.remote';\nimport { type Only } from '../data.remote';\n</script>`);
	write('src/routes/g/index.ts', `export { getG as g } from '../data.remote';\nexport * from '../data.remote';`);
	write('src/routes/h/+page.ts', `export function load() { return 1 }\nimport { getH } from '../data.remote';`);
	write('src/routes/i/+page.ts', `// import { getOld } from '../data.remote';\nconst docs = \`import { getDocs } from '../data.remote'\`;\nimport { getI /* ; */ } from '../data.remote';`);

	const [found] = discover_remotes(root, 'src', ['.ts'], {}, []);
	fs.rmSync(root, { recursive: true });

	expect(found.imports.find((i) => i.file === 'src/routes/g/index.ts' && i.names !== '*')?.names).toEqual(['getG']);
	expect(Object.fromEntries(found.imports.map((i) => [i.file, i.names]))).toEqual({
		'src/routes/a/+page.svelte': ['getA', 'getB'],
		'src/routes/b/+page.svelte': '*',
		'src/routes/c/+page.ts': '*',
		'src/routes/e/+page.svelte': ['getC', 'getD'],
		'src/routes/f/+page.svelte': ['getE', 'getF'],
		'src/routes/g/index.ts': '*',
		'src/routes/h/+page.ts': ['getH'],
		'src/routes/i/+page.ts': ['getI']
	});
});

test('canonical ignores union order and type names so duplicate endpoints match', () => {
	const union = (...names: string[]) => ({ kind: 'union' as const, types: names.map((name) => ({ kind: 'primitive' as const, name })) });
	expect(canonical(union('string', 'number'))).toBe(canonical(union('number', 'string')));
	const object = (name: string) => ({ kind: 'object' as const, name, properties: [{ name: 'id', optional: false, type: { kind: 'primitive' as const, name: 'string' } }] });
	expect(canonical(object('Post'))).toBe(canonical(object('Comment')));
	expect(canonical(union('string'))).not.toBe(canonical(union('number')));
});
