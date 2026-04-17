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
					<a :class="{ active: timeRange === '30d' }" @click="timeRange = '30d'">30 days</a>
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
								<div v-if="bar.failed" class="bar-segment bar-failed" :style="{ flex: bar.failed }">
									<span class="segment-tooltip">{{ bar.failed }}</span>
								</div>
								<div v-if="bar.running" class="bar-segment bar-running" :style="{ flex: bar.running }">
									<span class="segment-tooltip">{{ bar.running }}</span>
								</div>
								<div v-if="bar.completed" class="bar-segment bar-completed" :style="{ flex: bar.completed }">
									<span class="segment-tooltip">{{ bar.completed }}</span>
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
				<span class="legend-item"><span class="legend-dot dot-completed" /> Completed</span>
				<span class="legend-item"><span class="legend-dot dot-running" /> Running</span>
				<span class="legend-item"><span class="legend-dot dot-failed" /> Failed</span>
			</div>
		</div>

		<!-- KPI cards -->
		<div class="kpi-grid">
			<kpi-card
				label="Active Flows"
				:value="activeFlowsCount"
				:max="totalFlowsCount"
				icon="check_circle"
				icon-variant="success"
			/>
			<kpi-card
				:label="'Error Rate (' + rangeLabel + ')'"
				:value="errorRateVal"
				icon="error_outline"
				suffix="%"
				:icon-variant="errorRateVal > 10 ? 'danger' : errorRateVal > 0 ? 'warning' : 'success'"
			/>
			<kpi-card
				:label="'Total Executions (' + rangeLabel + ')'"
				:value="totalExec"
				icon="trending_up"
			/>
			<kpi-card
				:label="'Avg Duration (' + rangeLabel + ')'"
				:value="avgDurationVal"
				icon="timer"
				suffix="ms"
			/>
		</div>

		<!-- Flow cards -->
		<div class="flow-grid">
			<div
				v-for="flow in sortedFlows"
				:key="flow.id"
				class="flow-card"
				@click="$router.push(`/flows/${flow.id}`)"
			>
				<div class="flow-card-header">
					<v-icon name="account_tree" class="flow-card-icon" />
					<span class="flow-card-name">{{ flow.name || 'Untitled Flow' }}</span>
					<span class="status-badge" :class="statusClass(flow)">{{ flow.status }}</span>
				</div>
				<div class="flow-card-sparkline">
					<div
						v-for="(val, idx) in miniChart(flow.id)"
						:key="idx"
						class="spark-bar"
						:style="{ height: sparkHeight(val, flow.id) + '%' }"
					/>
				</div>
			</div>
			<div class="flow-card new-card" @click="$emit('create')">
				<div class="new-card-content">
					<v-icon name="add" x-large />
					<span class="new-card-label">New Flow</span>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import type { FlowItem } from '../types';
import { useFlowDashboardStats, type TimeRange } from '../composables/use-flow-dashboard-stats';
import KpiCard from './kpi-card.vue';

const props = defineProps<{
	flows: FlowItem[];
	api: any;
}>();

defineEmits<{ create: [] }>();

const VALID_RANGES: TimeRange[] = ['today', '7d', '30d', '12m'];
const stored = localStorage.getItem('bl_flow_timeRange') as TimeRange | null;
const timeRange = ref<TimeRange>(stored && VALID_RANGES.includes(stored) ? stored : '7d');

const {
	totalExecutions,
	errorRate,
	avgDuration,
	activeFlows,
	miniChartData,
	buildAggregateChart,
	fetchExecutionData,
	startPolling,
	stopPolling,
} = useFlowDashboardStats(props.api);

const totalFlowsCount = computed(() => props.flows.length);
const activeFlowsCount = computed(() => activeFlows(timeRange.value));

const totalExec = computed(() => totalExecutions(timeRange.value));
const errorRateVal = computed(() => errorRate(timeRange.value));
const avgDurationVal = computed(() => avgDuration(timeRange.value));

