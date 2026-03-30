<template>
	<private-view title="Cost &amp; Budget">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="payments" />
			</v-button>
		</template>

		<template #navigation>
			<observatory-navigation />
		</template>

		<div class="obs-content">
			<div v-if="loading && !data" class="loading-state">
				<v-progress-circular indeterminate />
			</div>

			<template v-else-if="data">
				<!-- KPI Row -->
				<div class="kpi-grid">
					<div class="kpi-card">
						<div class="kpi-icon"><v-icon name="payments" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Total Cost (30d)</div>
							<div class="kpi-value">${{ totalCost.toFixed(4) }}</div>
						</div>
					</div>
					<div class="kpi-card">
						<div class="kpi-icon"><v-icon name="chat_bubble" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Avg Cost / Conversation</div>
							<div class="kpi-value">${{ data.cost_per_conversation.p50.toFixed(5) }}</div>
							<div class="kpi-subtitle">P50</div>
						</div>
					</div>
					<div class="kpi-card" :class="{ 'kpi-warn': data.cost_per_conversation.p95 > 0.01 }">
						<div class="kpi-icon"><v-icon name="trending_up" /></div>
						<div class="kpi-body">
							<div class="kpi-label">P95 Cost / Conversation</div>
							<div class="kpi-value">${{ data.cost_per_conversation.p95.toFixed(5) }}</div>
							<div class="kpi-subtitle">{{ data.cost_per_conversation.sample_size }} conversations</div>
						</div>
					</div>
					<div class="kpi-card">
						<div class="kpi-icon"><v-icon name="token" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Total Tokens (30d)</div>
							<div class="kpi-value">{{ fmtNum(totalTokens) }}</div>
							<div class="kpi-subtitle">{{ fmtNum(totalInputTokens) }} in / {{ fmtNum(totalOutputTokens) }} out</div>
						</div>
					</div>
				</div>

				<!-- Daily Cost Chart -->
				<div class="chart-card">
					<div class="chart-title">Daily Cost — Last 30 Days</div>
					<div v-if="costChartData.length" class="bar-chart" :style="{ height: '180px' }">
						<div class="bar-chart-inner">
							<div
								v-for="d in costChartData"
								:key="d.date"
								class="bar-col"
								:title="d.date + ': $' + d.cost.toFixed(4)"
							>
								<div class="bar-fill" :style="{ height: barPct(d.cost, maxDailyCost) + '%' }" />
							</div>
						</div>
						<div class="bar-labels">
							<span
								v-for="(d, i) in costChartData"
								:key="'l' + i"
								class="bar-label"
								:class="{ visible: i % 5 === 0 || i === costChartData.length - 1 }"
							>{{ shortDate(d.date) }}</span>
						</div>
					</div>
					<div v-else class="empty-state">No cost data in range</div>
				</div>

				<!-- Top Spenders Table -->
				<div class="section">
					<div class="section-title">Top Spender Accounts</div>
					<div class="table-wrap">
						<table v-if="data.top_spenders.length" class="data-table">
							<thead>
								<tr>
									<th>#</th>
									<th>Account ID</th>
									<th class="num">Total Cost (30d)</th>
									<th class="num">Share</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="(s, i) in data.top_spenders" :key="s.account_id">
									<td class="rank">{{ i + 1 }}</td>
									<td class="mono">{{ s.account_id }}</td>
									<td class="num">${{ s.total_cost.toFixed(4) }}</td>
									<td class="num">
										<div class="share-wrap">
											<div class="share-bar" :style="{ width: sharePct(s.total_cost) + '%' }" />
											<span>{{ sharePct(s.total_cost).toFixed(0) }}%</span>
										</div>
									</td>
								</tr>
							</tbody>
						</table>
						<div v-else class="empty-state">No spend data yet</div>
					</div>
				</div>
			</template>

			<v-info v-else-if="error" type="danger" icon="error" :title="error" center />
		</div>

		<template #sidebar>
			<sidebar-detail icon="info" title="Cost & Budget" close>
				<div class="sidebar-info">
					<p>AI cost breakdown over the last 30 days. Includes daily trends, conversation percentiles, and top-spending accounts.</p>
				</div>
			</sidebar-detail>
		</template>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { useObservatoryApi } from '../composables/use-observatory-api';
import type { CostDetails } from '../types';
import ObservatoryNavigation from '../components/observatory-navigation.vue';

const api = useApi();
const { loading, error, fetchCostDetails } = useObservatoryApi(api);
const data = ref<CostDetails | null>(null);

