<template>
	<private-view title="Admin Dashboard">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="admin_panel_settings" />
			</v-button>
		</template>

		<template #navigation>
			<admin-navigation />
		</template>

		<div class="admin-content">
			<div v-if="loading && !overview" class="loading-state">
				<v-progress-circular indeterminate />
			</div>

			<template v-else-if="overview">
				<!-- Revenue KPIs -->
				<div class="kpi-grid">
					<kpi-card
						label="Monthly Revenue"
						:value="overview.revenue.mrr / 100"
						icon="payments"
						prefix="$"
						:icon-variant="overview.revenue.mrr > 0 ? 'success' : undefined"
						:subtitle="'from ' + overview.revenue.active_subscriptions + ' paying customer' + (overview.revenue.active_subscriptions !== 1 ? 's' : '')"
						to="/admin-dashboard/accounts"
					/>
					<kpi-card
						label="Churn"
						:value="overview.revenue.churned_30d"
						icon="trending_down"
						:icon-variant="overview.revenue.churned_30d > 0 ? 'danger' : 'success'"
						:subtitle="overview.revenue.churned_30d + ' canceled last 30 days'"
						to="/admin-dashboard/accounts"
					/>
					<kpi-card
						label="Trial Conversion"
						:value="conversionRate"
						icon="swap_horiz"
						suffix="%"
						:icon-variant="conversionRate > 50 ? 'success' : conversionRate > 20 ? 'warning' : 'danger'"
						:subtitle="overview.revenue.trial_converted + ' of ' + overview.revenue.trial_total + ' trials became paid'"
					/>
					<kpi-card
						label="Error Rate"
						:value="errorRate"
						icon="error_outline"
						suffix="%"
						:icon-variant="errorRate > 5 ? 'danger' : errorRate > 1 ? 'warning' : 'success'"
						:subtitle="overview.calls.errors_month + ' of ' + overview.calls.month + ' calls failed this month'"
						to="/admin-dashboard/calculators"
					/>
				</div>

				<!-- Subscription cards -->
				<div class="plan-grid">
					<kpi-card
						label="Trial"
						:value="trialCount"
						icon="hourglass_empty"
						subtitle="active trials"
					/>
					<kpi-card
						v-for="p in overview.subscriptions.by_plan"
						:key="p.plan"
						:label="p.plan"
						:value="p.count"
						icon="credit_card"
						subtitle="paying customers"
					/>
				</div>

				<!-- Charts -->
				<div class="charts-grid">
					<div class="chart-card">
						<mini-chart
							title="Calls — Last 30 Days"
							type="line"
							:data="callsChartData"
							:height="220"
						/>
						<div class="chart-legend">
							<span class="legend-item"><span class="legend-dot dot-primary" /> Calls</span>
							<span class="legend-item"><span class="legend-dot dot-error" /> Errors</span>
						</div>
					</div>
					<div class="chart-card">
						<mini-chart
							title="Accounts — Last 12 Months"
							type="line"
							:data="accountsChartData"
							:height="220"
						/>
						<div class="chart-legend">
							<span class="legend-item"><span class="legend-dot dot-primary" /> Registrations</span>
							<span class="legend-item"><span class="legend-dot dot-error" /> Deletions</span>
							<span class="legend-item"><span class="legend-dot dot-success" /> Conversions</span>
						</div>
					</div>
				</div>
			</template>

			<v-info v-else-if="apiError" type="danger" icon="error" :title="apiError" center />
		</div>

		<template #sidebar>
			<sidebar-detail id="info" icon="info" title="Admin Dashboard">
				<div class="sidebar-info">
					<p>Platform overview with key revenue and health metrics. Data refreshes on page load.</p>
				</div>
			</sidebar-detail>
		</template>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { useAdminApi } from '../composables/use-admin-api';
import type { OverviewData } from '../types';
import AdminNavigation from '../components/admin-navigation.vue';
import KpiCard from '../components/kpi-card.vue';
import MiniChart from '../components/mini-chart.vue';

const api = useApi();
const { loading, error: apiError, fetchOverview } = useAdminApi(api);
const overview = ref<OverviewData | null>(null);

const errorRate = computed(() => {
	if (!overview.value || !overview.value.calls.month) return 0;
	return Math.round((overview.value.calls.errors_month / overview.value.calls.month) * 100);
});

const conversionRate = computed(() => {
	if (!overview.value?.revenue.trial_total) return 0;
	return Math.round((overview.value.revenue.trial_converted / overview.value.revenue.trial_total) * 100);
});

const churnRateLabel = computed(() => {
	if (!overview.value) return '';
	const active = overview.value.revenue.active_subscriptions;
	const churned = overview.value.revenue.churned_30d;
	if (!active && !churned) return 'no subscriptions';
	const rate = Math.round((churned / (active + churned)) * 100);
	return rate + '% churn rate';
});

function formatCurrency(cents: number): string {
	return '$' + (cents / 100).toFixed(2).replace(/\.00$/, '');
}

const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const callsChartData = computed(() => {
	if (!overview.value) return [];
	return overview.value.charts.calls_per_day.map(d => ({
		label: `${new Date(d.date).getDate()}`,
		primary: d.total,
		secondary: d.errors,
	}));
});

const trialCount = computed(() => {
	if (!overview.value) return 0;
	return overview.value.revenue.trial_total - overview.value.revenue.trial_converted;
});

const accountsChartData = computed(() => {
	if (!overview.value) return [];
	const deletions = new Map((overview.value.charts.deletions_per_month || []).map((d: any) => [d.month, d.count]));
	const conversions = new Map((overview.value.charts.conversions_per_month || []).map((d: any) => [d.month, d.count]));
	return overview.value.charts.accounts_per_month.map(d => {
		const [, m] = d.month.split('-');
		return {
			label: monthLabels[parseInt(m, 10) - 1] || m,
			primary: d.count,
			secondary: deletions.get(d.month) || 0,
			tertiary: conversions.get(d.month) || 0,
		};
	});
});

onMounted(async () => {
	overview.value = await fetchOverview();
});
</script>

<style scoped>
.header-icon {
	--v-button-background-color-disabled: var(--theme--primary-background);
	--v-button-color-disabled: var(--theme--primary);
}

.admin-content {
	padding: var(--content-padding);
	padding-bottom: var(--content-padding-bottom);
}

.loading-state {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 300px;
}

.kpi-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
	gap: 16px;
	margin-bottom: 32px;
}

.kpi-value {
	font-size: 28px;
	font-weight: 700;
	color: var(--theme--foreground);
	line-height: 1.2;
}

.kpi-subtitle {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	margin-top: 2px;
}

.section {
	margin-bottom: 24px;
}

.section-title {
	font-size: 14px;
	font-weight: 600;
	color: var(--theme--foreground);
	margin-bottom: 12px;
}

.plan-chips {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.charts-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
	gap: 24px;
}

.chart-card {
	background: var(--theme--background);
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	padding: 20px;
}

.chart-legend {
	display: flex;
	justify-content: flex-end;
	gap: 16px;
	margin-top: 12px;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.legend-item {
	display: flex;
	align-items: center;
	gap: 4px;
}

.legend-dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
}

.plan-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
	gap: 12px;
	margin-bottom: 24px;
}

.dot-primary { background: var(--theme--primary); }
.dot-error { background: var(--theme--danger, #e35169); }
.dot-success { background: var(--theme--success, #2ecda7); }

.sidebar-info {
	padding: 12px;
	line-height: 1.6;
}
</style>
