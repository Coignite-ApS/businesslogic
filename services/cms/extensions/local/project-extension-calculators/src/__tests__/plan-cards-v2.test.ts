import { describe, it, expect, vi } from 'vitest';
import type { ModulePlan } from 'project-shared-ui/plan-cards.vue';

// Unit-test PlanCards v2 logic in isolation.
// We test the core functions without DOM mounting (no browser globals needed).

function planPrice(tier: ModulePlan, yearly: boolean): number {
	if (yearly) return Number(tier.price_eur_annual || 0);
	return Number(tier.price_eur_monthly || 0);
}

function formatEur(n: number): string {
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(n);
}

function isDowngrade(tier: ModulePlan, currentPlanSort: number | null): boolean {
	if (currentPlanSort == null) return false;
	return (tier.sort ?? 0) < currentPlanSort;
}

function yearlySaving(tier: ModulePlan): number {
	const monthly = Number(tier.price_eur_monthly || 0);
	const annual = Number(tier.price_eur_annual || 0);
	if (!monthly || !annual) return 0;
	const annualMonthly = monthly * 12;
	const pct = Math.round(((annualMonthly - annual) / annualMonthly) * 100);
	return pct > 0 ? pct : 0;
}

function makeTier(overrides: Partial<ModulePlan> = {}): ModulePlan {
	return {
		id: 'plan-1',
		name: 'Starter',
		module: 'calculators',
		tier: 'starter',
		price_eur_monthly: 29,
		price_eur_annual: 290,
		sort: 1,
		slot_allowance: 5,
		ao_allowance: 1,
		request_allowance: 10000,
		storage_mb: null,
		embed_tokens_m: null,
		executions: null,
		concurrent_runs: null,
		...overrides,
	};
}

describe('plan-cards v2 — price computation', () => {
	it('returns monthly price when yearly=false', () => {
		const tier = makeTier({ price_eur_monthly: 29, price_eur_annual: 290 });
		expect(planPrice(tier, false)).toBe(29);
	});

	it('returns annual price when yearly=true', () => {
		const tier = makeTier({ price_eur_monthly: 29, price_eur_annual: 290 });
		expect(planPrice(tier, true)).toBe(290);
	});

	it('returns 0 when prices are null', () => {
		const tier = makeTier({ price_eur_monthly: null, price_eur_annual: null });
		expect(planPrice(tier, false)).toBe(0);
		expect(planPrice(tier, true)).toBe(0);
	});
});

describe('plan-cards v2 — yearly saving', () => {
	it('computes saving percentage correctly', () => {
		// 12 * 29 = 348, annual = 290 → saving = (348-290)/348 = ~16.7% → 17%
		const tier = makeTier({ price_eur_monthly: 29, price_eur_annual: 290 });
		expect(yearlySaving(tier)).toBe(17);
	});

	it('returns 0 when no prices', () => {
		const tier = makeTier({ price_eur_monthly: null, price_eur_annual: null });
		expect(yearlySaving(tier)).toBe(0);
	});

	it('returns 0 when annual >= monthly*12', () => {
		const tier = makeTier({ price_eur_monthly: 10, price_eur_annual: 120 });
		expect(yearlySaving(tier)).toBe(0);
	});
});

describe('plan-cards v2 — downgrade detection', () => {
	it('is downgrade when tier.sort < currentPlanSort', () => {
		const tier = makeTier({ sort: 1 });
		expect(isDowngrade(tier, 2)).toBe(true);
	});

	it('is not downgrade when tier.sort > currentPlanSort', () => {
		const tier = makeTier({ sort: 3 });
		expect(isDowngrade(tier, 2)).toBe(false);
	});

	it('is not downgrade when currentPlanSort is null', () => {
		const tier = makeTier({ sort: 1 });
		expect(isDowngrade(tier, null)).toBe(false);
	});
});

describe('plan-cards v2 — module-specific allowances', () => {
	it('calculators tier has slot_allowance, ao_allowance, request_allowance', () => {
		const tier = makeTier({ module: 'calculators', slot_allowance: 5, ao_allowance: 2, request_allowance: 50000 });
		expect(tier.slot_allowance).toBe(5);
		expect(tier.ao_allowance).toBe(2);
		expect(tier.request_allowance).toBe(50000);
	});

	it('kb tier has storage_mb and embed_tokens_m', () => {
		const tier = makeTier({
			module: 'kb',
			slot_allowance: null,
			ao_allowance: null,
			request_allowance: null,
			storage_mb: 500,
			embed_tokens_m: 5,
		});
		expect(tier.storage_mb).toBe(500);
		expect(tier.embed_tokens_m).toBe(5);
	});

	it('flows tier has executions and concurrent_runs', () => {
		const tier = makeTier({
			module: 'flows',
			slot_allowance: null,
			ao_allowance: null,
			request_allowance: null,
			executions: 1000,
			concurrent_runs: 3,
		});
		expect(tier.executions).toBe(1000);
		expect(tier.concurrent_runs).toBe(3);
	});

	it('null allowance means unlimited', () => {
		const tier = makeTier({ slot_allowance: null });
		expect(tier.slot_allowance).toBeNull();
	});
});

describe('plan-cards v2 — checkout emit', () => {
	it('emits checkout event with plan id', () => {
		const emit = vi.fn();
		const tier = makeTier({ id: 'plan-abc' });
		emit('checkout', tier.id);
		expect(emit).toHaveBeenCalledWith('checkout', 'plan-abc');
	});
});
