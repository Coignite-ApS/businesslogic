/**
 * Task 45 — GET /wallet/balance response shape
 *
 * Verifies that getWalletBalance returns all 5 auto-reload fields:
 *   balance_eur, auto_reload_enabled, auto_reload_threshold_eur,
 *   auto_reload_amount_eur, monthly_cap_eur
 */

import { describe, it, expect, vi } from 'vitest';
import { getWalletBalance } from '../src/wallet-handlers.js';

// ─── Mock DB builder ─────────────────────────────────────────────────────────

function makeMockDb(walletRow: Record<string, any> | null, ledgerRows: any[] = []) {
	const db: any = vi.fn((tbl: string) => {
		const chain: any = {};
		chain.where = vi.fn(() => chain);
		chain.orderBy = vi.fn(() => chain);
		chain.limit = vi.fn(() => (tbl === 'ai_wallet_ledger' ? Promise.resolve(ledgerRows) : chain));
		chain.first = vi.fn(() => Promise.resolve(walletRow));
		return chain;
	});
	return db;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('45 — getWalletBalance response shape', () => {
	it('returns all 5 fields when auto-reload is configured', async () => {
		const walletRow = {
			balance_eur: '12.50',
			auto_reload_enabled: true,
			auto_reload_threshold_eur: '5.00',
			auto_reload_amount_eur: '20.00',
			monthly_cap_eur: '100.00',
		};
		const db = makeMockDb(walletRow);

		const result = await getWalletBalance({ db, accountId: 'acc-1' });

		expect(result.balance_eur).toBe('12.50');
		expect(result.auto_reload_enabled).toBe(true);
		expect(result.auto_reload_threshold_eur).toBe('5.00');
		expect(result.auto_reload_amount_eur).toBe('20.00');
		expect(result.monthly_cap_eur).toBe('100.00');
		expect(Array.isArray(result.recent_ledger)).toBe(true);
	});

	it('returns null for threshold/amount when they are not set', async () => {
		const walletRow = {
			balance_eur: '5.00',
			auto_reload_enabled: false,
			auto_reload_threshold_eur: null,
			auto_reload_amount_eur: null,
			monthly_cap_eur: null,
		};
		const db = makeMockDb(walletRow);

		const result = await getWalletBalance({ db, accountId: 'acc-2' });

		expect(result.auto_reload_threshold_eur).toBeNull();
		expect(result.auto_reload_amount_eur).toBeNull();
		expect(result.monthly_cap_eur).toBeNull();
		expect(result.auto_reload_enabled).toBe(false);
	});

	it('zero-wallet fallback also returns 5 fields (all null/false/zero)', async () => {
		const db = makeMockDb(null); // wallet row not found

		const result = await getWalletBalance({ db, accountId: 'acc-3' });

		expect(result.balance_eur).toBe(0);
		expect(result.auto_reload_enabled).toBe(false);
		expect(result.auto_reload_threshold_eur).toBeNull();
		expect(result.auto_reload_amount_eur).toBeNull();
		expect(result.monthly_cap_eur).toBeNull();
		expect(result.recent_ledger).toEqual([]);
	});

	it('monthly_cap_eur null is present as null (not undefined or missing)', async () => {
		const walletRow = {
			balance_eur: '3.00',
			auto_reload_enabled: true,
			auto_reload_threshold_eur: '5.00',
			auto_reload_amount_eur: '20.00',
			monthly_cap_eur: null,
		};
		const db = makeMockDb(walletRow);

		const result = await getWalletBalance({ db, accountId: 'acc-4' });

		// key must exist and be explicitly null, not undefined
		expect(Object.prototype.hasOwnProperty.call(result, 'monthly_cap_eur')).toBe(true);
		expect(result.monthly_cap_eur).toBeNull();
	});
});
