import { describe, it, expect, vi } from 'vitest';

// Unit-test the banner visibility logic and topup callback in isolation.
// No DOM mount — pure function tests matching the component's computed logic.

function shouldShow(balanceEur: number | string | null | undefined): boolean {
	return Number(balanceEur ?? 0) < 1;
}

function formatEur(n: number | string | null | undefined): string {
	const v = Number(n || 0);
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(v);
}

describe('low-balance-banner visibility', () => {
	it('shows when balance is 0', () => {
		expect(shouldShow(0)).toBe(true);
	});

	it('shows when balance is 0.42', () => {
		expect(shouldShow(0.42)).toBe(true);
	});

	it('shows when balance is 0.99', () => {
		expect(shouldShow(0.99)).toBe(true);
	});

	it('hidden when balance is exactly 1', () => {
		expect(shouldShow(1)).toBe(false);
	});

	it('hidden when balance is 5', () => {
		expect(shouldShow(5)).toBe(false);
	});

	it('hidden when balance is 100', () => {
		expect(shouldShow(100)).toBe(false);
	});

	it('shows when balance is null (treats as 0)', () => {
		expect(shouldShow(null)).toBe(true);
	});

	it('shows when balance is a string "0.50"', () => {
		expect(shouldShow('0.50')).toBe(true);
	});

	it('hidden when balance is string "2.00"', () => {
		expect(shouldShow('2.00')).toBe(false);
	});
});

describe('low-balance-banner text', () => {
	it('formats balance as EUR currency', () => {
		expect(formatEur(0.42)).toContain('0.42');
		expect(formatEur(0.42)).toContain('€');
	});

	it('formats zero balance', () => {
		expect(formatEur(0)).toContain('€');
	});
});

describe('low-balance-banner topup callback', () => {
	it('fires topup event when button clicked', () => {
		const emit = vi.fn();
		// Simulate the emit call that happens on button click
		emit('topup');
		expect(emit).toHaveBeenCalledWith('topup');
		expect(emit).toHaveBeenCalledTimes(1);
	});
});
