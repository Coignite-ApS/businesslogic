import { describe, it, expect } from 'vitest';
import { validateInputParams, validateOutputParams } from '../utils/param-validation';
import type { InputParameter, OutputParameter } from '../types';

// ── Helpers ──────────────────────────────────────────────

function validInput(overrides: Partial<InputParameter> = {}): InputParameter {
	return { mapping: "'Sheet1'!A1", title: 'Amount', type: 'number', ...overrides };
}

function validOutput(overrides: Partial<OutputParameter> = {}): OutputParameter {
	return { mapping: "'Sheet1'!B1", title: 'Result', type: 'number', ...overrides };
}

// ── Input: valid configs (should pass) ───────────────────

describe('validateInputParams — valid configs', () => {
	it('accepts empty params', () => {
		expect(validateInputParams({})).toEqual([]);
	});

	it('accepts minimal valid param', () => {
		expect(validateInputParams({ amount: validInput() })).toEqual([]);
	});

	it('accepts all valid types', () => {
		const types = ['string', 'number', 'integer', 'boolean', 'date', 'time', 'datetime', 'percentage'] as const;
		const params: Record<string, InputParameter> = {};
		for (const t of types) {
			params[`p_${t}`] = validInput({ type: t });
		}
		expect(validateInputParams(params)).toEqual([]);
	});

	it('accepts number with valid min <= max', () => {
		expect(validateInputParams({
			rate: validInput({ type: 'number', minimum: 0, maximum: 100 }),
		})).toEqual([]);
	});

	it('accepts number with equal min and max', () => {
		expect(validateInputParams({
			fixed: validInput({ type: 'number', minimum: 50, maximum: 50 }),
		})).toEqual([]);
	});

	it('accepts string with valid minLength <= maxLength', () => {
		expect(validateInputParams({
			code: validInput({ type: 'string', minLength: 3, maxLength: 10 }),
		})).toEqual([]);
	});

	it('accepts complete predefined values with both mappings', () => {
		expect(validateInputParams({
			country: validInput({
				selection_mapping_id: "'Sheet1'!A1:A5",
				selection_mapping_title: "'Sheet1'!B1:B5",
				oneOf: [
					{ const: 'US', title: 'United States' },
					{ const: 'DE', title: 'Germany' },
				],
			}),
		})).toEqual([]);
	});

	it('accepts selection mappings without oneOf (pre-save state)', () => {
		expect(validateInputParams({
			country: validInput({
				selection_mapping_id: "'Sheet1'!A1:A5",
				selection_mapping_title: "'Sheet1'!B1:B5",
			}),
		})).toEqual([]);
	});

	it('accepts param with null min/max (unset constraints)', () => {
		expect(validateInputParams({
			val: validInput({ type: 'number', minimum: null, maximum: null }),
		})).toEqual([]);
	});

	it('accepts param with only minimum set', () => {
		expect(validateInputParams({
			val: validInput({ type: 'number', minimum: 0, maximum: null }),
		})).toEqual([]);
	});

	it('accepts param with only maximum set', () => {
		expect(validateInputParams({
			val: validInput({ type: 'number', minimum: null, maximum: 100 }),
		})).toEqual([]);
	});

	it('accepts complex multi-param config', () => {
		const params: Record<string, InputParameter> = {
			loan_amount: validInput({ type: 'number', minimum: 1000, maximum: 10_000_000, description: 'Principal amount' }),
			interest_rate: validInput({ type: 'percentage', minimum: 0, maximum: 100, mapping: "'Sheet1'!A2" }),
			start_date: validInput({ type: 'date', mapping: "'Sheet1'!A3" }),
			name: validInput({ type: 'string', minLength: 1, maxLength: 100, mapping: "'Sheet1'!A4" }),
			is_fixed: validInput({ type: 'boolean', mapping: "'Sheet1'!A5", default: true }),
			term: validInput({
				type: 'integer',
				mapping: "'Sheet1'!A6",
				selection_mapping_id: "'Options'!A1:A4",
				selection_mapping_title: "'Options'!B1:B4",
				oneOf: [
					{ const: 10, title: '10 years' },
					{ const: 15, title: '15 years' },
					{ const: 20, title: '20 years' },
					{ const: 30, title: '30 years' },
				],
			}),
		};
		expect(validateInputParams(params)).toEqual([]);
	});
});

