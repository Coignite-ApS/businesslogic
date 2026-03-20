<template>
	<div class="plan-cards-root">
		<div class="billing-toggle" v-if="hasAnyPrice">
			<span :class="{ active: !yearly }" @click="yearly = false">Monthly</span>
			<span :class="{ active: yearly }" @click="yearly = true">Yearly{{ maxYearlySaving ? ` (Save ${maxYearlySaving}%)` : '' }}</span>
		</div>

		<div class="plans-grid">
			<div
				v-for="plan in plans"
				:key="plan.id"
				class="plan-card"
				:class="{ current: isCurrentPlan(plan.id) }"
			>
				<div class="plan-name">{{ plan.name }}</div>
				<div class="plan-price" v-if="planPrice(plan)">
					{{ formatPrice(yearly ? Math.round(planPrice(plan) / 12) : planPrice(plan)) }}<span class="price-period">/mo</span>
					<span class="plan-billed">{{ yearly && planPrice(plan) ? `Billed ${formatPrice(planPrice(plan))}/yr` : '\u00A0' }}</span>
				</div>
				<div class="plan-details">
					<div class="plan-detail">
						<v-icon name="calculate" small />
						<span v-if="plan.calculator_limit">{{ plan.calculator_limit }} calculators</span>
						<span v-else>Unlimited calculators</span>
					</div>
					<div class="plan-detail">
						<v-icon name="trending_up" small />
						<span v-if="plan.calls_per_month">{{ plan.calls_per_month.toLocaleString() }} calls/mo</span>
						<span v-else>Unlimited calls</span>
					</div>
					<div class="plan-detail" v-if="plan.calls_per_second">
						<v-icon name="speed" small />
						<span>{{ plan.calls_per_second }} calls/sec</span>
					</div>
				</div>
				<div class="plan-action">
					<v-button v-if="isCurrentPlan(plan.id)" class="current-plan-btn" disabled full-width>
						Current Plan
					</v-button>
					<v-button
						v-else
						:secondary="isDowngrade(plan)"
						full-width
						:loading="checkingOut === plan.id"
						@click="$emit('checkout', plan.id)"
					>
						{{ isDowngrade(plan) ? 'Downgrade' : 'Upgrade' }}
					</v-button>
				</div>
			</div>
		</div>

		<div v-if="error" class="error-msg">{{ error }}</div>
	</div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

export interface PlanInfo {
	id: string;
	name: string;
	calculator_limit: number | null;
	calls_per_month: number | null;
	calls_per_second: number | null;
	monthly_price?: number | null;
	yearly_price?: number | null;
	sort: number | null;
}

const props = defineProps<{
	plans: PlanInfo[];
	currentPlanId: string | null;
	currentPlanSort: number | null;
	checkingOut: string | null;
	error: string | null;
}>();

defineEmits<{
	checkout: [planId: string];
}>();

const yearly = ref(false);

const hasAnyPrice = computed(() => props.plans.some((p) => p.monthly_price || p.yearly_price));

function planPrice(plan: PlanInfo): number {
	return (yearly.value ? plan.yearly_price : plan.monthly_price) || 0;
}

function formatPrice(cents: number): string {
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function isCurrentPlan(planId: string): boolean {
	return props.currentPlanId === planId;
}

function yearlySaving(plan: PlanInfo): number {
	const monthly = plan.monthly_price || 0;
	const yearlyPrice = plan.yearly_price || 0;
	if (!monthly || !yearlyPrice) return 0;
	const annualMonthly = monthly * 12;
	const pct = Math.round(((annualMonthly - yearlyPrice) / annualMonthly) * 100);
	return pct > 0 ? pct : 0;
}

const maxYearlySaving = computed(() => {
	let max = 0;
	for (const p of props.plans) {
		const s = yearlySaving(p);
		if (s > max) max = s;
	}
	return max;
});

function isDowngrade(plan: PlanInfo): boolean {
	if (props.currentPlanSort == null) return false;
	return (plan.sort ?? 0) < props.currentPlanSort;
}
</script>

<style scoped>
.billing-toggle {
	display: inline-flex;
	gap: 0;
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	overflow: hidden;
	margin-bottom: 16px;
}

.billing-toggle span {
	padding: 6px 16px;
	font-size: 13px;
	font-weight: 600;
	cursor: pointer;
	color: var(--theme--foreground-subdued);
	transition: all 0.15s;
}

.billing-toggle span.active {
	background: var(--theme--primary);
	color: white;
}

.plans-grid {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 16px;
}

.plan-card {
	padding: 20px;
	border: 2px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.plan-card.current {
	border-color: var(--theme--primary);
	background: var(--theme--primary-background);
}

.plan-name {
	font-size: 18px;
	font-weight: 700;
}

.plan-price {
	font-size: 24px;
	font-weight: 700;
}

.price-period {
	font-size: 13px;
	font-weight: 400;
	color: var(--theme--foreground-subdued);
}

.plan-billed {
	display: block;
	font-size: 12px;
	font-weight: 400;
	color: var(--theme--foreground-subdued);
	margin-top: 2px;
}

.plan-details {
	display: flex;
	flex-direction: column;
	gap: 6px;
	flex: 1;
}

.plan-detail {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 13px;
	color: var(--theme--foreground);
}

.plan-action {
	margin-top: auto;
	padding-top: 4px;
}

.current-plan-btn {
	--v-button-background-color-disabled: #fff;
	--v-button-color-disabled: var(--theme--foreground-subdued);
	--v-button-border-color-disabled: var(--theme--border-color);
}

.error-msg {
	margin-top: 12px;
	color: var(--theme--danger);
	font-size: 14px;
}
</style>
