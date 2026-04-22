<template>
	<private-view title="Tool Analytics">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="build" />
			</v-button>
		</template>

		<template #navigation>
			<observatory-navigation />
		</template>

		<div class="obs-content">
			<!-- Date range selector -->
			<div class="date-range-bar">
				<button
					v-for="opt in dateOptions"
					:key="opt.value"
					class="range-btn"
					:class="{ active: selectedDays === opt.value }"
					@click="selectDays(opt.value)"
				>{{ opt.label }}</button>
			</div>

			<div v-if="loading && !data" class="loading-state">
				<v-progress-circular indeterminate />
			</div>

			<template v-else-if="data">
				<!-- Summary KPIs -->
				<div class="kpi-grid">
					<div class="kpi-card">
						<div class="kpi-icon"><v-icon name="build" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Tools Used</div>
							<div class="kpi-value">{{ data.tools.length }}</div>
							<div class="kpi-subtitle">of {{ data.tools.length + data.unused_tools.length }} available</div>
						</div>
					</div>
					<div class="kpi-card">
						<div class="kpi-icon"><v-icon name="functions" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Total Tool Calls</div>
							<div class="kpi-value">{{ totalCalls.toLocaleString() }}</div>
						</div>
					</div>
					<div class="kpi-card" :class="{ 'kpi-warn': overallErrorRate > 5 }">
						<div class="kpi-icon"><v-icon name="error_outline" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Overall Error Rate</div>
							<div class="kpi-value">{{ overallErrorRate.toFixed(1) }}%</div>
							<div class="kpi-subtitle">{{ totalErrors }} errors</div>
						</div>
					</div>
					<div class="kpi-card">
						<div class="kpi-icon"><v-icon name="link_off" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Unused Tools</div>
							<div class="kpi-value">{{ data.unused_tools.length }}</div>
							<div class="kpi-subtitle">never called in {{ selectedDays }}d</div>
						</div>
					</div>
				</div>

				<!-- Tool Frequency Table -->
				<div class="section">
					<div class="section-title">Tool Usage (sorted by calls)</div>
					<div class="table-wrap">
						<table v-if="data.tools.length" class="data-table">
							<thead>
								<tr>
									<th>Tool Name</th>
									<th class="num">Calls</th>
									<th class="num">Errors</th>
									<th class="num">Error Rate</th>
									<th class="num">Avg Latency</th>
									<th class="num">P95 Latency</th>
									<th>Usage Bar</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="t in data.tools" :key="t.name" :class="{ 'row-error': parseFloat(t.error_rate) > 10 }">
									<td class="tool-name">{{ t.name }}</td>
									<td class="num">{{ t.calls.toLocaleString() }}</td>
									<td class="num" :class="{ 'cell-danger': t.errors > 0 }">{{ t.errors }}</td>
									<td class="num" :class="errorRateClass(t.error_rate)">{{ t.error_rate }}%</td>
									<td class="num">{{ t.avg_ms ? t.avg_ms + 'ms' : '–' }}</td>
									<td class="num">{{ t.p95_ms ? t.p95_ms + 'ms' : '–' }}</td>
									<td>
										<div class="usage-bar-wrap">
											<div class="usage-bar" :style="{ width: usageBarPct(t.calls) + '%' }" />
										</div>
									</td>
								</tr>
							</tbody>
						</table>
						<div v-else class="empty-state">No tool calls recorded in the last {{ selectedDays }} days</div>
					</div>
				</div>

				<!-- Two columns: top chains + unused tools -->
				<div class="two-col">
					<!-- Top Tool Chains -->
					<div class="section no-margin">
						<div class="section-title">Top Tool Sequences</div>
						<div class="table-wrap">
							<table v-if="data.top_chains.length" class="data-table">
								<thead>
									<tr>
										<th>Sequence</th>
										<th class="num">Count</th>
									</tr>
								</thead>
								<tbody>
									<tr v-for="c in data.top_chains" :key="c.chain">
										<td class="chain-name">{{ c.chain }}</td>
										<td class="num">{{ c.count }}</td>
									</tr>
								</tbody>
							</table>
							<div v-else class="empty-state">No multi-tool conversations yet</div>
						</div>
					</div>

					<!-- Unused Tools -->
					<div class="section no-margin">
						<div class="section-title">Unused Tools ({{ selectedDays }}d)</div>
						<div class="table-wrap">
							<div v-if="data.unused_tools.length" class="unused-list">
								<div v-for="t in data.unused_tools" :key="t" class="unused-item">
									<v-icon name="link_off" small />
									<span>{{ t }}</span>
								</div>
							</div>
							<div v-else class="empty-state">All tools have been used</div>
						</div>
					</div>
				</div>
			</template>

			<v-info v-else-if="error" type="danger" icon="error" :title="error" center />
		</div>

		<template #sidebar>
			<sidebar-detail id="info" icon="info" title="Tool Analytics">
				<div class="sidebar-info">
					<p>Per-tool call frequency, error rates, latency, sequential call patterns, and unused tool detection over the selected period.</p>
				</div>
			</sidebar-detail>
		</template>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { useObservatoryApi } from '../composables/use-observatory-api';
