<template>
	<div class="dashboard">
		<!-- Aggregate chart -->
		<div class="chart-section">
			<div class="chart-toolbar">
				<div class="link-toggle">
					<a :class="{ active: timeRange === 'today' }" @click="timeRange = 'today'">Today</a>
					<span class="toggle-sep">|</span>
					<a :class="{ active: timeRange === '7d' }" @click="timeRange = '7d'">7 days</a>
					<span class="toggle-sep">|</span>
					<a :class="{ active: timeRange === '12m' }" @click="timeRange = '12m'">12 months</a>
				</div>
			</div>

			<div class="chart">
				<div class="chart-gradient" />
				<template v-if="chartEmpty">
					<div v-for="(bar, idx) in chartBars" :key="bar.label" class="chart-bar-group">
						<div class="chart-bar-wrapper" :style="{ height: placeholderHeights[idx % placeholderHeights.length] + '%' }">
							<div class="chart-bar">
								<div class="bar-segment bar-placeholder" style="flex: 1" />
							</div>
						</div>
					</div>
				</template>
				<template v-else>
					<div v-for="bar in chartBars" :key="bar.label" class="chart-bar-group">
						<div class="chart-bar-wrapper" :style="{ height: bar.heightPct + '%' }">
							<div class="chart-bar-count">{{ bar.total || '' }}</div>
							<div class="chart-bar">
								<div v-if="bar.error" class="bar-segment bar-error" :style="{ flex: bar.error }">
									<span class="segment-tooltip">{{ bar.error }}</span>
								</div>
								<div v-if="bar.cached" class="bar-segment bar-cached" :style="{ flex: bar.cached }">
									<span class="segment-tooltip">{{ bar.cached }}</span>
								</div>
								<div v-if="bar.success" class="bar-segment bar-success" :style="{ flex: bar.success }">
									<span class="segment-tooltip">{{ bar.success }}</span>
								</div>
							</div>
						</div>
					</div>
				</template>
			</div>

			<div class="chart-labels">
				<div v-for="bar in chartBars" :key="'l-' + bar.label" class="chart-label-cell">
					{{ bar.label }}
				</div>
			</div>

			<div class="chart-legend">
				<span class="legend-item"><span class="legend-dot dot-success" /> Success</span>
				<span class="legend-item"><span class="legend-dot dot-cached" /> Cached</span>
				<span class="legend-item"><span class="legend-dot dot-error" /> Error</span>
			</div>
		</div>

		<!-- KPI cards -->
		<div class="kpi-grid">
			<kpi-card
				label="Active Calculators"
				:value="activeCount"
				:max="totalCount"
				icon="check_circle"
				icon-variant="success"
			/>
			<kpi-card
				:label="'Error Rate (' + rangeLabel + ')'"
				:value="errorRate"
				icon="error_outline"
				suffix="%"
				:icon-variant="errorRate > 10 ? 'danger' : errorRate > 0 ? 'warning' : 'success'"
				:subtitle="errorCount + ' errors'"
			/>
			<kpi-card
				:label="'Total Calls (' + rangeLabel + ')'"
				:value="calls"
				icon="trending_up"
			/>
			<kpi-card
				:label="'Cached (' + rangeLabel + ')'"
				:value="cachedCount"
				icon="cached"
				:subtitle="cachedPct + '% cache hit'"
			/>
		</div>

		<!-- Calculator cards: active first, then test, then inactive -->
		<div v-if="sortedCalculators.length" class="calc-grid">
			<div
				v-for="calc in sortedCalculators"
				:key="calc.id"
				class="calc-card"
				@click="$router.push(`/calculators/${calc.id}`)"
			>
				<div class="calc-card-header">
					<v-icon :name="calc.icon || 'calculate'" class="calc-card-icon" />
					<span class="calc-card-name">{{ calc.name || 'New Calculator' }}</span>
					<span class="status-badge" :class="statusClass(calc)">{{ statusLabel(calc) }}</span>
				</div>
				<div class="calc-card-sparkline">
					<div
						v-for="(val, idx) in miniChart(calc.id)"
						:key="idx"
						class="spark-bar"
						:style="{ height: sparkHeight(val, calc.id) + '%' }"
					/>
				</div>
			</div>
		</div>
		<div v-else class="no-calcs">
			<v-info icon="calculate" title="No Calculators">
				Create your first calculator to get started.
			</v-info>
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import type { Calculator } from '../types';
import { useDashboardStats, type TimeRange } from '../composables/use-dashboard-stats';
import KpiCard from './kpi-card.vue';

const props = defineProps<{
	calculators: Calculator[];
	api: any;
}>();

