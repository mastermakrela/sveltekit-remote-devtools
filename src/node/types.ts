// Resolves each remote export's Input / Output types with the TypeScript checker.
// SvelteKit's public types already carry them as type arguments, e.g.
// `RemoteQueryFunction<Input, Output, Validated>` — so no inference of our own is needed.
import ts from 'typescript';
import path from 'node:path';
import type { PropertyNode, RemoteFunctionTypes, TypeInfo, TypeNode } from './manifest.ts';

/** alias name → [inputIndex, outputIndex, validatedIndex] into `aliasTypeArguments` */
const kit_aliases: Record<string, [number, number, number]> = {
	RemoteQueryFunction: [0, 1, 2],
	RemoteLiveQueryFunction: [0, 1, 2],
	RemoteCommand: [0, 1, 0],
	RemoteForm: [0, 1, 0],
	RemotePrerenderFunction: [0, 1, 0]
};

const MAX_DEPTH = 8;

export class TypeExtractor {
	#root: string;
	#options: ts.CompilerOptions;
	#program: ts.Program | undefined;
	/** Ambient declaration files from the tsconfig (Kit 2 declares `$app/server` in .svelte-kit/ambient.d.ts) */
	#ambient: string[];

	constructor(root: string) {
		if (typeof ts.createProgram !== 'function') {
			throw new Error(`TypeScript ${ts.version} has no compiler API (TypeScript 7 is the native port); input/output types need TypeScript 5 or 6`);
		}
		this.#root = root;
		const parsed = ts.getParsedCommandLineOfConfigFile(path.join(root, 'tsconfig.json'), {}, {
			...ts.sys,
			onUnRecoverableConfigFileDiagnostic: (d) => {
				throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
			}
		});
		if (!parsed) throw new Error('Could not parse tsconfig.json');
		this.#options = { ...parsed.options, noEmit: true };
		this.#ambient = parsed.fileNames.filter((f) => f.endsWith('.d.ts'));
	}

