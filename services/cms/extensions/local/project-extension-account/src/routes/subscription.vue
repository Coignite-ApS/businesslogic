<template>
	<private-view title="Subscription">
		<template #headline>
			<v-breadcrumb :items="[{ name: 'Account', to: '/account' }, { name: 'Subscription', to: '/account/subscription' }]" />
		</template>
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="credit_card" />
			</v-button>
		</template>

		<template #navigation>
			<account-navigation />
		</template>

		<div class="module-content" v-if="activeAccountId">
			<p v-if="isTrialing && trialDaysLeft > 0" class="trial-note">
				Trial: {{ trialDaysLeft }} day{{ trialDaysLeft !== 1 ? 's' : '' }} remaining (earliest)
			</p>

			<subscription-info
				:subscriptions-by-module="subscriptionsByModule"
				:wallet="wallet"
				:monthly-total-eur="monthlyTotalEur"
				@topup="handleTopup"
				@activate="handleActivate"
			/>

			<!-- Module activation dialog: show available tiers for the chosen module. -->
			<v-dialog v-model="activationVisible" @esc="activationVisible = false">
				<v-card class="activation-card">
					<v-card-title>Activate {{ activationModuleLabel }}</v-card-title>
					<v-card-text>
						<div v-if="!plans.length" class="loading-state">
							<v-progress-circular indeterminate />
						</div>
						<div v-else class="tier-grid">
							<div
								v-for="plan in modulePlans"
								:key="plan.id"
								class="tier-option"
							>
								<div class="tier-header">
									<span class="tier-name">{{ plan.name }}</span>
									<span class="tier-price">
										{{ formatEur(plan.price_eur_monthly) }}<span class="tier-period">/mo</span>
									</span>
								</div>
								<div class="tier-allowances">
									{{ tierAllowanceLine(plan) }}
								</div>
								<div class="tier-actions">
									<v-button
										small
										:loading="checkingOut === plan.id + '-monthly'"
										@click="handleCheckout(plan, 'monthly')"
									>Activate Monthly</v-button>
									<v-button
										small
										secondary
										:loading="checkingOut === plan.id + '-annual'"
										:disabled="!plan.price_eur_annual"
										@click="handleCheckout(plan, 'annual')"
									>
										Annual {{ plan.price_eur_annual ? '(' + savingPct(plan) + '% off)' : '' }}
									</v-button>
								</div>
							</div>
						</div>
					</v-card-text>
					<v-card-actions>
						<v-button secondary @click="activationVisible = false">Close</v-button>
					</v-card-actions>
				</v-card>
			</v-dialog>

			<div v-if="hasStripeCustomer" class="billing-section">
				<v-button secondary @click="handlePortal">
					<v-icon name="receipt_long" left />
					Manage Billing
				</v-button>
			</div>

			<v-notice v-if="error" type="danger" class="error-notice">{{ error }}</v-notice>
		</div>

		<div v-else class="module-empty">
			<v-info icon="account_circle" title="No Account" center>
				No active account selected.
			</v-info>
		</div>

		<template #sidebar>
			<sidebar-detail id="account" icon="people" title="Account">
				<account-selector
					:model-value="activeAccountId"
					:accounts="accounts"
					:disabled="loading"
					@update:model-value="handleAccountChange"
				/>
			</sidebar-detail>
			<sidebar-detail id="info" icon="info" title="Subscription Help">
				<div class="sidebar-help">
					Each module is billed independently. Top up your AI Wallet to fund AI assistant and KB Q&A usage.
				</div>
			</sidebar-detail>
		</template>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { useAccount } from '../composables/use-account';
import type { Module, SubscriptionPlan } from '../types';
import AccountNavigation from '../components/account-navigation.vue';
import AccountSelector from '../components/account-selector.vue';
import SubscriptionInfo from '../components/subscription-info.vue';

const api = useApi();
const {
	accounts, activeAccountId, subscriptionsByModule, wallet, monthlyTotalEur,
	plans, loading, error,
	isTrialing, trialDaysLeft, activeSubscriptions,
	fetchAccounts, setActiveAccount, fetchSubscription, fetchWallet, fetchPlans,
	startCheckout, startWalletTopup, openPortal,
} = useAccount(api);

const checkingOut = ref<string | null>(null);
const activationVisible = ref(false);
const activationModule = ref<Module | null>(null);

const MODULE_LABELS: Record<Module, string> = {
	calculators: 'Calculators',
	kb: 'Knowledge Base',
	flows: 'Flows',
};

