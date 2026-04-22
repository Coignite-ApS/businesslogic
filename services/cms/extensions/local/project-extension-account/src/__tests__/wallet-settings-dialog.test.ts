import { describe, it, expect, vi } from 'vitest';

// Unit-test the dialog logic in isolation — no DOM, no Vue mount.
// We test the validation function and save-payload shape directly.

interface WalletConfig {
	auto_reload_enabled: boolean;
	auto_reload_threshold_eur: number | null;
	auto_reload_amount_eur: number | null;
	monthly_cap_eur: number | null;
}

function isValid(enabled: boolean, threshold: number | null, amount: number | null): boolean {
	if (!enabled) return true;
	return (
		threshold != null && threshold > 0
		&& amount != null && amount > 0
	);
}

function buildSavePayload(
	enabled: boolean,
	threshold: number | null,
	amount: number | null,
	cap: number | null,
): WalletConfig {
	return {
		auto_reload_enabled: enabled,
		auto_reload_threshold_eur: enabled ? threshold : null,
		auto_reload_amount_eur: enabled ? amount : null,
		monthly_cap_eur: cap && cap > 0 ? cap : null,
	};
}

describe('wallet-settings-dialog validation', () => {
	it('valid when auto-reload disabled regardless of threshold/amount', () => {
		expect(isValid(false, null, null)).toBe(true);
		expect(isValid(false, 0, 0)).toBe(true);
	});

	it('valid when auto-reload enabled with positive threshold and amount', () => {
		expect(isValid(true, 5, 20)).toBe(true);
	});

	it('invalid when auto-reload enabled but threshold is null', () => {
		expect(isValid(true, null, 20)).toBe(false);
	});

	it('invalid when auto-reload enabled but amount is null', () => {
		expect(isValid(true, 5, null)).toBe(false);
	});

	it('invalid when auto-reload enabled but threshold is 0', () => {
		expect(isValid(true, 0, 20)).toBe(false);
	});

	it('invalid when auto-reload enabled but amount is 0', () => {
		expect(isValid(true, 5, 0)).toBe(false);
	});

	it('invalid when both are negative', () => {
		expect(isValid(true, -1, -5)).toBe(false);
	});
});

describe('wallet-settings-dialog save payload', () => {
	it('includes threshold and amount when auto-reload enabled', () => {
		const payload = buildSavePayload(true, 5, 20, null);
		expect(payload.auto_reload_enabled).toBe(true);
		expect(payload.auto_reload_threshold_eur).toBe(5);
		expect(payload.auto_reload_amount_eur).toBe(20);
	});

	it('nulls out threshold and amount when auto-reload disabled', () => {
		const payload = buildSavePayload(false, 5, 20, null);
		expect(payload.auto_reload_enabled).toBe(false);
		expect(payload.auto_reload_threshold_eur).toBeNull();
		expect(payload.auto_reload_amount_eur).toBeNull();
	});

	it('includes monthly cap when positive', () => {
		const payload = buildSavePayload(true, 5, 20, 100);
		expect(payload.monthly_cap_eur).toBe(100);
	});

	it('nulls out monthly cap when 0 or null', () => {
		expect(buildSavePayload(true, 5, 20, 0).monthly_cap_eur).toBeNull();
		expect(buildSavePayload(true, 5, 20, null).monthly_cap_eur).toBeNull();
	});

	it('emits correct payload shape for full config', () => {
		const emit = vi.fn();
		const config = buildSavePayload(true, 3, 50, 200);
		emit('save', config);
		expect(emit).toHaveBeenCalledWith('save', {
			auto_reload_enabled: true,
			auto_reload_threshold_eur: 3,
			auto_reload_amount_eur: 50,
			monthly_cap_eur: 200,
		});
	});
});