// ── Input: invalid configs ───────────────────────────────

describe('validateInputParams — missing required fields', () => {
	it('detects missing mapping', () => {
		const errors = validateInputParams({
			amount: validInput({ mapping: '' }),
		});
		expect(errors).toContainEqual({ param: 'amount', message: 'Missing cell mapping' });
	});

	it('detects missing title', () => {
		const errors = validateInputParams({
			amount: validInput({ title: '' }),
		});
		expect(errors).toContainEqual({ param: 'amount', message: 'Missing title' });
	});

	it('detects missing mapping and title together', () => {
		const errors = validateInputParams({
			amount: validInput({ mapping: '', title: '' }),
		});
		expect(errors).toHaveLength(2);
		expect(errors).toContainEqual({ param: 'amount', message: 'Missing cell mapping' });
		expect(errors).toContainEqual({ param: 'amount', message: 'Missing title' });
	});

	it('detects invalid type', () => {
		const errors = validateInputParams({
			amount: validInput({ type: 'float' as any }),
		});
		expect(errors).toContainEqual({ param: 'amount', message: 'Invalid type "float"' });
	});

	it('does not accept "array" as input type', () => {
		const errors = validateInputParams({
			items: validInput({ type: 'array' as any }),
		});
		expect(errors).toContainEqual({ param: 'items', message: 'Invalid type "array"' });
	});
});

describe('validateInputParams — orphaned oneOf', () => {
	it('detects oneOf without any selection mapping', () => {
		const errors = validateInputParams({
			country: validInput({
				oneOf: [
					{ const: 'US', title: 'United States' },
					{ const: 'DE', title: 'Germany' },
				],
			}),
		});
		expect(errors).toContainEqual({
			param: 'country',
			message: 'Predefined values without selection mapping — clear or re-set',
		});
	});

	it('no error when oneOf is empty array', () => {
		const errors = validateInputParams({
			country: validInput({ oneOf: [] }),
		});
		// Empty oneOf is not orphaned — nothing to clean
		expect(errors.filter(e => e.message.includes('Predefined'))).toEqual([]);
	});

	it('no error when oneOf is undefined', () => {
		const errors = validateInputParams({
			country: validInput({ oneOf: undefined }),
		});
		expect(errors).toEqual([]);
	});
});

describe('validateInputParams — partial selection mapping', () => {
	it('detects ID column set but title column missing', () => {
		const errors = validateInputParams({
			region: validInput({
				selection_mapping_id: "'Sheet1'!A1:A5",
			}),
		});
		expect(errors).toContainEqual({
			param: 'region',
			message: 'ID column range set but title column range missing',
		});
	});

	it('detects title column set but ID column missing', () => {
		const errors = validateInputParams({
			region: validInput({
				selection_mapping_title: "'Sheet1'!B1:B5",
			}),
		});
		expect(errors).toContainEqual({
			param: 'region',
			message: 'Title column range set but ID column range missing',
		});
	});
});

