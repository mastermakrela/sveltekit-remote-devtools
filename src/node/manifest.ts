// Shape of the JSON document served at /__remote-devtools/manifest.json.

export type RemoteKind = 'query' | 'query_batch' | 'query_live' | 'command' | 'form' | 'prerender';

export type TypeNode =
	| { kind: 'primitive'; name: string }
	| { kind: 'literal'; value: string | number | boolean }
	| { kind: 'union'; types: TypeNode[] }
	| { kind: 'intersection'; types: TypeNode[] }
	| { kind: 'array'; element: TypeNode }
	| { kind: 'tuple'; elements: TypeNode[]; readonly: boolean }
	| { kind: 'object'; name?: string; properties: PropertyNode[] }
	| { kind: 'builtin'; name: string; args: TypeNode[] }
	| { kind: 'opaque'; text: string };

export interface PropertyNode {
	name: string;
	optional: boolean;
	type: TypeNode;
}

export interface TypeInfo {
	/** `checker.typeToString` — keeps named types like `Post` collapsed */
	text: string;
	/** Structural expansion, named types inlined */
	tree: TypeNode;
}

export interface RemoteFunctionTypes {
	/** Which Kit type alias the export resolved to, e.g. `RemoteQueryFunction` */
	alias: string | null;
	/** What the caller passes (schema input type) */
	input: TypeInfo | null;
	/** What the handler receives after validation/transforms (e.g. zod defaults applied) */
	validated: TypeInfo | null;
	/** What the handler returns (unwrapped from Promise / AsyncIterable) */
	output: TypeInfo | null;
}

export type Validation =
	| { mode: 'none' }
	| { mode: 'unchecked' }
	| { mode: 'standard-schema'; vendor: string; jsonSchema: object | null; jsonSchemaSource: string | null; error?: string };

export interface HttpContract {
	method: 'GET' | 'POST';
	url: string;
	request: string;
	response: string;
}

export interface RemoteFunctionEntry {
	id: string;
	hash: string;
	name: string;
	file: string;
	kind: RemoteKind;
	/** prerender only: whether it is also callable at runtime */
	dynamic?: boolean;
	http: HttpContract;
	validation: Validation;
	types: RemoteFunctionTypes;
	/** Canonical (input, output) fingerprint used for duplicate detection */
	signature: string;
	/**
	 * `runtime`: read from the imported module (authoritative). `static`: the module failed to import
	 * (top-level side effects, e.g. a database seed) so the entry comes from TypeScript alone: the kind
	 * is inferred from Kit's type alias (`query.batch` is indistinguishable from `query`), and there is
	 * no captured schema.
	 */
	source: 'runtime' | 'static';
	/** Source files that statically import this export (or the whole module, via `* as` or `import()`) */
	importedBy: string[];
}

export interface RemoteFileEntry {
	file: string;
	hash: string;
	/** Source files that statically import this remote module */
	importedBy: string[];
	error?: string;
}

export interface RemoteManifest {
	generatedAt: string;
	kit: { version: string; appDir: string; base: string };
	timings: { discoverMs: number; importMs: number; typescriptMs: number };
	/** Set when the TypeScript checker could not run (types are then null on every function) */
	typesError?: string;
	files: RemoteFileEntry[];
	functions: RemoteFunctionEntry[];
	duplicates: Array<{ signature: string; ids: string[] }>;
	sameName: Array<{ name: string; ids: string[] }>;
}

/** Canonical form for duplicate detection: structure only, names of named object types dropped */
export function canonical(node: TypeNode | undefined | null): string {
	if (!node) return '∅';
	switch (node.kind) {
		case 'primitive':
			return node.name;
		case 'literal':
			return JSON.stringify(node.value);
		case 'union':
			return `(${node.types.map(canonical).sort().join('|')})`;
		case 'intersection':
			return `(${node.types.map(canonical).sort().join('&')})`;
		case 'array':
			return `${canonical(node.element)}[]`;
		case 'tuple':
			return `[${node.elements.map(canonical).join(',')}]`;
		case 'object':
			return `{${node.properties
				.map((p) => `${p.name}${p.optional ? '?' : ''}:${canonical(p.type)}`)
				.sort()
				.join(';')}}`;
		case 'builtin':
			return `${node.name}<${node.args.map(canonical).join(',')}>`;
		case 'opaque':
			return node.text;
	}
}
