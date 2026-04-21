import { mount } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import WalletSettingsDialog from '../src/components/wallet-settings-dialog.vue';

const defaultConfig = {
	auto_reload_enabled: true,
	auto_reload_threshold_eur: 5,
	auto_reload_amount_eur: 20,
	monthly_cap_eur: null,
};

const globalStubs = {
	VDialog: { template: '<div><slot /></div>' },
	VCard: { template: '<div role="dialog" aria-modal="true"><slot /></div>' },
	VCardTitle: { template: '<h2><slot /></h2>' },
	VCardText: { template: '<div><slot /></div>' },
	VCardActions: { template: '<div><slot /></div>' },
	VCheckbox: { template: '<input type="checkbox" :id="$attrs.id" />', inheritAttrs: true },
	VButton: { template: '<button><slot /></button>' },
	VNotice: { template: '<div role="alert"><slot /></div>' },
};

describe('wallet-settings-dialog a11y', () => {
	function mountDialog(configOverrides = {}) {
		return mount(WalletSettingsDialog, {
			props: {
				modelValue: true,
				initialConfig: { ...defaultConfig, ...configOverrides },
				saving: false,
				saveError: null,
			},
			global: { stubs: globalStubs },
		});
	}

	it('threshold input has associated label via for/id', () => {
		const wrapper = mountDialog();
		const input = wrapper.find('#wallet-threshold');
		const label = wrapper.find('label[for="wallet-threshold"]');
		expect(input.exists()).toBe(true);
		expect(label.exists()).toBe(true);
	});

	it('top-up amount input has associated label via for/id', () => {
		const wrapper = mountDialog();
		const input = wrapper.find('#wallet-amount');
		const label = wrapper.find('label[for="wallet-amount"]');
		expect(input.exists()).toBe(true);
		expect(label.exists()).toBe(true);
	});

	it('monthly cap input has associated label via for/id', () => {
		const wrapper = mountDialog();
		const input = wrapper.find('#wallet-cap');
		const label = wrapper.find('label[for="wallet-cap"]');
		expect(input.exists()).toBe(true);
		expect(label.exists()).toBe(true);
	});

	it('monthly cap input is described by hint text', () => {
		const wrapper = mountDialog();
		const input = wrapper.find('#wallet-cap');
		const hint = wrapper.find('#wallet-cap-hint');
		expect(input.attributes('aria-describedby')).toBe('wallet-cap-hint');
		expect(hint.exists()).toBe(true);
	});

	it('auto-top-up label has for pointing to checkbox id', () => {
		const wrapper = mountDialog();
		const label = wrapper.find('label[for="wallet-autotopup"]');
		expect(label.exists()).toBe(true);
		expect(label.attributes('id')).toBe('wallet-autotopup-label');
	});

	it('quick-amount buttons have aria-pressed reflecting selected state', () => {
		const wrapper = mountDialog({ auto_reload_amount_eur: 50 });
		const buttons = wrapper.findAll('.quick-btn');
		expect(buttons).toHaveLength(3);

		const pressed = buttons.filter((b) => b.attributes('aria-pressed') === 'true');
		const unpressed = buttons.filter((b) => b.attributes('aria-pressed') === 'false');

		expect(pressed).toHaveLength(1);
		expect(pressed[0]!.text()).toContain('50');
		expect(unpressed).toHaveLength(2);
	});

	it('quick-amounts group has accessible label', () => {
		const wrapper = mountDialog();
		const group = wrapper.find('[role="group"]');
		expect(group.exists()).toBe(true);
		expect(group.attributes('aria-label')).toBeTruthy();
	});

	it('dialog title has id for aria-labelledby', () => {
		const wrapper = mountDialog();
		const title = wrapper.find('#wallet-dialog-title');
		expect(title.exists()).toBe(true);
		expect(title.text()).toContain('Wallet Auto-Reload Settings');
	});

	it('threshold error uses role=alert when visible', async () => {
		const wrapper = mountDialog({ auto_reload_threshold_eur: -1 });
		// Force threshold to invalid value
		const input = wrapper.find('#wallet-threshold');
		await input.setValue('-1');
		await input.trigger('input');

		const errors = wrapper.findAll('[role="alert"]');
		expect(errors.length).toBeGreaterThan(0);
	});

	it('currency prefix spans are aria-hidden', () => {
		const wrapper = mountDialog();
		const prefixes = wrapper.findAll('.currency-prefix');
		prefixes.forEach((prefix) => {
			expect(prefix.attributes('aria-hidden')).toBe('true');
		});
	});
});