describe('validateInputParams — non-string oneOf titles', () => {
	it('detects numeric title in oneOf', () => {
		const errors = validateInputParams({
			term: validInput({
				selection_mapping_id: "'Sheet1'!A1:A3",
				selection_mapping_title: "'Sheet1'!B1:B3",
				oneOf: [
					{ const: 10, title: 10 },
					{ const: 20, title: 20 },
					{ const: 30, title: 30 },
				],
			}),
		});
		expect(errors).toContainEqual({
			param: 'term',
			message: 'Predefined value title must be a string',
		});
	});

	it('detects boolean title in oneOf', () => {
		const errors = validateInputParams({
			flag: validInput({
				selection_mapping_id: "'Sheet1'!A1:A2",
				selection_mapping_title: "'Sheet1'!B1:B2",
				oneOf: [
					{ const: true, title: true },
					{ const: false, title: false },
				],
			}),
		});
		expect(errors).toContainEqual({
			param: 'flag',
			message: 'Predefined value title must be a string',
		});
	});

	it('reports only once even with multiple bad titles', () => {
		const errors = validateInputParams({
			term: validInput({
				selection_mapping_id: "'Sheet1'!A1:A3",
				selection_mapping_title: "'Sheet1'!B1:B3",
				oneOf: [
					{ const: 1, title: 1 },
					{ const: 2, title: 2 },
					{ const: 3, title: 3 },
				],
			}),
		});
		const titleErrors = errors.filter(e => e.message.includes('Predefined value title'));
		expect(titleErrors).toHaveLength(1);
	});

	it('allows null title (coerced at save)', () => {
		const errors = validateInputParams({
			term: validInput({
				selection_mapping_id: "'Sheet1'!A1:A2",
				selection_mapping_title: "'Sheet1'!B1:B2",
				oneOf: [
					{ const: 1, title: null },
					{ const: 2, title: 'Two' },
				],
			}),
		});
		const titleErrors = errors.filter(e => e.message.includes('Predefined value title'));
		expect(titleErrors).toHaveLength(0);
	});

	it('accepts all-string titles', () => {
		const errors = validateInputParams({
			term: validInput({
				selection_mapping_id: "'Sheet1'!A1:A3",
				selection_mapping_title: "'Sheet1'!B1:B3",
				oneOf: [
					{ const: 10, title: '10 years' },
					{ const: 20, title: '20 years' },
					{ const: 30, title: '30 years' },
				],
			}),
		});
		expect(errors).toEqual([]);
	});
});

describe('validateInputParams — range constraint violations', () => {
	it('detects minimum > maximum', () => {
		const errors = validateInputParams({
			amount: validInput({ type: 'number', minimum: 100, maximum: 10 }),
		});
		expect(errors).toContainEqual({ param: 'amount', message: 'Minimum exceeds maximum' });
	});

	it('detects minLength > maxLength', () => {
		const errors = validateInputParams({
			code: validInput({ type: 'string', minLength: 20, maxLength: 5 }),
		});
		expect(errors).toContainEqual({ param: 'code', message: 'Min length exceeds max length' });
	});

	it('allows negative ranges when min <= max', () => {
		const errors = validateInputParams({
			temp: validInput({ type: 'number', minimum: -40, maximum: -10 }),
		});
		expect(errors).toEqual([]);
	});

	it('detects inverted negative ranges', () => {
		const errors = validateInputParams({
			temp: validInput({ type: 'number', minimum: -10, maximum: -40 }),
		});
		expect(errors).toContainEqual({ param: 'temp', message: 'Minimum exceeds maximum' });
	});
});

describe('validateInputParams — multiple errors on one param', () => {
	it('stacks multiple errors for a badly configured param', () => {
		const errors = validateInputParams({
			bad: {
				mapping: '',
				title: '',
				type: 'blob' as any,
				minimum: 100,
				maximum: 10,
				oneOf: [{ const: 1, title: 1 }],
			},
		});
		expect(errors.length).toBeGreaterThanOrEqual(4);
		expect(errors.filter(e => e.param === 'bad')).toHaveLength(errors.length);
	});
});

describe('validateInputParams — multiple params with mixed validity', () => {
	it('only reports errors for invalid params', () => {
		const errors = validateInputParams({
			good: validInput(),
			bad_mapping: validInput({ mapping: '' }),
			also_good: validInput({ type: 'string', mapping: "'Sheet1'!A2" }),
			bad_range: validInput({ type: 'number', minimum: 50, maximum: 10 }),
		});
		expect(errors).toHaveLength(2);
		expect(errors.every(e => e.param === 'bad_mapping' || e.param === 'bad_range')).toBe(true);
	});
});

// ── Output: valid configs ────────────────────────────────

