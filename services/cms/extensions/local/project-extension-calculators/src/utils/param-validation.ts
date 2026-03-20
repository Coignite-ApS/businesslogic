import type { InputParameter, OutputParameter } from '../types';

export interface ValidationError {
	param: string;
	message: string;
}

const VALID_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'date', 'time', 'datetime', 'percentage']);
const VALID_OUTPUT_TYPES = new Set([...VALID_TYPES, 'array']);

export function validateInputParams(params: Record<string, InputParameter>): ValidationError[] {
	const errors: ValidationError[] = [];

	for (const [key, param] of Object.entries(params)) {
		if (!param.mapping) {
			errors.push({ param: key, message: 'Missing cell mapping' });
		}
		if (!param.title) {
			errors.push({ param: key, message: 'Missing title' });
		}
		if (!VALID_TYPES.has(param.type)) {
			errors.push({ param: key, message: `Invalid type "${param.type}"` });
		}

		// Orphaned oneOf without selection_mapping fields
		if (param.oneOf?.length && !param.selection_mapping_id && !param.selection_mapping_title) {
			errors.push({ param: key, message: 'Predefined values without selection mapping — clear or re-set' });
		}

		// Partial selection_mapping
		if (param.selection_mapping_id && !param.selection_mapping_title) {
			errors.push({ param: key, message: 'ID column range set but title column range missing' });
		}
		if (!param.selection_mapping_id && param.selection_mapping_title) {
			errors.push({ param: key, message: 'Title column range set but ID column range missing' });
		}

		// oneOf titles must be strings
		if (param.oneOf?.length) {
			for (const item of param.oneOf) {
				if (item.title != null && typeof item.title !== 'string') {
					errors.push({ param: key, message: 'Predefined value title must be a string' });
					break;
				}
			}
		}

		// Range checks
		if (param.minimum != null && param.maximum != null && param.minimum > param.maximum) {
			errors.push({ param: key, message: 'Minimum exceeds maximum' });
		}
		if (param.minLength != null && param.maxLength != null && param.minLength > param.maxLength) {
			errors.push({ param: key, message: 'Min length exceeds max length' });
		}
	}

	return errors;
}

export function validateOutputParams(params: Record<string, OutputParameter>): ValidationError[] {
	const errors: ValidationError[] = [];

	for (const [key, param] of Object.entries(params)) {
		if (!param.mapping) {
			errors.push({ param: key, message: 'Missing cell mapping' });
		}
		if (!param.title) {
			errors.push({ param: key, message: 'Missing title' });
		}
		if (!VALID_OUTPUT_TYPES.has(param.type)) {
			errors.push({ param: key, message: `Invalid type "${param.type}"` });
		}

		// Array type validation
		if (param.type === 'array') {
			if (!param.items?.properties || Object.keys(param.items.properties).length === 0) {
				errors.push({ param: key, message: 'Array type requires at least one sub-item' });
			} else {
				for (const [sk, sv] of Object.entries(param.items.properties)) {
					if (!sv.mapping_item) {
						errors.push({ param: `${key}.${sk}`, message: 'Missing cell mapping' });
					}
					if (!sv.title) {
						errors.push({ param: `${key}.${sk}`, message: 'Missing title' });
					}
				}
			}
		}
	}

	return errors;
}
