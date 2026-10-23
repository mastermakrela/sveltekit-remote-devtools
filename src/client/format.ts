// Pretty-prints the structural type trees from the remote-explorer manifest as TypeScript-like text.
import type { TypeNode } from '../node/manifest.ts';

const pad = (depth: number) => '  '.repeat(depth);

export function format_type(node: TypeNode, depth = 0): string {
	switch (node.kind) {
		case 'primitive':
			return node.name;
		case 'literal':
			return typeof node.value === 'string' ? JSON.stringify(node.value) : String(node.value);
		case 'union':
			return node.types.map((t) => wrap(t, depth)).join(' | ');
		case 'intersection':
			return node.types.map((t) => wrap(t, depth)).join(' & ');
		case 'array':
			return `${wrap(node.element, depth)}[]`;
		case 'tuple':
			return `${node.readonly ? 'readonly ' : ''}[${node.elements.map((t) => format_type(t, depth)).join(', ')}]`;
		case 'builtin':
			return node.args.length ? `${node.name}<${node.args.map((t) => format_type(t, depth)).join(', ')}>` : node.name;
		case 'object': {
			if (node.properties.length === 0) return '{}';
			const lines = node.properties.map(
				(p) => `${pad(depth + 1)}${p.name}${p.optional ? '?' : ''}: ${format_type(p.type, depth + 1)};`
			);
			return `{\n${lines.join('\n')}\n${pad(depth)}}`;
		}
		case 'opaque':
			return node.text;
	}
}

function wrap(node: TypeNode, depth: number) {
	const text = format_type(node, depth);
	return node.kind === 'union' || node.kind === 'intersection' ? `(${text})` : text;
}