describe('validateOutputParams — valid configs', () => {
	it('accepts empty params', () => {
		expect(validateOutputParams({})).toEqual([]);
	});

	it('accepts minimal valid param', () => {
		expect(validateOutputParams({ result: validOutput() })).toEqual([]);
	});

	it('accepts all valid scalar types', () => {
		const types = ['string', 'number', 'integer', 'boolean', 'date', 'time', 'datetime', 'percentage'] as const;
		const params: Record<string, OutputParameter> = {};
		for (const t of types) {
			params[`o_${t}`] = validOutput({ type: t });
		}
		expect(validateOutputParams(params)).toEqual([]);
	});

	it('accepts array type with valid sub-items', () => {
		expect(validateOutputParams({
			schedule: validOutput({
				type: 'array',
				items: {
					type: 'object',
					properties: {
						month: { mapping_item: "'Sheet1'!C1", title: 'Month', type: 'string' },
						payment: { mapping_item: "'Sheet1'!D1", title: 'Payment', type: 'number' },
						interest: { mapping_item: "'Sheet1'!E1", title: 'Interest', type: 'number' },
					},
				},
			}),
		})).toEqual([]);
	});

	it('accepts complex multi-output config', () => {
		const params: Record<string, OutputParameter> = {
			monthly_payment: validOutput({ type: 'number', mapping: "'Sheet1'!B1" }),
			total_cost: validOutput({ type: 'number', mapping: "'Sheet1'!B2" }),
			start_date: validOutput({ type: 'date', mapping: "'Sheet1'!B3" }),
			summary: validOutput({ type: 'string', mapping: "'Sheet1'!B4" }),
			amortization: validOutput({
				type: 'array',
				mapping: "'Sheet1'!C1:E30",
				items: {
					type: 'object',
					properties: {
						period: { mapping_item: "'Sheet1'!C1", title: 'Period', type: 'integer' },
						principal: { mapping_item: "'Sheet1'!D1", title: 'Principal', type: 'number' },
						interest: { mapping_item: "'Sheet1'!E1", title: 'Interest', type: 'number' },
					},
				},
			}),
		};
		expect(validateOutputParams(params)).toEqual([]);
	});
});

// ── Output: invalid configs ──────────────────────────────

describe('validateOutputParams — missing required fields', () => {
	it('detects missing mapping', () => {
		const errors = validateOutputParams({
			result: validOutput({ mapping: '' }),
		});
		expect(errors).toContainEqual({ param: 'result', message: 'Missing cell mapping' });
	});

	it('detects missing title', () => {
		const errors = validateOutputParams({
			result: validOutput({ title: '' }),
		});
		expect(errors).toContainEqual({ param: 'result', message: 'Missing title' });
	});

	it('detects invalid type', () => {
		const errors = validateOutputParams({
			result: validOutput({ type: 'object' as any }),
		});
		expect(errors).toContainEqual({ param: 'result', message: 'Invalid type "object"' });
	});

	it('accepts "array" as output type (unlike input)', () => {
		const errors = validateOutputParams({
			items: validOutput({
				type: 'array',
				items: {
					type: 'object',
					properties: {
						val: { mapping_item: "'Sheet1'!C1", title: 'Val', type: 'number' },
					},
				},
			}),
		});
		expect(errors).toEqual([]);
	});
});

