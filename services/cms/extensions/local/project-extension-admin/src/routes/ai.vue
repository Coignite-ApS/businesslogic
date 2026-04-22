<template>
	<private-view title="AI Assistant">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="smart_toy" />
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
				<!-- KPI Row -->
				<div class="kpi-grid">
					<kpi-card
						label="Queries Today"
						:value="overview.queries_today"
						icon="chat"
						:subtitle="overview.queries_today === 1 ? '1 query' : overview.queries_today + ' queries'"
					/>
					<kpi-card
						label="Queries This Month"
						:value="overview.queries_month"
						icon="calendar_month"
						:subtitle="'since ' + formatDate(overview.period_start)"
					/>
					<kpi-card
						label="Cost This Month"
						:value="costMonth"
						icon="payments"
						prefix="$"
						:icon-variant="costMonth > 50 ? 'warning' : undefined"
						:subtitle="'avg $' + avgCostPerQuery.toFixed(4) + '/query'"
					/>
					<kpi-card
						label="Tokens This Month"
						:value="overview.tokens_month.input + overview.tokens_month.output"
						icon="token"
						:subtitle="formatTokens(overview.tokens_month.input) + ' in / ' + formatTokens(overview.tokens_month.output) + ' out'"
					/>
				</div>

				<!-- Chart: Queries per Day -->
				<div class="charts-grid">
					<div class="chart-card">
						<mini-chart
							title="Queries — Last 30 Days"
							type="line"
							:data="queriesChartData"
							:height="220"
						/>
						<div class="chart-legend">
							<span class="legend-item"><span class="legend-dot dot-primary" /> Queries</span>
							<span class="legend-item"><span class="legend-dot dot-secondary" /> Cost ($×100)</span>
						</div>
					</div>
					<div class="chart-card">
						<div class="chart-title">Top Models</div>
						<div v-if="overview.top_models.length" class="model-list">
							<div v-for="m in overview.top_models" :key="m.model" class="model-row">
								<div class="model-name">{{ shortModel(m.model) }}</div>
								<div class="model-bar-wrap">
									<div class="model-bar" :style="{ width: modelPct(m.queries) + '%' }" />
								</div>
								<div class="model-count">{{ m.queries }}</div>
								<div class="model-cost">${{ m.cost.toFixed(2) }}</div>
							</div>
						</div>
						<div v-else class="empty-state">No usage yet</div>
					</div>
				</div>

				<!-- Top Accounts Table -->
				<div class="section">
					<div class="section-title">Top Accounts by AI Usage</div>
					<div class="table-wrap">
						<table v-if="accounts.length" class="data-table">
							<thead>
								<tr>
									<th>Account</th>
									<th class="num">Queries</th>
									<th class="num">Input Tokens</th>
									<th class="num">Output Tokens</th>
									<th class="num">Cost</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="a in accounts" :key="a.account_id">
									<td>
										<router-link :to="'/admin-dashboard/accounts/' + a.account_id" class="account-link">
											{{ a.account_name || a.account_id }}
										</router-link>
									</td>
									<td class="num">{{ a.queries }}</td>
									<td class="num">{{ formatTokens(a.input_tokens) }}</td>
									<td class="num">{{ formatTokens(a.output_tokens) }}</td>
									<td class="num">${{ a.cost.toFixed(2) }}</td>
								</tr>
							</tbody>
						</table>
						<div v-else class="empty-state">No AI usage recorded yet</div>
					</div>
				</div>
			</template>

			<v-info v-else-if="apiError" type="danger" icon="error" :title="apiError" center />
		</div>

		<template #sidebar>
			<sidebar-detail id="info" icon="info" title="AI Dashboard">
				<div class="sidebar-info">
					<p>AI Assistant usage and cost monitoring across all accounts. Data refreshes on page load.</p>
				</div>
			</sidebar-detail>
		</template>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { useAdminApi } from '../composables/use-admin-api';