	/** Returns types keyed by `<file>#<export>` */
	extract(files: string[]) {
		// Passing the previous program lets TypeScript reuse unchanged source files (incremental-ish).
		this.#program = ts.createProgram({
			rootNames: [...files.map((f) => path.join(this.#root, f)), ...this.#ambient],
			options: this.#options,
			oldProgram: this.#program
		});
		const program = this.#program;
		const checker = program.getTypeChecker();
		const result = new Map<string, RemoteFunctionTypes>();

		const info = (type: ts.Type, anchor: ts.Node): TypeInfo => ({
			text: checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation),
			tree: to_node(type, anchor, 0, new Set())
		});

		// Named library types (Date, Map, File, ...) stay collapsed. Anonymous object types that merely
		// *originate* in node_modules — e.g. valibot's / zod's inferred `{ ... }` — are expanded.
		const is_external = (symbol: ts.Symbol | undefined) =>
			!!symbol &&
			!symbol.name.startsWith('__') &&
			!!symbol.declarations?.some((d) => {
				const sf = d.getSourceFile();
				return program.isSourceFileDefaultLibrary(sf) || sf.fileName.includes('/node_modules/');
			});

		function to_node(type: ts.Type, anchor: ts.Node, depth: number, seen: Set<ts.Type>): TypeNode {
			const text = () => checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
			const f = type.flags;

			if (f & ts.TypeFlags.BooleanLiteral) return { kind: 'literal', value: text() === 'true' };
			if (f & ts.TypeFlags.Boolean) return { kind: 'primitive', name: 'boolean' };
			if (f & ts.TypeFlags.StringLiteral) return { kind: 'literal', value: (type as ts.StringLiteralType).value };
			if (f & ts.TypeFlags.NumberLiteral) return { kind: 'literal', value: (type as ts.NumberLiteralType).value };
			if (
				f &
				(ts.TypeFlags.String | ts.TypeFlags.Number | ts.TypeFlags.BigInt | ts.TypeFlags.Null |
					ts.TypeFlags.Undefined | ts.TypeFlags.Void | ts.TypeFlags.Any | ts.TypeFlags.Unknown |
					ts.TypeFlags.Never | ts.TypeFlags.ESSymbol | ts.TypeFlags.TemplateLiteral)
			) {
				return { kind: 'primitive', name: text() };
			}

			if (depth > MAX_DEPTH || seen.has(type)) return { kind: 'opaque', text: text() };
			const next = new Set(seen).add(type);

			if (type.isUnion()) {
				const members = type.types.map((t) => to_node(t, anchor, depth + 1, next));
				// `string | boolean` is represented as `string | false | true` — fold it back
				const t = members.findIndex((m) => m.kind === 'literal' && m.value === true);
				const fl = members.findIndex((m) => m.kind === 'literal' && m.value === false);
				if (t !== -1 && fl !== -1) {
					members.splice(Math.max(t, fl), 1);
					members.splice(Math.min(t, fl), 1, { kind: 'primitive', name: 'boolean' });
				}
				return members.length === 1 ? members[0] : { kind: 'union', types: members };
			}

			if (type.isIntersection()) {
				return { kind: 'intersection', types: type.types.map((t) => to_node(t, anchor, depth + 1, next)) };
			}

			if (checker.isTupleType(type)) {
				const target = (type as ts.TypeReference).target as ts.TupleType;
				return {
					kind: 'tuple',
					readonly: target.readonly,
					elements: checker.getTypeArguments(type as ts.TypeReference).map((t) => to_node(t, anchor, depth + 1, next))
				};
			}

			if (checker.isArrayType(type)) {
				const [element] = checker.getTypeArguments(type as ts.TypeReference);
				return { kind: 'array', element: to_node(element, anchor, depth + 1, next) };
			}

			if (f & ts.TypeFlags.Object) {
				const symbol = type.aliasSymbol ?? type.getSymbol();

				// Date, Map, Set, File, URL, ... — keep by name (devalue serialises these natively)
				if (is_external(type.getSymbol())) {
					const args = (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
						? checker.getTypeArguments(type as ts.TypeReference)
						: [];
					return { kind: 'builtin', name: type.getSymbol()!.name, args: args.map((t) => to_node(t, anchor, depth + 1, next)) };
				}

				if (type.getCallSignatures().length > 0) return { kind: 'opaque', text: text() };

				const properties: PropertyNode[] = checker.getPropertiesOfType(type).map((p) => {
					const optional = !!(p.flags & ts.SymbolFlags.Optional);
					let property_type = to_node(checker.getTypeOfSymbolAtLocation(p, anchor), anchor, depth + 1, next);
					// `tags?: string[] | undefined` — the `?` already says it
					if (optional && property_type.kind === 'union') {
						const types = property_type.types.filter((t) => !(t.kind === 'primitive' && t.name === 'undefined'));
						property_type = types.length === 1 ? types[0] : { kind: 'union', types };
					}
					return { name: p.name, optional, type: property_type };
				});

				const name = symbol && !symbol.name.startsWith('__') ? symbol.name : undefined;
				return { kind: 'object', name, properties };
			}

			return { kind: 'opaque', text: text() };
		}

		/** Unwrap Promise<T> / AsyncIterable<T> so `output` is what the client ends up holding */
		const unwrap = (type: ts.Type) => {
			const name = type.getSymbol()?.name;
			if ((name === 'Promise' || name === 'AsyncIterable') && is_external(type.getSymbol())) {
				return checker.getTypeArguments(type as ts.TypeReference)[0] ?? type;
			}
			return type;
		};

		for (const file of files) {
			const sf = program.getSourceFile(path.join(this.#root, file));
			const module_symbol = sf && checker.getSymbolAtLocation(sf);
			if (!module_symbol) continue;

			for (const symbol of checker.getExportsOfModule(module_symbol)) {
				const decl = symbol.valueDeclaration;
				if (!decl) continue;

				const type = checker.getTypeOfSymbolAtLocation(symbol, decl);
				const alias = type.aliasSymbol?.name ?? null;
				const indices = alias ? kit_aliases[alias] : undefined;
				const args = type.aliasTypeArguments;

				if (indices && args) {
					// Kit 2 aliases carry fewer type arguments (no `Validated`), so each index may be absent
					const [i, o, v] = indices;
					const at = (index: number) => (args[index] ? info(args[index], decl) : null);
					result.set(`${file}#${symbol.name}`, {
						alias,
						input: at(i),
						output: args[o] ? info(unwrap(args[o]), decl) : null,
						validated: at(v)
					});
					continue;
				}

				// Fallback: user wrapped the function in their own type — read the call signature
				const sig = type.getCallSignatures()[0];
				const param = sig?.parameters[0];
				result.set(`${file}#${symbol.name}`, {
					alias,
					input: param ? info(checker.getTypeOfSymbolAtLocation(param, decl), decl) : null,
					output: sig ? info(unwrap(sig.getReturnType()), decl) : null,
					validated: null
				});
			}
		}

		return result;
	}
}
