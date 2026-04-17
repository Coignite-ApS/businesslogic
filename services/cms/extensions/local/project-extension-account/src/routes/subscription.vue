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
				Trial: {{ trialDaysLeft }} day{{ trialDaysLeft !== 1 ? 's' : '' }} remaining
			</p>

			<plan-cards
				v-if="plans.length"
				:plans="plans"
				:current-plan-id="currentPlanId"
				:current-plan-sort="currentPlanSort"
				:checking-out="checkingOut"
				:error="error"
				@checkout="handleCheckout"
			/>

			<div v-if="subscription?.stripe_customer_id" class="billing-section">
				<v-button secondary @click="handlePortal">
					<v-icon name="receipt_long" left />
					Manage Billing
				</v-button>
			</div>
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
			<sidebar-detail id="info" icon="info" title="Subscription">
				<subscription-info :subscription="subscription" />
			</sidebar-detail>
		</template>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { useAccount } from '../composables/use-account';
import AccountNavigation from '../components/account-navigation.vue';
import AccountSelector from '../components/account-selector.vue';
import SubscriptionInfo from '../components/subscription-info.vue';
import PlanCards from 'project-shared-ui/plan-cards.vue';

const api = useApi();
const {
	accounts, activeAccountId, subscription, plans,
	loading, error, exempt,
	isTrialing, trialDaysLeft,
	fetchAccounts, setActiveAccount, fetchSubscription, fetchPlans,
	startCheckout, openPortal,
} = useAccount(api);

const checkingOut = ref<string | null>(null);

const currentPlanId = computed(() => {
	const plan = subscription.value?.plan;
	return typeof plan === 'object' ? plan?.id : plan;
});

const currentPlanSort = computed(() => {
	const plan = subscription.value?.plan;
	return typeof plan === 'object' ? plan?.sort ?? 0 : 0;
});

async function handleCheckout(planId: string) {
	checkingOut.value = planId;
	await startCheckout(planId);
	checkingOut.value = null;
}

async function handlePortal() {
	await openPortal();
}

async function handleAccountChange(id: string) {
	await setActiveAccount(id);
}

watch(activeAccountId, () => {
	fetchSubscription();
});

onMounted(async () => {
	await fetchAccounts();
	await Promise.all([fetchSubscription(), fetchPlans()]);
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
	max-width: 900px;
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
	margin-bottom: 24px;
}

.billing-section {
	margin-top: 8px;
}
</style>
