export interface TestCaseResult {
	id: string;
	name: string;
	passed: boolean;
	expected: Record<string, unknown>;
	actual: Record<string, unknown>;
	diff: Record<string, { expected: unknown; actual: unknown }>;
}

interface CompareResult {
	passed: boolean;
	diff: Record<string, { expected: unknown; actual: unknown }>;
}

/**
 * Compare actual calculator output against expected output subset.
 * Only keys present in `expected` are checked (subset comparison).
 * Numeric comparisons respect tolerance; others use strict equality.
 */
export function compareOutputs(
	actual: Record<string, unknown>,
	expected: Record<string, unknown>,
	tolerance: number,
): CompareResult {
	const diff: Record<string, { expected: unknown; actual: unknown }> = {};

	for (const [key, expectedVal] of Object.entries(expected)) {
		const actualVal = actual[key];

		if (typeof expectedVal === 'number' && tolerance > 0) {
			const actualNum = typeof actualVal === 'number' ? actualVal : NaN;
			if (isNaN(actualNum) || Math.abs(actualNum - expectedVal) > tolerance) {
				diff[key] = { expected: expectedVal, actual: actualVal };
			}
		} else if (actualVal !== expectedVal) {
			diff[key] = { expected: expectedVal, actual: actualVal };
		}
	}

	return {
		passed: Object.keys(diff).length === 0,
		diff,
	};
}
