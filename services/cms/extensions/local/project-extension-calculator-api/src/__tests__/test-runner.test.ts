import { describe, it, expect } from 'vitest';
import { compareOutputs, type TestCaseResult } from '../test-runner.js';

describe('compareOutputs', () => {
	it('returns passed=true when actual matches expected', () => {
		const result = compareOutputs({ revenue: 1000 }, { revenue: 1000 }, 0);
		expect(result.passed).toBe(true);
		expect(result.diff).toEqual({});
	});

	it('returns passed=false when actual differs', () => {
		const result = compareOutputs({ revenue: 1000 }, { revenue: 900 }, 0);
		expect(result.passed).toBe(false);
		expect(result.diff).toEqual({ revenue: { expected: 900, actual: 1000 } });
	});

	it('passes when difference is within tolerance', () => {
		const result = compareOutputs({ revenue: 1000.005 }, { revenue: 1000 }, 0.01);
		expect(result.passed).toBe(true);
		expect(result.diff).toEqual({});
	});

	it('fails when difference exceeds tolerance', () => {
		const result = compareOutputs({ revenue: 1000.02 }, { revenue: 1000 }, 0.01);
		expect(result.passed).toBe(false);
		expect(result.diff.revenue).toBeDefined();
	});

	it('compares only expected output keys (subset)', () => {
		const result = compareOutputs(
			{ revenue: 500, tax: 100, cost: 200 },
			{ revenue: 500, cost: 200 },
			0,
		);
		// Only keys in expected are checked — extra actual keys (tax) are ignored
		expect(result.passed).toBe(true);
	});

	it('handles non-numeric values with strict equality', () => {
		const result = compareOutputs({ status: 'active' }, { status: 'inactive' }, 0.01);
		expect(result.passed).toBe(false);
		expect(result.diff.status).toEqual({ expected: 'inactive', actual: 'active' });
	});

	it('passes when non-numeric values match', () => {
		const result = compareOutputs({ status: 'active' }, { status: 'active' }, 0);
		expect(result.passed).toBe(true);
	});

	it('handles missing output key (actual is undefined)', () => {
		const result = compareOutputs({}, { revenue: 1000 }, 0);
		expect(result.passed).toBe(false);
		expect(result.diff.revenue).toEqual({ expected: 1000, actual: undefined });
	});

	it('returns empty diff for empty expected', () => {
		const result = compareOutputs({ revenue: 500 }, {}, 0);
		expect(result.passed).toBe(true);
		expect(result.diff).toEqual({});
	});
});

describe('TestCaseResult type', () => {
	it('has correct shape', () => {
		const r: TestCaseResult = {
			id: 'tc-1',
			name: 'My test',
			passed: true,
			expected: { revenue: 1000 },
			actual: { revenue: 1000 },
			diff: {},
		};
		expect(r.id).toBe('tc-1');
		expect(r.passed).toBe(true);
	});
});
