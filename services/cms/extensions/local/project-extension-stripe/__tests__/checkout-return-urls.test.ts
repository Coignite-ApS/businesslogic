/**
 * Task 51 — Checkout return URL unit tests
 *
 * Verifies that buildCheckoutReturnUrls produces the correct success/cancel
 * URLs for each source context, and that wallet-topup URLs are correct.
 */

import { describe, it, expect } from 'vitest';
import { buildCheckoutReturnUrls, resolveCheckoutSource } from '../src/index.js';
import { buildWalletTopupReturnUrls } from '../src/wallet-handlers.js';

const BASE = 'https://app.example.com';

describe('buildCheckoutReturnUrls', () => {
	it('onboarding source → wizard return URLs', () => {
		const urls = buildCheckoutReturnUrls(BASE, 'calculators', 'onboarding');
		expect(urls.success_url).toBe(`${BASE}/admin/account/onboarding?success=true&module=calculators`);
		expect(urls.cancel_url).toBe(`${BASE}/admin/account/onboarding?cancelled=true&module=calculators`);
	});

	it('subscription source → subscription page URLs', () => {
		const urls = buildCheckoutReturnUrls(BASE, 'kb', 'subscription');
		expect(urls.success_url).toBe(`${BASE}/admin/account/subscription?activated=kb`);
		expect(urls.cancel_url).toBe(`${BASE}/admin/account/subscription?cancelled=kb`);
	});

	it('flows module — subscription source', () => {
		const urls = buildCheckoutReturnUrls(BASE, 'flows', 'subscription');
		expect(urls.success_url).toBe(`${BASE}/admin/account/subscription?activated=flows`);
		expect(urls.cancel_url).toBe(`${BASE}/admin/account/subscription?cancelled=flows`);
	});

	it('no /admin/content/ in any URL', () => {
		for (const source of ['onboarding', 'subscription'] as const) {
			for (const mod of ['calculators', 'kb', 'flows']) {
				const urls = buildCheckoutReturnUrls(BASE, mod, source);
				expect(urls.success_url).not.toContain('/admin/content/');
				expect(urls.cancel_url).not.toContain('/admin/content/');
			}
		}
	});
});

describe('resolveCheckoutSource', () => {
	it('absent source defaults to subscription', () => {
		expect(resolveCheckoutSource(undefined)).toBe('subscription');
		expect(resolveCheckoutSource(null)).toBe('subscription');
		expect(resolveCheckoutSource('')).toBe('subscription');
	});

	it('valid sources pass through', () => {
		expect(resolveCheckoutSource('onboarding')).toBe('onboarding');
		expect(resolveCheckoutSource('subscription')).toBe('subscription');
	});

	it('invalid source returns 400 error object', () => {
		const result = resolveCheckoutSource('unknown');
		expect(result).toMatchObject({ status: 400 });
		expect((result as any).error).toContain('source must be one of');
	});

	it('typo source (subscriptoin) returns 400', () => {
		const result = resolveCheckoutSource('subscriptoin');
		expect(result).toMatchObject({ status: 400 });
	});
});

describe('buildWalletTopupReturnUrls', () => {
	it('standard amount → correct success/cancel shape', () => {
		const urls = buildWalletTopupReturnUrls(BASE, 20);
		expect(urls.success_url).toBe(`${BASE}/admin/account/subscription?topup=success&amount=20.00`);
		expect(urls.cancel_url).toBe(`${BASE}/admin/account/subscription?topup=cancelled`);
	});

	it('rounding: integer amount formats to 2dp', () => {
		const urls = buildWalletTopupReturnUrls(BASE, 50);
		expect(urls.success_url).toBe(`${BASE}/admin/account/subscription?topup=success&amount=50.00`);
	});

	it('rounding: fractional amount rounded via toFixed(2)', () => {
		// 49.995 → toFixed(2) → "50.00" in most JS engines
		const urls = buildWalletTopupReturnUrls(BASE, 49.995);
		expect(urls.success_url).toMatch(/amount=49\.99|amount=50\.00/); // toFixed rounding is engine-defined
		expect(urls.cancel_url).toBe(`${BASE}/admin/account/subscription?topup=cancelled`);
	});

	it('no /admin/content/ in wallet URLs', () => {
		const urls = buildWalletTopupReturnUrls(BASE, 20);
		expect(urls.success_url).not.toContain('/admin/content/');
		expect(urls.cancel_url).not.toContain('/admin/content/');
	});
});
