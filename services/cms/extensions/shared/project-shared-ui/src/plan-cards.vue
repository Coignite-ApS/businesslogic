<template>
	<div class="plan-cards-root">
		<div class="billing-toggle" v-if="hasAnyPrice">
			<span :class="{ active: !yearly }" @click="yearly = false">Monthly</span>
			<span :class="{ active: yearly }" @click="yearly = true">Yearly{{ maxYearlySaving ? ` (Save ${maxYearlySaving}%)` : '' }}</span>
		</div>

		<div class="plans-grid">
			<div
				v-for="tier in tiers"
				:key="tier.id"
				class="plan-card"
				:class="{ current: isCurrentPlan(tier.id) }"
			>
				<div class="plan-name">{{ tier.name }}</div>
				<div class="plan-price" v-if="planPrice(tier)">
					{{ formatEur(yearly ? Math.round(planPrice(tier) / 12 * 100) / 100 : planPrice(tier)) }}<span class="price-period">/mo</span>
					<span class="plan-billed">{{ yearly && planPrice(tier) ? `Billed ${formatEur(planPrice(tier))}/yr` : '\u00A0' }}</span>
				</div>

				<div class="plan-details">
					<!-- Calculators allowances -->
					<template v-if="module === 'calculators'">
						<div class="plan-detail">
							<v-icon name="calculate" small />
							<span>{{ tier.slot_allowance != null ? `${tier.slot_allowance} slots` : 'Unlimited slots' }}</span>
						</div>
						<div class="plan-detail">
							<v-icon name="bolt" small />
							<span>{{ tier.ao_allowance != null ? `${tier.ao_allowance} always-on` : 'Unlimited always-on' }}</span>
						</div>
						<div class="plan-detail">
							<v-icon name="trending_up" small />
							<span>{{ tier.request_allowance != null ? `${tier.request_allowance.toLocaleString()} req/mo` : 'Unlimited requests' }}</span>
						</div>
					</template>

					<!-- KB allowances -->
					<template v-else-if="module === 'kb'">
						<div class="plan-detail">
							<v-icon name="storage" small />
							<span>{{ tier.storage_mb != null ? `${tier.storage_mb.toLocaleString()} MB storage` : 'Unlimited storage' }}</span>
						</div>
						<div class="plan-detail">
							<v-icon name="psychology" small />
							<span>{{ tier.embed_tokens_m != null ? `${tier.embed_tokens_m}M embed tokens/mo` : 'Unlimited embed tokens' }}</span>
						</div>
					</template>

					<!-- Flows allowances -->
					<template v-else-if="module === 'flows'">
						<div class="plan-detail">
							<v-icon name="account_tree" small />
							<span>{{ tier.executions != null ? `${tier.executions.toLocaleString()} executions/mo` : 'Unlimited executions' }}</span>
						</div>
						<div class="plan-detail">
							<v-icon name="fork_right" small />
							<span>{{ tier.concurrent_runs != null ? `${tier.concurrent_runs} concurrent runs` : 'Unlimited concurrent' }}</span>
						</div>
					</template>
				</div>

				<div class="plan-action">
					<v-button v-if="isCurrentPlan(tier.id)" class="current-plan-btn" disabled full-width>
						Current Plan
					</v-button>
					<v-button
						v-else
						:secondary="isDowngrade(tier)"
						full-width
						:loading="checkingOut === tier.id"
						@click="$emit('checkout', tier.id)"
					>
						{{ isDowngrade(tier) ? 'Downgrade' : 'Upgrade' }}
					</v-button>
				</div>
			</div>
		</div>

		<div v-if="error" class="error-msg">{{ error }}</div>
	</div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

export type PlanModule = 'calculators' | 'kb' | 'flows';

export interface ModulePlan {
	id: string;
	name: string;
	module: PlanModule;
	tier: string;
	price_eur_monthly: number | string | null;
	price_eur_annual: number | string | null;
	sort: number | null;

	// calculators
	slot_allowance: number | null;
	ao_allowance: number | null;
	request_allowance: number | null;

	// kb
	storage_mb: number | null;
	embed_tokens_m: number | null;

	// flows
	executions: number | null;
	concurrent_runs: number | null;
}

const props = defineProps<{
	module: PlanModule;
	tiers: ModulePlan[];
	currentPlanId: string | null;
	currentPlanSort: number | null;
	checkingOut: string | null;
	error: string | null;
}>();

defineEmits<{
	checkout: [planId: string];
}>();

const yearly = ref(false);

const hasAnyPrice = computed(() =>
	props.tiers.some((t) => t.price_eur_monthly || t.price_eur_annual),
);

function planPrice(tier: ModulePlan): number {
	if (yearly.value) {
		return Number(tier.price_eur_annual || 0);
	}
	return Number(tier.price_eur_monthly || 0);
}

function formatEur(n: number): string {
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(n);
}

function isCurrentPlan(planId: string): boolean {
	return props.currentPlanId === planId;
}

function yearlySaving(tier: ModulePlan): number {
	const monthly = Number(tier.price_eur_monthly || 0);
	const annual = Number(tier.price_eur_annual || 0);
	if (!monthly || !annual) return 0;
	const annualMonthly = monthly * 12;
	const pct = Math.round(((annualMonthly - annual) / annualMonthly) * 100);
	return pct > 0 ? pct : 0;
}

const maxYearlySaving = computed(() => {
	let max = 0;
	for (const t of props.tiers) {
		const s = yearlySaving(t);
		if (s > max) max = s;
	}
	return max;
});

function isDowngrade(tier: ModulePlan): boolean {
	if (props.currentPlanSort == null) return false;
	return (tier.sort ?? 0) < props.currentPlanSort;
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
