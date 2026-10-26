import { expect, test } from 'bun:test';
import type { RemoteKind, TypeNode } from '../src/node/manifest.ts';
import { duplicates, n_plus_one, unhandled_updates } from '../skills/remote-functions-audit/audit.mjs';

const str: TypeNode = { kind: 'primitive', name: 'string' };
const obj = (...names: string[]): TypeNode => ({ kind: 'object', properties: names.map((name) => ({ name, optional: false, type: str })) });
const fn = (name: string, kind: RemoteKind, input: TypeNode, output: TypeNode) => ({
	id: `h/${name}`,
	name,
	kind,
	file: 'src/x.remote.ts',
	importedBy: [],
	signature: `${kind === 'command' ? 'write' : 'read'} ${JSON.stringify(input)} → ${JSON.stringify(output)}`,
	types: { alias: null, validated: null, input: { text: '', tree: input }, output: { text: '', tree: output } }
});

test('duplicates: exact and near duplicates surface, same shape across read/write does not', () => {
	const manifest = {
		functions: [
			fn('getUser', 'query', str, obj('id', 'name', 'email')),
			fn('loadUser', 'query', str, obj('id', 'name', 'email')),
			fn('getProfile', 'query', str, obj('id', 'name', 'email', 'avatar')),
			fn('getUsers', 'query', { kind: 'primitive', name: 'void' }, { kind: 'array', element: obj('id', 'name', 'email') }),
			fn('saveUser', 'command', str, obj('id', 'name', 'email')),
			fn('addSheep', 'command', str, obj('id')),
			fn('removeSheep', 'command', str, obj('ok'))
		]
	};
	const pairs: Array<[string, string, number, string]> = duplicates(manifest).pairs.map(
		(p: { a: { name: string }; b: { name: string }; score: number; why: string[] }) => [p.a.name, p.b.name, p.score, p.why.join(', ')]
	);

	expect(pairs).toContainEqual(['getUser', 'loadUser', 1, 'exact signature, name stem "read user"']);
	expect(pairs).toContainEqual(['getUser', 'getProfile', 0.8, 'similar shape']);
	// array output matches its element, so the list query is a projection candidate
	expect(pairs).toContainEqual(['getUser', 'getUsers', 0.6, 'similar shape, name stem "read user"']);
	expect(pairs.some(([a, b]) => [a, b].includes('saveUser') && [a, b].some((n) => n !== 'saveUser' && n.endsWith('User')))).toBe(false);
	expect(pairs.some(([a, b]) => a === 'addSheep' && b === 'removeSheep')).toBe(false);
});

test('n_plus_one: one query with 3+ arguments per SSR render or HTTP burst', () => {
	const call = (args: string, at: number, origin = 'http', requestId = 0) => ({ kind: 'query', id: 'h/getWool', pathname: '/', origin, requestId, args, at });
	expect(n_plus_one([call('"a"', 0), call('"b"', 50), call('"c"', 120)])).toEqual([{ id: 'h/getWool', origin: 'http', pathname: '/', calls: 3 }]);
	// the same arguments again, or calls far apart, are not N+1
	expect(n_plus_one([call('"a"', 0), call('"a"', 10), call('"b"', 20), call('"c"', 500)])).toEqual([]);
	expect(n_plus_one([call('"a"', 0, 'ssr', 1), call('"b"', 900, 'ssr', 1), call('"c"', 2000, 'ssr', 1)])).toHaveLength(1);
});

test('unhandled_updates: .updates() keys left in requested after a successful write', () => {
	expect(
		unhandled_updates([
			{ kind: 'command', id: 'h/rename', outcome: 'ok', requested: [] },
			{ kind: 'command', id: 'h/shear', outcome: 'ok', requested: ['h/getWool/Ii', 'h/getWool/Ij'] },
			{ kind: 'command', id: 'h/broken', outcome: 'error', requested: ['h/getWool/Ii'] }
		])
	).toEqual([{ id: 'h/shear', queries: ['h/getWool'] }]);
});