const timeRange = ref<TimeRange>('7d');

const {
	liveRecords,
	totalCalls,
	errorRateForRange,
	errorCountForRange,
	miniChartData,
	buildAggregateChart,
	fetchCallData,
	startPolling,
	stopPolling,
} = useDashboardStats(props.api);

const activeCount = computed(() => props.calculators.filter((c) => c.activated && !c.over_limit).length);
const totalCount = computed(() => props.calculators.length);

// KPI values driven by time range
const calls = computed(() => totalCalls(timeRange.value));
const errorRate = computed(() => errorRateForRange(timeRange.value));
const errorCount = computed(() => errorCountForRange(timeRange.value));

const cachedCount = computed(() => {
	const cutoff = rangeCutoff(timeRange.value);
	return liveRecords.value.filter((r) => tsMs(r.timestamp) >= cutoff && r.cached).length;
});

const cachedPct = computed(() => {
	const total = calls.value;
	if (!total) return 0;
	return Math.round((cachedCount.value / total) * 100);
});

const rangeLabel = computed(() => {
	if (timeRange.value === 'today') return 'today';
	if (timeRange.value === '7d') return '7d';
	return '12m';
});

// Sort: active (live) first, then test, then inactive
const sortedCalculators = computed(() => {
	return [...props.calculators].sort((a, b) => statusOrder(a) - statusOrder(b));
});

function statusOrder(calc: Calculator): number {
	if (calc.activated && !calc.over_limit) return 0;
	if (calc.activated && calc.over_limit) return 1;
	if (!calc.activated && calc.test_expires_at && new Date(calc.test_expires_at) > new Date()) return 2;
	return 3;
}

const activatedIds = computed(() => props.calculators.filter((c) => c.activated).map((c) => c.id));

const chartBars = computed(() => buildAggregateChart(timeRange.value));
const chartEmpty = computed(() => chartBars.value.every((b) => b.total === 0));
const placeholderHeights = [35, 55, 25, 65, 40, 75, 30, 50, 45, 60, 20, 70];

// Mini chart cache — invalidate on data change
const miniChartCache = ref<Record<string, number[]>>({});

function miniChart(calcId: string): number[] {
	if (!miniChartCache.value[calcId]) {
		miniChartCache.value[calcId] = miniChartData(calcId);
	}
	return miniChartCache.value[calcId];
}

function sparkHeight(val: number, calcId: string): number {
	const data = miniChart(calcId);
	const max = Math.max(1, ...data);
	return Math.max(4, (val / max) * 100);
}

function statusClass(calc: Calculator): string {
	if (calc.activated && !calc.over_limit) return 'badge-live';
	if (calc.activated && calc.over_limit) return 'badge-warning';
	if (!calc.activated && calc.test_expires_at && new Date(calc.test_expires_at) > new Date()) return 'badge-test';
	return 'badge-inactive';
}

function statusLabel(calc: Calculator): string {
	if (calc.activated && !calc.over_limit) return 'Live';
	if (calc.activated && calc.over_limit) return 'Over Limit';
	if (!calc.activated && calc.test_expires_at && new Date(calc.test_expires_at) > new Date()) return 'Test';
	return 'Inactive';
}

function rangeCutoff(range: TimeRange): number {
	const now = new Date();
	if (range === 'today') {
		const midnight = new Date(now);
		midnight.setHours(0, 0, 0, 0);
		return midnight.getTime();
	}
	if (range === '7d') {
		const d = new Date(now);
		d.setDate(d.getDate() - 7);
		d.setHours(0, 0, 0, 0);
		return d.getTime();
	}
	const d = new Date(now);
	d.setMonth(d.getMonth() - 12);
	return d.getTime();
}

function tsMs(ts: string): number {
	return new Date(ts.endsWith('Z') ? ts : ts + 'Z').getTime();
}

watch(activatedIds, (ids) => {
	fetchCallData(ids);
	miniChartCache.value = {};
}, { immediate: true });

onMounted(() => {
	startPolling(() => activatedIds.value);
});

onBeforeUnmount(stopPolling);
</script>

<style scoped>
.dashboard {
	padding: var(--content-padding);
	padding-bottom: var(--content-padding-bottom);
}

/* Chart */
.chart-section {
	margin-bottom: 32px;
}

.chart-toolbar {
	display: flex;
	align-items: center;
	margin-bottom: 12px;
}

.link-toggle {
	display: inline-flex;
	align-items: center;
	gap: 6px;
}

.link-toggle a {
	font-size: 13px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	cursor: pointer;
	text-decoration: none;
	transition: color 0.15s;
}

