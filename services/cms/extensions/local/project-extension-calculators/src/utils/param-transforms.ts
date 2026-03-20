import type { InputParameter, OutputParameter } from '../types';

export const TRANSFORM_PATTERNS: Record<string, string> = {
	date: '^(?:19|20)\\d\\d-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])$',
	time: '^(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?$',
	datetime: '^(?:19|20)\\d\\d-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d$',
};

export function toLogicalType<T extends { type: string; transform?: string; pattern?: string | null; minimum?: number | null; maximum?: number | null }>(param: T): T {
	if (!param.transform) return param;
	const result = { ...param, type: param.transform as T['type'] };
	delete result.transform;
	if (result.type === 'date' || result.type === 'time' || result.type === 'datetime') {
		delete result.pattern;
	}
	// currency has no extra schema fields to clean up
	return result;
}

export function toSchemaParam<T extends { type: string; transform?: string; pattern?: string | null; minimum?: number | null; maximum?: number | null }>(param: T): T {
	const t = param.type;
	if (t === 'date' || t === 'time' || t === 'datetime') {
		return { ...param, type: 'string' as T['type'], pattern: TRANSFORM_PATTERNS[t], transform: t };
	}
	if (t === 'percentage') {
		const result = { ...param, type: 'number' as T['type'], transform: 'percentage' };
		if (result.minimum == null) result.minimum = 0;
		if (result.maximum == null) result.maximum = 100;
		return result;
	}
	if (t === 'currency') {
		return { ...param, type: 'number' as T['type'], transform: 'currency' };
	}
	return param;
}

export function extractParams<T extends { type: string; transform?: string; pattern?: string | null; items?: { type: string; properties: Record<string, any> }; required?: boolean; order?: number }>(input: Record<string, unknown> | null): Record<string, T> {
	if (!input) return {};
	let raw: Record<string, T>;
	const requiredKeys: string[] = (input.type === 'object' && Array.isArray(input.required)) ? input.required as string[] : [];
	const orderKeys: string[] = (input.type === 'object' && Array.isArray((input as any).order)) ? (input as any).order as string[] : [];
	if (input.type === 'object' && input.properties && typeof input.properties === 'object') {
		raw = JSON.parse(JSON.stringify(input.properties));
	} else {
		raw = JSON.parse(JSON.stringify(input));
	}
	const result: Record<string, T> = {};
	for (const [key, param] of Object.entries(raw)) {
		const converted = toLogicalType(param);
		if ((converted as any).items?.properties) {
			const subProps: Record<string, any> = {};
			for (const [sk, sv] of Object.entries((converted as any).items.properties)) {
				subProps[sk] = toLogicalType(sv as any);
			}
			(converted as any).items = { ...(converted as any).items, properties: subProps };
		}
		if (requiredKeys.includes(key)) {
			(converted as any).required = true;
		}
		// Use top-level order array if present, otherwise keep per-param order
		if (orderKeys.length > 0) {
			const idx = orderKeys.indexOf(key);
			(converted as any).order = idx >= 0 ? idx : 999;
		}
		result[key] = converted;
	}
	return result;
}

