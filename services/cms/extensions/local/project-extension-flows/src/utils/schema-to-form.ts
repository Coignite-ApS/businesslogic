export interface FormField {
	key: string;
	label: string;
	type: 'string' | 'number' | 'boolean' | 'json' | 'select';
	description?: string;
	required?: boolean;
	default?: unknown;
	options?: { label: string; value: string }[];
}

/**
 * Convert a JSON Schema object to a flat list of form fields.
 * Handles basic types (string, number, integer, boolean, object/array → json).
 */
export function schemaToFormFields(schema: Record<string, unknown> | null): FormField[] {
	if (!schema) return [];

	const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
	const required = new Set((schema.required as string[]) || []);
	const fields: FormField[] = [];

	for (const [key, prop] of Object.entries(properties)) {
		const jsonType = prop.type as string || 'string';
		let type: FormField['type'] = 'string';
		let options: FormField['options'] | undefined;

		if (jsonType === 'number' || jsonType === 'integer') {
			type = 'number';
		} else if (jsonType === 'boolean') {
			type = 'boolean';
		} else if (jsonType === 'object' || jsonType === 'array') {
			type = 'json';
		} else if (prop.enum) {
			type = 'select';
			options = (prop.enum as string[]).map((v) => ({ label: v, value: v }));
		}

		fields.push({
			key,
			label: (prop.title as string) || key,
			type,
			description: prop.description as string | undefined,
			required: required.has(key),
			default: prop.default,
			options,
		});
	}

	return fields;
}
