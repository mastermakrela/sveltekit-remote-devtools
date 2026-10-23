// Turns a captured validator into JSON Schema.
// 1. Standard JSON Schema (`~standard.jsonSchema`, implemented natively by Zod 4, ArkType)
// 2. Vendor fallbacks (Valibot needs @valibot/to-json-schema)
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Validation } from './manifest.ts';

interface StandardJSONSchemaV1 {
	input(options: { target: string }): Record<string, unknown>;
}

type Validator = StandardSchemaV1 & {
	'~standard': StandardSchemaV1['~standard'] & { jsonSchema?: StandardJSONSchemaV1 };
};

/** What the schema-capture shim attaches to each remote function (see shim.ts) */
export type CapturedValidator = Validator | 'unchecked' | null;

export async function to_validation(validator: CapturedValidator | undefined): Promise<Validation> {
	if (validator === undefined || validator === null) return { mode: 'none' };
	if (validator === 'unchecked') return { mode: 'unchecked' };

	const standard = validator['~standard'];
	const vendor = standard.vendor;

	try {
		if (standard.jsonSchema) {
			return {
				mode: 'standard-schema',
				vendor,
				jsonSchema: standard.jsonSchema.input({ target: 'draft-2020-12' }),
				jsonSchemaSource: '~standard.jsonSchema (Standard JSON Schema)'
			};
		}

		if (vendor === 'valibot') {
			const { toJsonSchema } = await import('@valibot/to-json-schema');
			return {
				mode: 'standard-schema',
				vendor,
				// errorMode 'ignore': transforms/custom checks have no JSON Schema equivalent, skip them
				jsonSchema: toJsonSchema(validator as Parameters<typeof toJsonSchema>[0], { errorMode: 'ignore' }),
				jsonSchemaSource: '@valibot/to-json-schema'
			};
		}

		return {
			mode: 'standard-schema',
			vendor,
			jsonSchema: null,
			jsonSchemaSource: null,
			error: `No JSON Schema converter known for vendor "${vendor}"`
		};
	} catch (error) {
		return {
			mode: 'standard-schema',
			vendor,
			jsonSchema: null,
			jsonSchemaSource: null,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
