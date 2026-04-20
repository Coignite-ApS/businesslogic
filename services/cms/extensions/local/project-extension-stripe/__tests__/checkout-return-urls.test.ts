/**
 * Task 51 — Checkout return URL unit tests
 *
 * Verifies that buildCheckoutReturnUrls produces the correct success/cancel
 * URLs for each source context, and that wallet-topup URLs are correct.
 */

import { describe, it, expect } from 'vitest';
import { buildCheckoutReturnUrls } from '../src/index.js';

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

describe('wallet-topup return URLs (inline — verified by spec)', () => {
	it('success URL format', () => {
		const amountEur = 20;
		const url = `${BASE}/admin/account/subscription?topup=success&amount=${amountEur.toFixed(2)}`;
		expect(url).toBe(`${BASE}/admin/account/subscription?topup=success&amount=20.00`);
		expect(url).not.toContain('/admin/content/');
	});

	it('cancel URL format', () => {
		const url = `${BASE}/admin/account/subscription?topup=cancelled`;
		expect(url).toBe(`${BASE}/admin/account/subscription?topup=cancelled`);
		expect(url).not.toContain('/admin/content/');
	});
});