import type { ToolAnalyticsData } from '../types';
import ObservatoryNavigation from '../components/observatory-navigation.vue';

const api = useApi();
const { loading, error, fetchToolAnalytics } = useObservatoryApi(api);
const data = ref<ToolAnalyticsData | null>(null);

const dateOptions = [
	{ label: '7d', value: 7 },
	{ label: '30d', value: 30 },
	{ label: '90d', value: 90 },
];
const selectedDays = ref(30);

async function selectDays(days: number) {
	selectedDays.value = days;
	data.value = await fetchToolAnalytics(days);
}

const totalCalls = computed(() =>
	(data.value?.tools ?? []).reduce((s, t) => s + t.calls, 0)
);

const totalErrors = computed(() =>
	(data.value?.tools ?? []).reduce((s, t) => s + t.errors, 0)
);

const overallErrorRate = computed(() => {
	if (!totalCalls.value) return 0;
	return (totalErrors.value / totalCalls.value) * 100;
});

const maxCalls = computed(() =>
	Math.max(1, ...(data.value?.tools ?? []).map(t => t.calls))
);

function usageBarPct(calls: number): number {
	return (calls / maxCalls.value) * 100;
}

function errorRateClass(rate: string): string {
	const r = parseFloat(rate);
	if (r > 10) return 'cell-danger';
	if (r > 0) return 'cell-warn';
	return '';
}

onMounted(async () => {
	data.value = await fetchToolAnalytics(selectedDays.value);
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

/* Date range bar */
.date-range-bar {
	display: flex;
	gap: 8px;
	margin-bottom: 24px;
}

.range-btn {
	padding: 6px 16px;
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	background: var(--theme--background);
	color: var(--theme--foreground-subdued);
	font-size: 13px;
	font-weight: 600;
	cursor: pointer;
	transition: all 0.15s;
}

.range-btn:hover {
	border-color: var(--theme--primary);
	color: var(--theme--primary);
}

.range-btn.active {
	background: var(--theme--primary);
	border-color: var(--theme--primary);
	color: #fff;
}

.kpi-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
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

.kpi-card.kpi-warn { border-color: var(--theme--warning); }

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

.section { margin-bottom: 32px; }
.section.no-margin { margin-bottom: 0; }

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

.tool-name {
	font-family: var(--theme--fonts--mono--font-family, monospace);
	font-size: 12px;
	font-weight: 500;
}

.chain-name {
	font-family: var(--theme--fonts--mono--font-family, monospace);
	font-size: 12px;
}

.row-error { background: var(--theme--danger-background, rgba(227, 81, 105, 0.05)); }

.cell-danger { color: var(--theme--danger, #e35169) !important; font-weight: 600; }
.cell-warn { color: var(--theme--warning, #ecb95d) !important; font-weight: 600; }

.usage-bar-wrap {
	height: 6px;
	background: var(--theme--border-color);
	border-radius: 3px;
	overflow: hidden;
	min-width: 60px;
}

.usage-bar {
	height: 100%;
	background: var(--theme--primary);
	border-radius: 3px;
	transition: width 0.3s;
}

.two-col {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
	gap: 24px;
}

.unused-list {
	padding: 8px 0;
}

.unused-item {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 8px 16px;
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	border-bottom: 1px solid var(--theme--border-color);
	font-family: var(--theme--fonts--mono--font-family, monospace);
}

.unused-item:last-child { border-bottom: none; }

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
