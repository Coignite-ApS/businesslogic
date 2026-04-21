/**
 * Task 58.12 — welcome-wizard intent-tile aria-pressed a11y test.
 *
 * Verifies that the 2+ tile buttons in the onboarding picker carry correct
 * aria-pressed state so screen readers can announce selection.
 */

import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks (must be hoisted before component import) ────────────────────

vi.mock('vue-router', () => ({
	useRouter: () => ({ push: vi.fn() }),
	useRoute: () => ({ query: {} }),
}));

vi.mock('@directus/extensions-sdk', () => ({
	useApi: () => ({}),
}));

vi.mock('../src/composables/use-account', () => ({
	useAccount: () => ({
		plans: { value: [] },
		fetchPlans: vi.fn(),
		startCheckout: vi.fn(),
	}),
}));

vi.mock('../src/composables/use-onboarding', () => ({
	useOnboarding: () => ({
		captureIntent: vi.fn(),
		markActivated: vi.fn(),
		markCompleted: vi.fn(),
		error: { value: null },
	}),
}));

// ── Import component AFTER mocks are registered ────────────────────────────────
import WelcomeWizard from '../src/components/welcome-wizard.vue';

const globalStubs = {
	VButton: { template: '<button v-bind="$attrs"><slot /></button>' },
	VIcon: { template: '<span />' },
	VNotice: { template: '<div role="alert"><slot /></div>' },
};

describe('welcome-wizard a11y — intent tile aria-pressed (task 58.12)', () => {
	function mountWizard() {
		return mount(WelcomeWizard, {
			props: {
				initialIntent: null,
				successModule: null,
				cancelledModule: null,
			},
			global: { stubs: globalStubs },
		});
	}

	it('all intent-tile buttons render with aria-pressed="false" initially', () => {
		const wrapper = mountWizard();
		const tiles = wrapper.findAll('button.intent-tile');
		// There should be at least 2 tiles
		expect(tiles.length).toBeGreaterThanOrEqual(2);
		for (const tile of tiles) {
			// Before any selection aria-pressed must be false (not undefined/missing)
			expect(tile.attributes('aria-pressed')).toBe('false');
		}
	});

	it('clicking a tile sets aria-pressed="true" on that tile and false on others', async () => {
		const wrapper = mountWizard();
		const tiles = wrapper.findAll('button.intent-tile');
		expect(tiles.length).toBeGreaterThanOrEqual(2);

		await tiles[0].trigger('click');

		const updatedTiles = wrapper.findAll('button.intent-tile');
		expect(updatedTiles[0].attributes('aria-pressed')).toBe('true');
		for (let i = 1; i < updatedTiles.length; i++) {
			expect(updatedTiles[i].attributes('aria-pressed')).toBe('false');
		}
	});

	it('switching selection moves aria-pressed to the new tile', async () => {
		const wrapper = mountWizard();
		const tiles = wrapper.findAll('button.intent-tile');
		expect(tiles.length).toBeGreaterThanOrEqual(2);

		await tiles[0].trigger('click');
		await tiles[1].trigger('click');

		const updatedTiles = wrapper.findAll('button.intent-tile');
		expect(updatedTiles[0].attributes('aria-pressed')).toBe('false');
		expect(updatedTiles[1].attributes('aria-pressed')).toBe('true');
	});

	it('intent-grid container has role=group with aria-label', () => {
		const wrapper = mountWizard();
		const grid = wrapper.find('.intent-grid');
		expect(grid.exists()).toBe(true);
		expect(grid.attributes('role')).toBe('group');
		expect(grid.attributes('aria-label')).toBeTruthy();
	});
});