const totalCost = computed(() =>
	data.value?.daily_cost.reduce((s, d) => s + d.total_cost_usd, 0) ?? 0
);
const totalInputTokens = computed(() =>
	data.value?.daily_cost.reduce((s, d) => s + d.total_input_tokens, 0) ?? 0
);
const totalOutputTokens = computed(() =>
	data.value?.daily_cost.reduce((s, d) => s + d.total_output_tokens, 0) ?? 0
);
const totalTokens = computed(() => totalInputTokens.value + totalOutputTokens.value);

const costChartData = computed(() =>
	(data.value?.daily_cost ?? []).map(d => ({ date: d.date, cost: d.total_cost_usd }))
);
const maxDailyCost = computed(() =>
	Math.max(0.000001, ...costChartData.value.map(d => d.cost))
);
const maxSpend = computed(() =>
	Math.max(0.000001, ...(data.value?.top_spenders ?? []).map(s => s.total_cost))
);

function barPct(val: number, max: number): number {
	return Math.max(2, (val / max) * 100);
}

function sharePct(cost: number): number {
	if (!totalCost.value) return 0;
	return Math.min(100, (cost / totalCost.value) * 100);
}

function shortDate(iso: string): string {
	const d = new Date(iso);
	return (d.getMonth() + 1) + '/' + d.getDate();
}

function fmtNum(n: number): string {
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
	if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
	return n.toLocaleString();
}

onMounted(async () => {
	data.value = await fetchCostDetails(30);
});
</script>

<style scoped>
.header-icon {
	--v-button-background-color-disabled: var(--theme--primary-background);
	--v-button-color-disabled: var(--theme--primary);
}

.obs-content {
	padding: var(--content-padding);
	padding-bottom: var(--content-padding-bottom);
}

.loading-state {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 300px;
}

/* KPI Grid */
.kpi-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	gap: 16px;
	margin-bottom: 32px;
}

.kpi-card {
	display: flex;
	align-items: flex-start;
	gap: 16px;
	padding: 20px;
	background: var(--theme--background);
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
}

.kpi-card.kpi-warn {
	border-color: var(--theme--warning);
}

.kpi-icon {
	width: 44px;
	height: 44px;
	display: flex;
	align-items: center;
	justify-content: center;
	background: var(--theme--primary-background);
	border-radius: var(--theme--border-radius);
	color: var(--theme--primary);
	flex-shrink: 0;
}

.kpi-body { flex: 1; min-width: 0; }

.kpi-label {
	font-size: 11px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	text-transform: uppercase;
	letter-spacing: 0.5px;
}

.kpi-value {
	font-size: 24px;
	font-weight: 700;
	color: var(--theme--foreground);
	line-height: 1.2;
}

.kpi-subtitle {
	font-size: 11px;
	color: var(--theme--foreground-subdued);
	margin-top: 2px;
}

/* Chart */
.chart-card {
	background: var(--theme--background);
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	padding: 20px;
	margin-bottom: 32px;
}

.chart-title {
	font-size: 13px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	margin-bottom: 12px;
}

.bar-chart {
	display: flex;
	flex-direction: column;
}

.bar-chart-inner {
	flex: 1;
	display: flex;
	align-items: flex-end;
	gap: 3px;
}

.bar-col {
	flex: 1;
	height: 100%;
	display: flex;
	flex-direction: column;
	justify-content: flex-end;
	cursor: default;
}

.bar-fill {
	background: var(--theme--primary);
	border-radius: 2px 2px 0 0;
	min-height: 2px;
	transition: height 0.2s;
}

.bar-col:hover .bar-fill {
	background: var(--theme--primary-accent, var(--theme--primary));
	opacity: 0.8;
}

.bar-labels {
	display: flex;
	gap: 3px;
	border-top: 1px solid var(--theme--border-color);
	padding-top: 4px;
	margin-top: 4px;
}

.bar-label {
	flex: 1;
	font-size: 10px;
	color: transparent;
	text-align: center;
	overflow: hidden;
	white-space: nowrap;
}

.bar-label.visible {
	color: var(--theme--foreground-subdued);
}

/* Section / Table */
.section { margin-bottom: 24px; }

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
	font-size: 11px;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	background: var(--theme--background-subdued);
}

.data-table tr:last-child td { border-bottom: none; }

.num { text-align: right !important; }

.rank {
	width: 32px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
}

.mono {
	font-family: var(--theme--fonts--mono--font-family, monospace);
	font-size: 12px;
}

.share-wrap {
	display: flex;
	align-items: center;
	gap: 8px;
	justify-content: flex-end;
}

.share-bar {
	height: 6px;
	background: var(--theme--primary);
	border-radius: 3px;
	min-width: 2px;
	max-width: 80px;
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