const rangeLabel = computed(() => {
	if (timeRange.value === 'today') return 'today';
	if (timeRange.value === '7d') return '7d';
	if (timeRange.value === '30d') return '30d';
	return '12m';
});

const sortedFlows = computed(() => {
	return [...props.flows].sort((a, b) => statusOrder(a) - statusOrder(b));
});

function statusOrder(flow: FlowItem): number {
	if (flow.status === 'active') return 0;
	if (flow.status === 'draft') return 1;
	return 2;
}

const allFlowIds = computed(() => props.flows.map((f) => f.id));

const chartBars = computed(() => buildAggregateChart(timeRange.value));
const chartEmpty = computed(() => chartBars.value.every((b) => b.total === 0));
const placeholderHeights = [35, 55, 25, 65, 40, 75, 30, 50, 45, 60, 20, 70];

const miniChartCache = ref<Record<string, number[]>>({});

function miniChart(flowId: string): number[] {
	if (!miniChartCache.value[flowId]) {
		miniChartCache.value[flowId] = miniChartData(flowId);
	}
	return miniChartCache.value[flowId];
}

function sparkHeight(val: number, flowId: string): number {
	const data = miniChart(flowId);
	const max = Math.max(1, ...data);
	return Math.max(4, (val / max) * 100);
}

function statusClass(flow: FlowItem): string {
	if (flow.status === 'active') return 'badge-active';
	if (flow.status === 'draft') return 'badge-draft';
	return 'badge-disabled';
}

watch(timeRange, (val) => localStorage.setItem('bl_flow_timeRange', val));

watch(allFlowIds, (ids) => {
	fetchExecutionData(ids);
	miniChartCache.value = {};
}, { immediate: true });

onMounted(() => {
	startPolling(() => allFlowIds.value);
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

.bar-completed .segment-tooltip { background: var(--theme--success, #2ecda7); }
.bar-running .segment-tooltip { background: #4a90d9; }
.bar-failed .segment-tooltip { background: var(--theme--danger, #e35169); }
.bar-segment:hover .segment-tooltip { display: block; }

.bar-completed { background: var(--theme--success, #2ecda7); }
.bar-running { background: #4a90d9; }
.bar-failed { background: var(--theme--danger, #e35169); }
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

.dot-completed { background: var(--theme--success, #2ecda7); }
.dot-running { background: #4a90d9; }
.dot-failed { background: var(--theme--danger, #e35169); }

/* KPI grid */
.kpi-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	gap: 16px;
	margin-bottom: 32px;
}

/* Flow card grid */
.flow-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
	gap: 16px;
}

.flow-card {
	padding: 16px;
	background: var(--theme--background);
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	cursor: pointer;
	transition: border-color 0.15s, box-shadow 0.15s;
}

.flow-card:hover {
	border-color: var(--theme--primary);
	box-shadow: 0 0 0 1px var(--theme--primary);
}

.flow-card-header {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 12px;
}

.flow-card-icon {
	color: var(--theme--foreground-subdued);
}

.flow-card-name {
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

.badge-active {
	background: var(--theme--success-background, rgba(46, 205, 167, 0.1));
	color: var(--theme--success);
}

.badge-draft {
	background: var(--theme--warning-background);
	color: var(--theme--warning);
}

.badge-disabled {
	background: var(--theme--background-subdued);
	color: var(--theme--foreground-subdued);
}

/* Mini sparkline */
.flow-card-sparkline {
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

.flow-card:hover .spark-bar {
	opacity: 1;
}

.new-card {
	border: 2px dashed var(--theme--border-color);
	background: transparent;
	display: flex;
	align-items: center;
	justify-content: center;
	min-height: 100px;
	transition: border-color 0.15s;
}

.new-card:hover {
	border-color: var(--theme--primary);
}

.new-card-content {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;
	color: var(--theme--foreground-subdued);
}

.new-card:hover .new-card-content {
	color: var(--theme--primary);
}

.new-card-label {
	font-size: 13px;
	font-weight: 600;
}
</style>