describe('validateOutputParams — array type validation', () => {
	it('detects array with no items', () => {
		const errors = validateOutputParams({
			schedule: validOutput({
				type: 'array',
			}),
		});
		expect(errors).toContainEqual({
			param: 'schedule',
			message: 'Array type requires at least one sub-item',
		});
	});

	it('detects array with empty properties', () => {
		const errors = validateOutputParams({
			schedule: validOutput({
				type: 'array',
				items: { type: 'object', properties: {} },
			}),
		});
		expect(errors).toContainEqual({
			param: 'schedule',
			message: 'Array type requires at least one sub-item',
		});
	});

	it('detects sub-item missing mapping_item', () => {
		const errors = validateOutputParams({
			schedule: validOutput({
				type: 'array',
				items: {
					type: 'object',
					properties: {
						month: { mapping_item: '', title: 'Month', type: 'string' },
					},
				},
			}),
		});
		expect(errors).toContainEqual({
			param: 'schedule.month',
			message: 'Missing cell mapping',
		});
	});

	it('detects sub-item missing title', () => {
		const errors = validateOutputParams({
			schedule: validOutput({
				type: 'array',
				items: {
					type: 'object',
					properties: {
						month: { mapping_item: "'Sheet1'!C1", title: '', type: 'string' },
					},
				},
			}),
		});
		expect(errors).toContainEqual({
			param: 'schedule.month',
			message: 'Missing title',
		});
	});

	it('detects multiple sub-item errors', () => {
		const errors = validateOutputParams({
			table: validOutput({
				type: 'array',
				items: {
					type: 'object',
					properties: {
						col_a: { mapping_item: '', title: '', type: 'number' },
						col_b: { mapping_item: "'Sheet1'!D1", title: '', type: 'string' },
						col_c: { mapping_item: '', title: 'Column C', type: 'number' },
					},
				},
			}),
		});
		// col_a: 2 errors (mapping + title), col_b: 1 (title), col_c: 1 (mapping)
		expect(errors).toHaveLength(4);
		expect(errors).toContainEqual({ param: 'table.col_a', message: 'Missing cell mapping' });
		expect(errors).toContainEqual({ param: 'table.col_a', message: 'Missing title' });
		expect(errors).toContainEqual({ param: 'table.col_b', message: 'Missing title' });
		expect(errors).toContainEqual({ param: 'table.col_c', message: 'Missing cell mapping' });
	});
});

// ── Complex combined scenarios ───────────────────────────

