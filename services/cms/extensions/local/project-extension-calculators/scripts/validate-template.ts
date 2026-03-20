/**
 * Validates a calculator template JSON file against the expected schema.
 * Uses the same validation logic as the UI extension.
 *
 * Usage: npx tsx validate-template.ts <path-to-json>
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ─── Types (mirrored from ../src/types.ts) ───────────────────────────────────

interface InputParameter {
	mapping: string;
	title: string;
	description?: string;
	type: string;
	default?: unknown;
	minimum?: number | null;
	maximum?: number | null;
	minLength?: number | null;
	maxLength?: number | null;
	pattern?: string | null;
	transform?: string;
	selection_mapping_id?: string;
	selection_mapping_title?: string;
	oneOf?: Array<{ const: unknown; title: unknown }>;
	required?: boolean;
	order?: number;
}

interface OutputParameter {
	mapping: string;
	title: string;
	description?: string | null;
	type: string;
	readOnly?: boolean;
	transform?: string;
	order?: number;
	items?: {
		type: 'object';
		properties: Record<string, { mapping_item: string; title: string; [k: string]: unknown }>;
		required?: string[];
	};
}

interface Template {
	name: string;
	description: string;
	icon: string;
	industry: string;
	featured: boolean;
	sort: number;
	sheets: Record<string, unknown[][]>;
	formulas: Record<string, Record<string, string>>;
	input: { type: 'object'; properties: Record<string, InputParameter> };
	output: { type: 'object'; properties: Record<string, OutputParameter> };
}

// ─── Validation (mirrored from ../src/utils/param-validation.ts) ─────────────

const VALID_INPUT_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'date', 'time', 'datetime', 'percentage']);
const VALID_OUTPUT_TYPES = new Set([...VALID_INPUT_TYPES, 'array']);
const VALID_INDUSTRIES = new Set(['general', 'finance', 'construction', 'manufacturing', 'hr', 'marketing', 'energy', 'real-estate']);
const REQUIRED_SHEETS = ['Parameters', 'Calculations', 'Data'];

interface Error {
	field: string;
	message: string;
}

function validate(tmpl: Template): Error[] {
	const errors: Error[] = [];

	// ── Top-level fields ──────────────────────────────────────────────────
	if (!tmpl.name || typeof tmpl.name !== 'string') {
		errors.push({ field: 'name', message: 'Missing or invalid name' });
	}
	if (!tmpl.description || typeof tmpl.description !== 'string') {
		errors.push({ field: 'description', message: 'Missing or invalid description' });
	}
	if (!tmpl.icon || typeof tmpl.icon !== 'string') {
		errors.push({ field: 'icon', message: 'Missing or invalid icon' });
	}
	if (!tmpl.industry || !VALID_INDUSTRIES.has(tmpl.industry)) {
		errors.push({ field: 'industry', message: `Invalid industry "${tmpl.industry}". Must be one of: ${[...VALID_INDUSTRIES].join(', ')}` });
	}
	if (typeof tmpl.featured !== 'boolean') {
		errors.push({ field: 'featured', message: 'Must be boolean' });
	}
	if (typeof tmpl.sort !== 'number') {
		errors.push({ field: 'sort', message: 'Must be a number' });
	}

	// ── Sheets ────────────────────────────────────────────────────────────
	if (!tmpl.sheets || typeof tmpl.sheets !== 'object') {
		errors.push({ field: 'sheets', message: 'Missing or invalid sheets object' });
	} else {
		for (const name of REQUIRED_SHEETS) {
			if (!tmpl.sheets[name]) {
				errors.push({ field: `sheets.${name}`, message: `Missing required sheet "${name}"` });
			} else if (!Array.isArray(tmpl.sheets[name])) {
				errors.push({ field: `sheets.${name}`, message: 'Must be a 2D array' });
			} else if (tmpl.sheets[name].length < 2) {
				errors.push({ field: `sheets.${name}`, message: 'Must have at least header + 1 data row' });
			} else {
				for (let i = 0; i < tmpl.sheets[name].length; i++) {
					if (!Array.isArray(tmpl.sheets[name][i])) {
						errors.push({ field: `sheets.${name}[${i}]`, message: 'Each row must be an array' });
					}
				}
			}
		}
	}

	// ── Formulas ──────────────────────────────────────────────────────────
	if (!tmpl.formulas || typeof tmpl.formulas !== 'object') {
		errors.push({ field: 'formulas', message: 'Missing or invalid formulas object' });
	} else {
		for (const [sheet, cells] of Object.entries(tmpl.formulas)) {
			if (!tmpl.sheets?.[sheet]) {
				errors.push({ field: `formulas.${sheet}`, message: `References non-existent sheet "${sheet}"` });
			}
			if (typeof cells !== 'object' || cells === null) {
				errors.push({ field: `formulas.${sheet}`, message: 'Must be an object of cell:formula pairs' });
			} else {
				for (const [cell, formula] of Object.entries(cells)) {
					if (typeof formula !== 'string') {
						errors.push({ field: `formulas.${sheet}.${cell}`, message: 'Formula must be a string' });
					} else if (!formula.startsWith('=')) {
						errors.push({ field: `formulas.${sheet}.${cell}`, message: 'Formula must start with "="' });
					}
					// Validate cell ref format
					if (!/^[A-Z]+\d+$/.test(cell)) {
						errors.push({ field: `formulas.${sheet}.${cell}`, message: `Invalid cell reference "${cell}"` });
					}
				}
			}
		}
	}

	// ── Input params ──────────────────────────────────────────────────────
	if (!tmpl.input || tmpl.input.type !== 'object' || !tmpl.input.properties) {
		errors.push({ field: 'input', message: 'Must be { type: "object", properties: {...} }' });
	} else {
		const inputProps = tmpl.input.properties;
		const mappings = new Set<string>();

		for (const [key, param] of Object.entries(inputProps)) {
			if (!param.mapping) {
				errors.push({ field: `input.${key}`, message: 'Missing cell mapping' });
			} else {
				// Check mapping points to Parameters sheet
				if (!param.mapping.startsWith('Parameters!')) {
					errors.push({ field: `input.${key}`, message: `Mapping should reference Parameters sheet, got "${param.mapping}"` });
				}
				if (mappings.has(param.mapping)) {
					errors.push({ field: `input.${key}`, message: `Duplicate mapping "${param.mapping}"` });
				}
				mappings.add(param.mapping);

				// Check mapping corresponds to a sheet row
				if (tmpl.sheets?.Parameters) {
					const cellMatch = param.mapping.match(/^Parameters!([A-Z]+)(\d+)$/);
					if (cellMatch) {
						const rowNum = parseInt(cellMatch[2], 10);
						if (rowNum > tmpl.sheets.Parameters.length) {
							errors.push({ field: `input.${key}`, message: `Mapping row ${rowNum} exceeds Parameters sheet rows (${tmpl.sheets.Parameters.length})` });
						}
					}
				}
			}
			if (!param.title) {
				errors.push({ field: `input.${key}`, message: 'Missing title' });
			}
			if (!VALID_INPUT_TYPES.has(param.type)) {
				errors.push({ field: `input.${key}`, message: `Invalid type "${param.type}". Valid: ${[...VALID_INPUT_TYPES].join(', ')}` });
			}
			if (param.order == null) {
				errors.push({ field: `input.${key}`, message: 'Missing order' });
			}

			// Percentage validation
			if (param.transform === 'percentage') {
				if (param.type !== 'number') {
					errors.push({ field: `input.${key}`, message: 'Percentage transform requires type "number"' });
				}
				if (param.minimum == null || param.maximum == null) {
					errors.push({ field: `input.${key}`, message: 'Percentage params should have minimum: 0, maximum: 100' });
				}
			}

			// Range checks
			if (param.minimum != null && param.maximum != null && param.minimum > param.maximum) {
				errors.push({ field: `input.${key}`, message: 'Minimum exceeds maximum' });
			}
			if (param.minLength != null && param.maxLength != null && param.minLength > param.maxLength) {
				errors.push({ field: `input.${key}`, message: 'Min length exceeds max length' });
			}

			// Selection mapping pairing
			if (param.selection_mapping_id && !param.selection_mapping_title) {
				errors.push({ field: `input.${key}`, message: 'ID column range set but title column range missing' });
			}
			if (!param.selection_mapping_id && param.selection_mapping_title) {
				errors.push({ field: `input.${key}`, message: 'Title column range set but ID column range missing' });
			}
			if (param.oneOf?.length && !param.selection_mapping_id && !param.selection_mapping_title) {
				errors.push({ field: `input.${key}`, message: 'Predefined values without selection mapping' });
			}
		}
	}

	// ── Output params ─────────────────────────────────────────────────────
	if (!tmpl.output || tmpl.output.type !== 'object' || !tmpl.output.properties) {
		errors.push({ field: 'output', message: 'Must be { type: "object", properties: {...} }' });
	} else {
		const outputProps = tmpl.output.properties;
		const mappings = new Set<string>();

		for (const [key, param] of Object.entries(outputProps)) {
			if (!param.mapping) {
				errors.push({ field: `output.${key}`, message: 'Missing cell mapping' });
			} else {
				// Check mapping points to Calculations sheet
				if (!param.mapping.startsWith('Calculations!')) {
					errors.push({ field: `output.${key}`, message: `Mapping should reference Calculations sheet, got "${param.mapping}"` });
				}
				if (mappings.has(param.mapping)) {
					errors.push({ field: `output.${key}`, message: `Duplicate mapping "${param.mapping}"` });
				}
				mappings.add(param.mapping);
			}
			if (!param.title) {
				errors.push({ field: `output.${key}`, message: 'Missing title' });
			}
			if (!VALID_OUTPUT_TYPES.has(param.type)) {
				errors.push({ field: `output.${key}`, message: `Invalid type "${param.type}". Valid: ${[...VALID_OUTPUT_TYPES].join(', ')}` });
			}
			if (param.order == null) {
				errors.push({ field: `output.${key}`, message: 'Missing order' });
			}

			// Array type validation
			if (param.type === 'array') {
				if (!param.items?.properties || Object.keys(param.items.properties).length === 0) {
					errors.push({ field: `output.${key}`, message: 'Array type requires at least one sub-item' });
				} else {
					for (const [sk, sv] of Object.entries(param.items.properties)) {
						if (!sv.mapping_item) {
							errors.push({ field: `output.${key}.${sk}`, message: 'Missing mapping_item' });
						}
						if (!sv.title) {
							errors.push({ field: `output.${key}.${sk}`, message: 'Missing title' });
						}
					}
				}
			}
		}
	}

	// ── Cross-validation: formulas vs sheet rows ──────────────────────────
	if (tmpl.formulas && tmpl.sheets) {
		for (const [sheet, cells] of Object.entries(tmpl.formulas)) {
			if (tmpl.sheets[sheet]) {
				for (const cell of Object.keys(cells)) {
					const match = cell.match(/^[A-Z]+(\d+)$/);
					if (match) {
						const rowNum = parseInt(match[1], 10);
						if (rowNum > tmpl.sheets[sheet].length) {
							errors.push({ field: `formulas.${sheet}.${cell}`, message: `Row ${rowNum} exceeds sheet rows (${tmpl.sheets[sheet].length})` });
						}
					}
				}
			}
		}
	}

	return errors;
}

// ─── Main ────────────────────────────────────────────────────────────────────

const file = process.argv[2];
if (!file) {
	console.error('Usage: npx tsx validate-template.ts <path-to-json>');
	process.exit(1);
}

const path = resolve(file);
let data: Template;
try {
	data = JSON.parse(readFileSync(path, 'utf-8'));
} catch (e: any) {
	console.error(`Failed to read/parse ${path}: ${e.message}`);
	process.exit(1);
}

const errors = validate(data);

if (errors.length === 0) {
	const inputCount = Object.keys(data.input?.properties || {}).length;
	const outputCount = Object.keys(data.output?.properties || {}).length;
	const sheetNames = Object.keys(data.sheets || {});
	const formulaCount = Object.values(data.formulas || {}).reduce((sum, cells) => sum + Object.keys(cells).length, 0);

	console.log(`✓ ${data.name}`);
	console.log(`  Industry: ${data.industry} | Featured: ${data.featured} | Sort: ${data.sort}`);
	console.log(`  Sheets: ${sheetNames.join(', ')}`);
	console.log(`  Formulas: ${formulaCount} | Inputs: ${inputCount} | Outputs: ${outputCount}`);
	console.log(`  Description: ${data.description}`);
	process.exit(0);
} else {
	console.error(`✗ Validation failed for ${file}:\n`);
	for (const err of errors) {
		console.error(`  [${err.field}] ${err.message}`);
	}
	process.exit(1);
}
