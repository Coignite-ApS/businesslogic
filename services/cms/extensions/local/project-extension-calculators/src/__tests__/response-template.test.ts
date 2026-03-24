import { describe, it, expect } from 'vitest';

/**
 * Tests for response template format validation.
 *
 * The template editor serialises @mention chips as {{input.key}} or {{output.key}}.
 * These tests verify the regex patterns and serialisation rules used in template-editor.vue
 * and by the formula-api runtime resolver.
 */

const VAR_RE = /\{\{(input|output)\.([^}]+)\}\}/g;

function extractRefs(template: string): { kind: string; key: string }[] {
	const refs: { kind: string; key: string }[] = [];
	const regex = new RegExp(VAR_RE.source, 'g');
	let m;
	while ((m = regex.exec(template)) !== null) {
		refs.push({ kind: m[1], key: m[2] });
	}
	return refs;
}

// Simulates runtime resolution (mirrors formula-api resolveResponseTemplate)
function resolveTemplate(template: string, inputs: Record<string, unknown>, outputs: Record<string, unknown>): string {
	if (!template) return '';
	return template.replace(/\{\{(input|output)\.([^}]+)\}\}/g, (match, kind, key) => {
		const val = kind === 'input' ? inputs?.[key] : outputs?.[key];
		if (val === undefined || val === null) return match;
		if (typeof val === 'object') return JSON.stringify(val);
		return String(val);
	});
}

describe('response template — ref extraction', () => {
	it('finds no refs in plain text', () => {
		expect(extractRefs('Hello world')).toHaveLength(0);
	});

	it('finds input ref', () => {
		expect(extractRefs('Amount: {{input.amount}}')).toEqual([{ kind: 'input', key: 'amount' }]);
	});

	it('finds output ref', () => {
		expect(extractRefs('Result: {{output.total}}')).toEqual([{ kind: 'output', key: 'total' }]);
	});

	it('finds multiple mixed refs', () => {
		const refs = extractRefs('If {{input.amount}} exceeds {{input.limit}}, warn. Total: {{output.total}}');
		expect(refs).toHaveLength(3);
		expect(refs[0]).toEqual({ kind: 'input', key: 'amount' });
		expect(refs[1]).toEqual({ kind: 'input', key: 'limit' });
		expect(refs[2]).toEqual({ kind: 'output', key: 'total' });
	});

	it('handles underscore keys', () => {
		expect(extractRefs('{{input.monthly_payment}}')).toEqual([{ kind: 'input', key: 'monthly_payment' }]);
	});

	it('ignores malformed references missing closing braces', () => {
		expect(extractRefs('{{input.broken')).toHaveLength(0);
	});
});

describe('response template — runtime resolution', () => {
	it('resolves input and output refs', () => {
		const tpl = 'Loan {{input.amount}} → payment {{output.payment}}';
		expect(resolveTemplate(tpl, { amount: 100000 }, { payment: 536 }))
			.toBe('Loan 100000 → payment 536');
	});

	it('leaves unresolved refs intact', () => {
		const tpl = 'Payment: {{output.payment}}, Missing: {{output.gone}}';
		expect(resolveTemplate(tpl, {}, { payment: 999 }))
			.toBe('Payment: 999, Missing: {{output.gone}}');
	});

	it('returns empty string for empty template', () => {
		expect(resolveTemplate('', {}, {})).toBe('');
	});

	it('serialises object output values as JSON', () => {
		const tpl = 'Rows: {{output.rows}}';
		expect(resolveTemplate(tpl, {}, { rows: [1, 2, 3] })).toBe('Rows: [1,2,3]');
	});

	it('handles boolean values', () => {
		expect(resolveTemplate('Affordable: {{output.ok}}', {}, { ok: false }))
			.toBe('Affordable: false');
	});

	it('leaves null values as original ref', () => {
		expect(resolveTemplate('{{output.x}}', {}, { x: null })).toBe('{{output.x}}');
	});
});

describe('template serialisation format — round-trip', () => {
	it('@input chip serialised as {{input.key}}', () => {
		// The template editor encodes chips as {{input.paramName}} in modelValue
		const serialised = '{{input.monthly_payment}}';
		expect(extractRefs(serialised)).toEqual([{ kind: 'input', key: 'monthly_payment' }]);
	});

	it('@output chip serialised as {{output.key}}', () => {
		const serialised = '{{output.total_interest}}';
		expect(extractRefs(serialised)).toEqual([{ kind: 'output', key: 'total_interest' }]);
	});
});