describe('complex real-world configs', () => {
	it('mortgage calculator — fully valid', () => {
		const inputErrors = validateInputParams({
			loan_amount: {
				mapping: "'Inputs'!B2",
				title: 'Loan Amount',
				type: 'number',
				minimum: 10000,
				maximum: 10_000_000,
			},
			interest_rate: {
				mapping: "'Inputs'!B3",
				title: 'Annual Interest Rate',
				type: 'percentage',
				minimum: 0,
				maximum: 100,
			},
			loan_term: {
				mapping: "'Inputs'!B4",
				title: 'Loan Term',
				type: 'integer',
				selection_mapping_id: "'Options'!A2:A5",
				selection_mapping_title: "'Options'!B2:B5",
				oneOf: [
					{ const: 10, title: '10 years' },
					{ const: 15, title: '15 years' },
					{ const: 20, title: '20 years' },
					{ const: 30, title: '30 years' },
				],
			},
			start_date: {
				mapping: "'Inputs'!B5",
				title: 'Start Date',
				type: 'date',
			},
			borrower_name: {
				mapping: "'Inputs'!B6",
				title: 'Borrower Name',
				type: 'string',
				minLength: 1,
				maxLength: 100,
			},
			fixed_rate: {
				mapping: "'Inputs'!B7",
				title: 'Fixed Rate',
				type: 'boolean',
				default: true,
			},
		});

		const outputErrors = validateOutputParams({
			monthly_payment: {
				mapping: "'Results'!B2",
				title: 'Monthly Payment',
				type: 'number',
			},
			total_interest: {
				mapping: "'Results'!B3",
				title: 'Total Interest',
				type: 'number',
			},
			schedule: {
				mapping: "'Schedule'!A2:D362",
				title: 'Amortization Schedule',
				type: 'array',
				items: {
					type: 'object',
					properties: {
						month: { mapping_item: "'Schedule'!A2", title: 'Month', type: 'integer' },
						payment: { mapping_item: "'Schedule'!B2", title: 'Payment', type: 'number' },
						principal: { mapping_item: "'Schedule'!C2", title: 'Principal', type: 'number' },
						interest: { mapping_item: "'Schedule'!D2", title: 'Interest', type: 'number' },
					},
				},
			},
		});

		expect(inputErrors).toEqual([]);
		expect(outputErrors).toEqual([]);
	});

	it('mortgage calculator — multiple subtle issues', () => {
		const inputErrors = validateInputParams({
			loan_amount: {
				mapping: "'Inputs'!B2",
				title: 'Loan Amount',
				type: 'number',
				minimum: 10_000_000,
				maximum: 10000,  // inverted
			},
			interest_rate: {
				mapping: "'Inputs'!B3",
				title: 'Interest Rate',
				type: 'percentage',
			},
			loan_term: {
				mapping: "'Inputs'!B4",
				title: 'Loan Term',
				type: 'integer',
				// orphaned oneOf — mappings removed but oneOf left behind
				oneOf: [
					{ const: 10, title: '10 years' },
					{ const: 30, title: '30 years' },
				],
			},
			region: {
				mapping: "'Inputs'!B5",
				title: 'Region',
				type: 'string',
				// partial mapping — only ID set
				selection_mapping_id: "'Options'!A1:A10",
			},
		});

		expect(inputErrors).toContainEqual({ param: 'loan_amount', message: 'Minimum exceeds maximum' });
		expect(inputErrors).toContainEqual({ param: 'loan_term', message: 'Predefined values without selection mapping — clear or re-set' });
		expect(inputErrors).toContainEqual({ param: 'region', message: 'ID column range set but title column range missing' });
	});

	it('output array with incomplete sub-items', () => {
		const outputErrors = validateOutputParams({
			total: {
				mapping: "'Results'!B2",
				title: 'Total',
				type: 'number',
			},
			breakdown: {
				mapping: "'Results'!A5:C20",
				title: 'Cost Breakdown',
				type: 'array',
				items: {
					type: 'object',
					properties: {
						category: { mapping_item: "'Results'!A5", title: 'Category', type: 'string' },
						amount: { mapping_item: '', title: 'Amount', type: 'number' },  // missing mapping
						note: { mapping_item: "'Results'!C5", title: '', type: 'string' },  // missing title
					},
				},
			},
		});

		expect(outputErrors).toHaveLength(2);
		expect(outputErrors).toContainEqual({ param: 'breakdown.amount', message: 'Missing cell mapping' });
		expect(outputErrors).toContainEqual({ param: 'breakdown.note', message: 'Missing title' });
	});

	it('param with numeric oneOf titles from Excel (common bug)', () => {
		const errors = validateInputParams({
			year: {
				mapping: "'Inputs'!B1",
				title: 'Year',
				type: 'integer',
				selection_mapping_id: "'Data'!A1:A5",
				selection_mapping_title: "'Data'!A1:A5", // same column — titles are numbers from Excel
				oneOf: [
					{ const: 2022, title: 2022 },
					{ const: 2023, title: 2023 },
					{ const: 2024, title: 2024 },
					{ const: 2025, title: 2025 },
					{ const: 2026, title: 2026 },
				],
			},
		});

		expect(errors).toContainEqual({
			param: 'year',
			message: 'Predefined value title must be a string',
		});
	});

	it('completely empty param (all fields blank)', () => {
		const errors = validateInputParams({
			empty: { mapping: '', title: '', type: '' as any },
		});
		expect(errors.length).toBeGreaterThanOrEqual(3);
		expect(errors).toContainEqual({ param: 'empty', message: 'Missing cell mapping' });
		expect(errors).toContainEqual({ param: 'empty', message: 'Missing title' });
		expect(errors).toContainEqual({ param: 'empty', message: 'Invalid type ""' });
	});

	it('output with array type but missing items entirely', () => {
		const errors = validateOutputParams({
			table: {
				mapping: "'Sheet1'!A1:C10",
				title: 'Data Table',
				type: 'array',
				// no items property at all
			},
		});
		expect(errors).toContainEqual({
			param: 'table',
			message: 'Array type requires at least one sub-item',
		});
	});

	it('mixed valid and invalid across both input and output', () => {
		const inputErrors = validateInputParams({
			good_input: validInput(),
			bad_input: validInput({ mapping: '', minimum: 100, maximum: 1 }),
		});
		const outputErrors = validateOutputParams({
			good_output: validOutput(),
			bad_output: validOutput({ title: '' }),
			array_output: validOutput({
				type: 'array',
				items: { type: 'object', properties: {} },
			}),
		});

		// bad_input: missing mapping + min > max
		expect(inputErrors).toHaveLength(2);
		// bad_output: missing title; array_output: empty sub-items
		expect(outputErrors).toHaveLength(2);
	});
});