.link-toggle a:hover {
	color: var(--theme--foreground);
}

.link-toggle a.active {
	color: var(--theme--foreground);
}

.toggle-sep {
	font-size: 13px;
	color: var(--theme--border-color);
	user-select: none;
}

.chart {
	display: flex;
	align-items: flex-end;
	gap: 12px;
	height: 200px;
	position: relative;
}

.chart-gradient {
	position: absolute;
	inset: 0;
	background: linear-gradient(to top, var(--theme--background-subdued), transparent);
	border-radius: var(--theme--border-radius);
	pointer-events: none;
	z-index: 0;
}

.chart-bar-group {
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: flex-end;
	height: 100%;
	position: relative;
	z-index: 1;
}

.chart-bar-wrapper {
	display: flex;
	flex-direction: column;
	align-items: center;
	width: 100%;
}

.chart-bar-count {
	font-size: 11px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	margin-bottom: 4px;
	min-height: 14px;
}

.chart-bar {
	width: 100%;
	max-width: 56px;
	display: flex;
	flex-direction: column-reverse;
	justify-content: flex-start;
	border-radius: 6px 6px 0 0;
	overflow: visible;
	flex: 1;
	min-height: 2px;
}

.bar-segment {
	min-height: 0;
	position: relative;
}

.segment-tooltip {
	display: none;
	position: absolute;
	left: calc(100% + 6px);
	top: 50%;
	transform: translateY(-50%);
	font-size: 11px;
	font-weight: 700;
	color: #fff;
	padding: 2px 6px;
	border-radius: 4px;
	white-space: nowrap;
	pointer-events: none;
	z-index: 10;
}

.bar-success .segment-tooltip { background: var(--theme--success, #2ecda7); }
.bar-cached .segment-tooltip { background: #22a687; }
.bar-error .segment-tooltip { background: var(--theme--danger, #e35169); }
.bar-segment:hover .segment-tooltip { display: block; }

.bar-success { background: var(--theme--success, #2ecda7); }
.bar-cached { background: #22a687; }
.bar-error { background: var(--theme--danger, #e35169); }
.bar-placeholder {
	background: var(--theme--border-color);
	opacity: 0.3;
	border-radius: 6px 6px 0 0;
}

.chart-labels {
	display: flex;
	gap: 12px;
	border-top: 1px solid var(--theme--border-color);
	padding-top: 6px;
}

.chart-label-cell {
	flex: 1;
	text-align: center;
	font-size: 11px;
	color: var(--theme--foreground-subdued);
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
	display: inline-block;
	flex-shrink: 0;
}

.dot-success { background: var(--theme--success, #2ecda7); }
.dot-cached { background: #22a687; }
.dot-error { background: var(--theme--danger, #e35169); }

/* KPI grid */
.kpi-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	gap: 16px;
	margin-bottom: 32px;
}

/* Calculator card grid */
.calc-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
	gap: 16px;
}

.calc-card {
	padding: 16px;
	background: var(--theme--background);
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	cursor: pointer;
	transition: border-color 0.15s, box-shadow 0.15s;
}

.calc-card:hover {
	border-color: var(--theme--primary);
	box-shadow: 0 0 0 1px var(--theme--primary);
}

.calc-card-header {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 12px;
}

.calc-card-icon {
	color: var(--theme--foreground-subdued);
}

.calc-card-name {
	font-weight: 600;
	font-size: 14px;
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.status-badge {
	font-size: 11px;
	font-weight: 600;
	padding: 2px 8px;
	border-radius: 12px;
	white-space: nowrap;
	flex-shrink: 0;
}

.badge-live {
	background: var(--theme--success-background, rgba(46, 205, 167, 0.1));
	color: var(--theme--success);
}

.badge-test {
	background: var(--theme--warning-background);
	color: var(--theme--warning);
}

.badge-warning {
	background: var(--theme--danger-background);
	color: var(--theme--danger);
}

.badge-inactive {
	background: var(--theme--background-subdued);
	color: var(--theme--foreground-subdued);
}

/* Mini sparkline */
.calc-card-sparkline {
	display: flex;
	align-items: flex-end;
	gap: 3px;
	height: 32px;
}

.spark-bar {
	flex: 1;
	background: var(--theme--primary);
	opacity: 0.6;
	border-radius: 2px 2px 0 0;
	min-height: 2px;
	transition: opacity 0.15s;
}

.calc-card:hover .spark-bar {
	opacity: 1;
}

.no-calcs {
	display: flex;
	justify-content: center;
	padding: 48px 0;
}
</style>