import type { AiOverviewData, AiAccountUsage } from '../types';
import AdminNavigation from '../components/admin-navigation.vue';
import KpiCard from '../components/kpi-card.vue';
import MiniChart from '../components/mini-chart.vue';

const api = useApi();
const { loading, error: apiError, fetchAiOverview, fetchAiAccounts } = useAdminApi(api);
const overview = ref<AiOverviewData | null>(null);
const accounts = ref<AiAccountUsage[]>([]);

const costMonth = computed(() => overview.value?.cost_month || 0);

const avgCostPerQuery = computed(() => {
	if (!overview.value || !overview.value.queries_month) return 0;
	return overview.value.cost_month / overview.value.queries_month;
});

const queriesChartData = computed(() => {
	if (!overview.value) return [];
	return overview.value.queries_per_day.map(d => ({
		label: `${new Date(d.date).getDate()}`,
		primary: d.queries,
		secondary: Math.round(d.cost * 100), // scale cost for visibility
	}));
});

const maxModelQueries = computed(() => {
	if (!overview.value?.top_models.length) return 1;
	return Math.max(1, ...overview.value.top_models.map(m => m.queries));
});

function modelPct(queries: number): number {
	return (queries / maxModelQueries.value) * 100;
}

function shortModel(model: string): string {
	return model.replace('claude-', '').replace(/-\d{8}$/, '');
}

function formatTokens(n: number): string {
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
	if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
	return String(n);
}

function formatDate(iso: string): string {
	if (!iso) return '';
	return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

onMounted(async () => {
	const [ov, acc] = await Promise.all([
		fetchAiOverview(),
		fetchAiAccounts(),
	]);
	overview.value = ov;
	accounts.value = acc || [];
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

.charts-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
	gap: 24px;
	margin-bottom: 32px;
}

.chart-card {
	background: var(--theme--background);
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	padding: 20px;
}

.chart-title {
	font-size: 13px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	margin-bottom: 12px;
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

.dot-primary { background: var(--theme--primary); }
.dot-secondary { background: var(--theme--danger, #e35169); }

/* Model list */
.model-list {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.model-row {
	display: flex;
	align-items: center;
	gap: 12px;
}

.model-name {
	width: 120px;
	font-size: 13px;
	font-weight: 500;
	color: var(--theme--foreground);
	flex-shrink: 0;
}

.model-bar-wrap {
	flex: 1;
	height: 8px;
	background: var(--theme--border-color);
	border-radius: 4px;
	overflow: hidden;
}

.model-bar {
	height: 100%;
	background: var(--theme--primary);
	border-radius: 4px;
	transition: width 0.3s;
}

.model-count {
	width: 48px;
	text-align: right;
	font-size: 13px;
	font-weight: 600;
	color: var(--theme--foreground);
}

.model-cost {
	width: 64px;
	text-align: right;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

/* Table */
.section {
	margin-bottom: 24px;
}

.section-title {
	font-size: 14px;
	font-weight: 600;
	color: var(--theme--foreground);
	margin-bottom: 12px;
}

.table-wrap {
	background: var(--theme--background);
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	overflow: hidden;
}

.data-table {
	width: 100%;
	border-collapse: collapse;
}

.data-table th,
.data-table td {
	padding: 10px 16px;
	text-align: left;
	font-size: 13px;
	border-bottom: 1px solid var(--theme--border-color);
}

.data-table th {
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	background: var(--theme--background-subdued);
}

.data-table tr:last-child td {
	border-bottom: none;
}

.num {
	text-align: right !important;
}

.account-link {
	color: var(--theme--primary);
	text-decoration: none;
}

.account-link:hover {
	text-decoration: underline;
}

.empty-state {
	padding: 32px;
	text-align: center;
	color: var(--theme--foreground-subdued);
	font-size: 14px;
}

.sidebar-info {
	padding: 12px;
	line-height: 1.6;
}
</style>