const activationModuleLabel = computed(() =>
	activationModule.value ? MODULE_LABELS[activationModule.value] : '',
);

// Filtered plans for the active module, sorted by tier price.
const modulePlans = computed(() => {
	if (!activationModule.value) return [];
	return plans.value
		.filter((p) => p.module === activationModule.value && p.tier !== 'enterprise')
		.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
});

const hasStripeCustomer = computed(() =>
	activeSubscriptions.value.some((s) => !!s.stripe_customer_id),
);

function formatEur(n: number | string | null | undefined): string {
	const v = Number(n || 0);
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(v);
}

function savingPct(plan: SubscriptionPlan): number {
	const m = Number(plan.price_eur_monthly || 0);
	const a = Number(plan.price_eur_annual || 0);
	if (!m || !a) return 0;
	const annualMonthly = m * 12;
	const pct = Math.round(((annualMonthly - a) / annualMonthly) * 100);
	return pct > 0 ? pct : 0;
}

function tierAllowanceLine(plan: SubscriptionPlan): string {
	const parts: string[] = [];
	if (plan.module === 'calculators') {
		if (plan.slot_allowance != null) parts.push(`${plan.slot_allowance} slots`);
		if (plan.ao_allowance != null) parts.push(`${plan.ao_allowance} always-on`);
		if (plan.request_allowance != null) parts.push(`${plan.request_allowance.toLocaleString()} req/mo`);
	} else if (plan.module === 'kb') {
		if (plan.storage_mb != null) parts.push(`${plan.storage_mb.toLocaleString()} MB storage`);
		if (plan.embed_tokens_m != null) parts.push(`${plan.embed_tokens_m}M embed tokens`);
	} else if (plan.module === 'flows') {
		if (plan.executions != null) parts.push(`${plan.executions.toLocaleString()} executions/mo`);
		if (plan.max_steps != null) parts.push(`${plan.max_steps} max steps`);
	}
	return parts.join(' · ') || 'Standard tier';
}

async function handleActivate(mod: Module) {
	activationModule.value = mod;
	activationVisible.value = true;
	if (!plans.value.length) {
		await fetchPlans();
	}
}

async function handleCheckout(plan: SubscriptionPlan, cycle: 'monthly' | 'annual') {
	checkingOut.value = `${plan.id}-${cycle}`;
	await startCheckout({ module: plan.module, tier: plan.tier, billing_cycle: cycle });
	checkingOut.value = null;
}

async function handleTopup() {
	// Default top-up = €20 (cheapest standard amount). Power users can change
	// via the Stripe billing portal or wallet config endpoint.
	await startWalletTopup(20);
}

async function handlePortal() {
	await openPortal();
}

async function handleAccountChange(id: string) {
	await setActiveAccount(id);
}

watch(activeAccountId, () => {
	fetchSubscription();
	fetchWallet();
});

onMounted(async () => {
	await fetchAccounts();
	await Promise.all([fetchSubscription(), fetchWallet(), fetchPlans()]);
});
</script>

<style scoped>
.header-icon {
	--v-button-background-color-disabled: var(--theme--primary-background);
	--v-button-color-disabled: var(--theme--primary);
}

.module-content {
	padding: var(--content-padding);
	padding-bottom: var(--content-padding-bottom);
	max-width: 720px;
}

.module-empty {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 400px;
}

.trial-note {
	font-size: 14px;
	color: var(--theme--foreground-subdued);
	margin-bottom: 16px;
}

.billing-section {
	margin-top: 16px;
}

.error-notice {
	margin-top: 16px;
}

.sidebar-help {
	padding: 12px;
	font-size: 13px;
	line-height: 1.5;
	color: var(--theme--foreground-subdued);
}

.activation-card {
	min-width: 480px;
	max-width: 640px;
}

.tier-grid {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.tier-option {
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	padding: 14px;
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.tier-header {
	display: flex;
	justify-content: space-between;
	align-items: baseline;
}

.tier-name {
	font-size: 16px;
	font-weight: 700;
}

.tier-price {
	font-size: 18px;
	font-weight: 700;
}

.tier-period {
	font-size: 12px;
	font-weight: 400;
	color: var(--theme--foreground-subdued);
}

.tier-allowances {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.tier-actions {
	display: flex;
	gap: 8px;
}

.loading-state {
	display: flex;
	justify-content: center;
	padding: 32px;
}
</style>
