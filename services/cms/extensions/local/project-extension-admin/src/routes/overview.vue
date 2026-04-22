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
				<!-- Revenue KPIs (v2: subscription MRR + wallet revenue separated) -->
				<div class="kpi-grid">
					<kpi-card
						label="Subscription MRR"
						:value="subscriptionMrrEur"
						icon="payments"
						prefix="€"
						:icon-variant="subscriptionMrrEur > 0 ? 'success' : undefined"
						:subtitle="'from ' + overview.revenue.active_subscriptions + ' module sub' + (overview.revenue.active_subscriptions !== 1 ? 's' : '')"
						to="/admin-dashboard/accounts"
					/>
					<kpi-card
						label="AI Wallet Revenue"
						:value="walletRevenueEur"
						icon="account_balance_wallet"
						prefix="€"
						:icon-variant="walletRevenueEur > 0 ? 'success' : undefined"
						subtitle="one-time top-ups this month"
					/>
					<kpi-card
						label="Total Revenue (mo)"
						:value="totalRevenueEur"
						icon="trending_up"
						prefix="€"
						:icon-variant="totalRevenueEur > 0 ? 'success' : undefined"
						subtitle="subscription + wallet"
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
						label="Churn"
						:value="overview.revenue.churned_30d"
						icon="trending_down"
						:icon-variant="overview.revenue.churned_30d > 0 ? 'danger' : 'success'"
						:subtitle="overview.revenue.churned_30d + ' canceled last 30 days'"
						to="/admin-dashboard/accounts"
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

				<!-- Subscription matrix: rows = modules, cols = tiers -->
				<div v-if="hasMatrix" class="matrix-section">
					<h3 class="section-title">Subscriptions by module × tier</h3>
					<div class="matrix-table">
						<div class="matrix-header">
							<div class="matrix-cell matrix-row-label">Module</div>
							<div class="matrix-cell" v-for="t in tierColumns" :key="t">{{ tierLabel(t) }}</div>
							<div class="matrix-cell matrix-totals-col">Total</div>
						</div>
						<div v-for="mod in moduleRows" :key="mod" class="matrix-row">
							<div class="matrix-cell matrix-row-label">{{ moduleLabel(mod) }}</div>
							<div class="matrix-cell" v-for="t in tierColumns" :key="t">
								<template v-if="cellAt(mod, t)">
									<div class="cell-count">{{ cellAt(mod, t)!.count }}</div>
									<div class="cell-mrr">€{{ formatNum(cellAt(mod, t)!.mrr_eur) }}</div>
								</template>
								<span v-else class="cell-empty">—</span>
							</div>
							<div class="matrix-cell matrix-totals-col">
								<div class="cell-count">{{ moduleTotal(mod).count }}</div>
								<div class="cell-mrr">€{{ formatNum(moduleTotal(mod).mrr_eur) }}</div>
							</div>
						</div>
					</div>
				</div>

				<!-- Trial chip on its own row (legacy single-card kept) -->
				<div class="plan-grid">
					<kpi-card
						label="Trial"
						:value="trialCount"
						icon="hourglass_empty"
						subtitle="active trials"
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

// v2 Phase 5: revenue is now in EUR units (not cents). Fall back to legacy
// /100 only when v2 fields are absent (older API responses).
const subscriptionMrrEur = computed(() => {
	if (!overview.value) return 0;
	const v2 = overview.value.revenue.subscription_mrr_eur;
	if (typeof v2 === 'number') return Math.round(v2 * 100) / 100;
	return Math.round(((overview.value.revenue.mrr || 0) / 100) * 100) / 100;
});

const walletRevenueEur = computed(() => {
	if (!overview.value) return 0;
	return Math.round(((overview.value.revenue.wallet_revenue_month_eur || 0)) * 100) / 100;
});

const totalRevenueEur = computed(() => {
	if (!overview.value) return 0;
	const v2 = overview.value.revenue.total_revenue_month_eur;
	if (typeof v2 === 'number') return Math.round(v2 * 100) / 100;
	return subscriptionMrrEur.value + walletRevenueEur.value;
});

// (module, tier) matrix rendering helpers.
const TIER_ORDER = ['starter', 'growth', 'scale', 'enterprise'] as const;
const MODULE_ORDER = ['calculators', 'kb', 'flows'] as const;

const matrix = computed(() => overview.value?.subscriptions.matrix || {});
const hasMatrix = computed(() => Object.keys(matrix.value).length > 0);

const moduleRows = computed(() =>
	MODULE_ORDER.filter((m) => matrix.value[m] && Object.keys(matrix.value[m]).length > 0),
);

const tierColumns = computed(() => {
	const seen = new Set<string>();
	for (const mod of Object.keys(matrix.value)) {
		for (const tier of Object.keys(matrix.value[mod])) seen.add(tier);
	}
	return TIER_ORDER.filter((t) => seen.has(t));
});

function cellAt(mod: string, tier: string): { count: number; mrr_eur: number } | null {
	return matrix.value[mod]?.[tier] || null;
}

function moduleTotal(mod: string): { count: number; mrr_eur: number } {
	const cells = matrix.value[mod] || {};
	let count = 0;
	let mrr = 0;
	for (const tier of Object.keys(cells)) {
		count += cells[tier].count;
		mrr += cells[tier].mrr_eur;
	}
	return { count, mrr_eur: Math.round(mrr * 100) / 100 };
}

function moduleLabel(m: string): string {
	if (m === 'calculators') return 'Calculators';
	if (m === 'kb') return 'Knowledge Base';
	if (m === 'flows') return 'Flows';
	return m;
}

function tierLabel(t: string): string {
	return t.charAt(0).toUpperCase() + t.slice(1);
}

function formatNum(n: number): string {
	return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

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

.matrix-section {
	margin-bottom: 32px;
}

.matrix-table {
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	overflow: hidden;
	background: var(--theme--background);
}

.matrix-header,
.matrix-row {
	display: grid;
	grid-template-columns: 180px repeat(auto-fit, minmax(120px, 1fr)) 130px;
	align-items: stretch;
}

.matrix-header {
	background: var(--theme--background-subdued);
	font-size: 11px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	text-transform: uppercase;
	letter-spacing: 0.5px;
}

.matrix-row {
	border-top: 1px solid var(--theme--border-color);
}

.matrix-cell {
	padding: 12px 14px;
	border-right: 1px solid var(--theme--border-color);
	display: flex;
	flex-direction: column;
	justify-content: center;
}
.matrix-cell:last-child { border-right: none; }

.matrix-row-label {
	font-weight: 600;
	color: var(--theme--foreground);
	background: var(--theme--background-subdued);
	font-size: 13px;
}

.matrix-totals-col {
	background: var(--theme--background-subdued);
	font-weight: 600;
}

.cell-count {
	font-size: 18px;
	font-weight: 700;
	color: var(--theme--foreground);
	line-height: 1;
}

.cell-mrr {
	font-size: 11px;
	color: var(--theme--foreground-subdued);
	margin-top: 4px;
}

.cell-empty {
	color: var(--theme--foreground-subdued);
	font-size: 14px;
}

.dot-primary { background: var(--theme--primary); }
.dot-error { background: var(--theme--danger, #e35169); }
.dot-success { background: var(--theme--success, #2ecda7); }

.sidebar-info {
	padding: 12px;
	line-height: 1.6;
}
</style>