export function validateSchema(schema: Record<string, unknown>): string[] {
	const errors: string[] = [];
	if (schema.type !== 'object') errors.push('Schema type must be "object"');
	if (!schema.properties || typeof schema.properties !== 'object') {
		errors.push('Schema must have "properties" object');
		return errors;
	}
	if (schema.additionalProperties !== false) errors.push('Schema must have "additionalProperties": false');

	const propKeys = Object.keys(schema.properties as Record<string, unknown>);
	const props = schema.properties as Record<string, Record<string, unknown>>;

	// Validate required array
	if (schema.required !== undefined) {
		if (!Array.isArray(schema.required)) {
			errors.push('"required" must be an array');
		} else {
			for (const k of schema.required as string[]) {
				if (!propKeys.includes(k)) errors.push(`"required" references unknown property "${k}"`);
			}
		}
	}

	// Validate order array
	if (schema.order !== undefined) {
		if (!Array.isArray(schema.order)) {
			errors.push('"order" must be an array');
		} else {
			const orderKeys = schema.order as string[];
			for (const k of orderKeys) {
				if (!propKeys.includes(k)) errors.push(`"order" references unknown property "${k}"`);
			}
			for (const k of propKeys) {
				if (!orderKeys.includes(k)) errors.push(`Property "${k}" missing from "order" array`);
			}
		}
	}

	// Validate individual properties
	for (const [key, param] of Object.entries(props)) {
		if (!param.mapping) errors.push(`Property "${key}" missing "mapping"`);
		if (!param.type) errors.push(`Property "${key}" missing "type"`);
		if ('required' in param) errors.push(`Property "${key}" has per-property "required" — use top-level array`);
		if ('order' in param) errors.push(`Property "${key}" has per-property "order" — use top-level array`);
	}

	return errors;
}

export function formatValue(val: unknown): string {
	if (val == null) return '—';
	if (typeof val === 'number') {
		return val.toLocaleString(undefined, { maximumFractionDigits: 10 });
	}
	if (typeof val === 'object') {
		return JSON.stringify(val);
	}
	return String(val);
}

export function wrapParams(
	params: Record<string, unknown>,
	opts?: { required?: string[]; order?: string[] },
): Record<string, unknown> {
	const properties: Record<string, unknown> = {};
	for (const [key, param] of Object.entries(params)) {
		const { required, order, ...rest } = param as Record<string, unknown>;
		properties[key] = rest;
	}
	const result: Record<string, unknown> = {
		type: 'object',
		properties,
		additionalProperties: false,
	};
	if (opts?.required?.length) result.required = opts.required;
	if (opts?.order?.length) result.order = opts.order;
	return result;
}

export function letterToCol(letters: string): number {
	let col = 0;
	for (let i = 0; i < letters.length; i++) {
		col = col * 26 + (letters.charCodeAt(i) - 64);
	}
	return col - 1;
}

export function readRange(rangeRef: string, sheets: Record<string, unknown[][]>): unknown[] | null {
	const match = rangeRef.match(/^'?([^'!]+)'?!([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
	if (!match) return null;

	const sheetName = match[1]!;
	const startCol = letterToCol(match[2]!);
	const startRow = parseInt(match[3]!) - 1;
	const endCol = letterToCol(match[4]!);
	const endRow = parseInt(match[5]!) - 1;

	const sheetData = sheets[sheetName];
	if (!sheetData) return null;

	const values: unknown[] = [];
	for (let r = startRow; r <= endRow && r < sheetData.length; r++) {
		const row = sheetData[r];
		if (!row) { values.push(null); continue; }
		if (startCol === endCol) {
			values.push(startCol < row.length ? row[startCol] : null);
		} else {
			for (let c = startCol; c <= endCol && c < row.length; c++) {
				values.push(row[c]);
			}
		}
	}

	return values;
}

export function generateOneOf(param: InputParameter, sheets: Record<string, unknown[][]> | null): InputParameter {
	if (!param.selection_mapping_id || !param.selection_mapping_title || !sheets) {
		const { oneOf: _, ...rest } = param;
		return rest;
	}

	const idValues = readRange(param.selection_mapping_id, sheets);
	const titleValues = readRange(param.selection_mapping_title, sheets);

	if (!idValues || !titleValues) return param;

	const oneOf: Array<{ const: unknown; title: unknown }> = [];
	const len = Math.min(idValues.length, titleValues.length);
	for (let i = 0; i < len; i++) {
		if (idValues[i] !== null && idValues[i] !== undefined && idValues[i] !== '') {
			oneOf.push({ const: idValues[i], title: titleValues[i] });
		}
	}

	return { ...param, oneOf };
}
