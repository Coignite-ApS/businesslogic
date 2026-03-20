<template>
	<div v-if="subscription" class="subscription-info">
		<div class="info-row">
			<span class="info-label">Plan</span>
			<span class="info-value">{{ planName }}</span>
		</div>
		<div class="info-row">
			<span class="info-label">Status</span>
			<v-chip small :class="statusClass">{{ statusLabel }}</v-chip>
		</div>
		<div v-if="subscription.plan?.calculator_limit" class="info-row">
			<span class="info-label">Calculator Limit</span>
			<span class="info-value">{{ subscription.plan.calculator_limit }}</span>
		</div>
		<div v-if="subscription.plan?.calls_per_month" class="info-row">
			<span class="info-label">Calls / Month</span>
			<span class="info-value">{{ subscription.plan.calls_per_month.toLocaleString() }}</span>
		</div>
		<div v-if="subscription.plan?.calls_per_second" class="info-row">
			<span class="info-label">Calls / Second</span>
			<span class="info-value">{{ subscription.plan.calls_per_second }}</span>
		</div>
	</div>
	<div v-else class="subscription-info">
		<v-info icon="credit_card" title="No Subscription">
			No active subscription for this account.
		</v-info>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Subscription } from '../types';

const props = defineProps<{
	subscription: Subscription | null;
}>();

const planName = computed(() => {
	const plan = props.subscription?.plan;
	return typeof plan === 'object' ? plan?.name : 'Unknown';
});

const statusLabel = computed(() => {
	const s = props.subscription?.status;
	if (s === 'trialing') return 'Trial';
	if (s === 'active') return 'Active';
	if (s === 'past_due') return 'Past Due';
	if (s === 'canceled') return 'Canceled';
	if (s === 'expired') return 'Expired';
	return s || 'Unknown';
});

const statusClass = computed(() => {
	const s = props.subscription?.status;
	if (s === 'active') return 'chip-active';
	if (s === 'trialing') return 'chip-trial';
	if (s === 'past_due' || s === 'expired' || s === 'canceled') return 'chip-danger';
	return '';
});
</script>

<style scoped>
.subscription-info {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.info-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
}

.info-label {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
}

.info-value {
	font-size: 14px;
	font-weight: 600;
}

.chip-active {
	--v-chip-background-color: var(--theme--success-background, rgba(46, 205, 167, 0.1));
	--v-chip-color: var(--theme--success);
}

.chip-trial {
	--v-chip-background-color: var(--theme--warning-background);
	--v-chip-color: var(--theme--warning);
}

.chip-danger {
	--v-chip-background-color: var(--theme--danger-background);
	--v-chip-color: var(--theme--danger);
}
</style>
