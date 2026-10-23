import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Kit's own hash: kit_hash is a copy, and a different hash means every endpoint URL in the manifest is wrong
import { hash } from '../node_modules/@sveltejs/kit/src/utils/hash.js';
import { discover_remotes, kit_hash } from '../src/node/discover.ts';
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
	const importers = Object.fromEntries(found.map((r) => [path.basename(r.file), r.importedBy]));
	fs.rmSync(root, { recursive: true });

	expect(importers).toEqual({
		'a.remote.ts': [],
		'b.remote.ts': ['src/routes/+page.svelte'],
		'c.remote.ts': ['src/routes/+page.svelte'],
		'orphan.remote.ts': [],
		'local.remote.ts': ['src/routes/+page.svelte']
	});
});

test('canonical ignores union order and type names so duplicate endpoints match', () => {
	const union = (...names: string[]) => ({ kind: 'union' as const, types: names.map((name) => ({ kind: 'primitive' as const, name })) });
	expect(canonical(union('string', 'number'))).toBe(canonical(union('number', 'string')));
	const object = (name: string) => ({ kind: 'object' as const, name, properties: [{ name: 'id', optional: false, type: { kind: 'primitive' as const, name: 'string' } }] });
	expect(canonical(object('Post'))).toBe(canonical(object('Comment')));
	expect(canonical(union('string'))).not.toBe(canonical(union('number')));
});
