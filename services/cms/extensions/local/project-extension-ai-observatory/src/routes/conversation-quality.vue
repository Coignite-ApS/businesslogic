<template>
	<private-view title="Conversation Quality">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="insights" />
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
				<!-- KPI Row -->
				<div class="kpi-grid">
					<div class="kpi-card">
						<div class="kpi-icon"><v-icon name="forum" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Total Conversations ({{ selectedDays }}d)</div>
							<div class="kpi-value">{{ totalConversations }}</div>
						</div>
					</div>
					<div class="kpi-card" :class="{ 'kpi-success': completionRate >= 80, 'kpi-warn': completionRate < 60 }">
						<div class="kpi-icon"><v-icon name="check_circle" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Completion Rate</div>
							<div class="kpi-value">{{ completionRate.toFixed(0) }}%</div>
							<div class="kpi-subtitle">{{ data.outcomes.completed ?? 0 }} completed</div>
						</div>
					</div>
					<div class="kpi-card" :class="{ 'kpi-success': parseFloat(data.tool_success.rate) >= 95, 'kpi-warn': parseFloat(data.tool_success.rate) < 80 }">
						<div class="kpi-icon"><v-icon name="build_circle" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Tool Success Rate</div>
							<div class="kpi-value">{{ data.tool_success.rate }}%</div>
							<div class="kpi-subtitle">{{ data.tool_success.total }} calls, {{ data.tool_success.errors }} errors</div>
						</div>
					</div>
					<div class="kpi-card">
						<div class="kpi-icon"><v-icon name="speed" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Avg Response Time</div>
							<div class="kpi-value">{{ fmtMs(data.response_time.p50) }}</div>
							<div class="kpi-subtitle">P50 · {{ data.response_time.sample_size }} samples</div>
						</div>
					</div>
					<div class="kpi-card">
						<div class="kpi-icon"><v-icon name="message" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Avg Conv. Length</div>
							<div class="kpi-value">{{ data.avg_conversation_length }}</div>
							<div class="kpi-subtitle">messages per conversation</div>
						</div>
					</div>
				</div>

				<!-- Daily Volume Chart -->
				<div class="chart-card">
					<div class="chart-title">Daily Conversations — Last {{ selectedDays }} Days</div>
					<div v-if="data.daily_conversations.length" class="bar-chart">
						<div class="bar-chart-inner">
							<div
								v-for="d in data.daily_conversations"
								:key="d.date"
								class="bar-col"
								:title="d.date + ': ' + d.count + ' conversations'"
							>
								<div class="bar-fill" :style="{ height: barPct(d.count, maxDailyConv) + '%' }" />
							</div>
						</div>
						<div class="bar-labels">
							<span
								v-for="(d, i) in data.daily_conversations"
								:key="'l' + i"
								class="bar-label"
								:class="{ visible: i % 5 === 0 || i === data.daily_conversations.length - 1 }"
							>{{ shortDate(d.date) }}</span>
						</div>
					</div>
					<div v-else class="empty-state">No conversation data in range</div>
				</div>

				<!-- Two-column: outcomes + response times -->
				<div class="two-col">
					<!-- Outcome Breakdown -->
					<div class="chart-card no-margin">
						<div class="chart-title">Outcome Breakdown</div>
						<div v-if="totalConversations > 0" class="outcome-list">
							<div v-for="[outcome, count] in outcomeEntries" :key="outcome" class="outcome-row">
								<div class="outcome-dot" :class="'dot-' + outcome" />
								<div class="outcome-label">{{ outcomeLabel(outcome) }}</div>
								<div class="outcome-bar-wrap">
									<div class="outcome-bar" :class="'bar-' + outcome" :style="{ width: (count / totalConversations * 100) + '%' }" />
								</div>
								<div class="outcome-count">{{ count }}</div>
								<div class="outcome-pct">{{ (count / totalConversations * 100).toFixed(0) }}%</div>
							</div>
						</div>
						<div v-else class="empty-state">No outcomes recorded</div>
					</div>

					<!-- Response Time Percentiles -->
					<div class="chart-card no-margin">
						<div class="chart-title">Response Time Percentiles</div>
						<div v-if="data.response_time.sample_size > 0" class="rt-list">
							<div class="rt-row">
								<span class="rt-pct">P50</span>
								<div class="rt-bar-wrap">
									<div class="rt-bar" :style="{ width: rtBarPct(data.response_time.p50) + '%' }" />
								</div>
								<span class="rt-val">{{ fmtMs(data.response_time.p50) }}</span>
							</div>
							<div class="rt-row">
								<span class="rt-pct">P95</span>
								<div class="rt-bar-wrap">
									<div class="rt-bar rt-bar-warn" :style="{ width: rtBarPct(data.response_time.p95) + '%' }" />
								</div>
								<span class="rt-val">{{ fmtMs(data.response_time.p95) }}</span>
							</div>
							<div class="rt-row">
								<span class="rt-pct">P99</span>
								<div class="rt-bar-wrap">
									<div class="rt-bar rt-bar-danger" :style="{ width: rtBarPct(data.response_time.p99) + '%' }" />
								</div>
								<span class="rt-val">{{ fmtMs(data.response_time.p99) }}</span>
							</div>
							<div class="rt-sample">Based on {{ data.response_time.sample_size.toLocaleString() }} requests</div>
						</div>
						<div v-else class="empty-state">No response time data<br><small>response_time_ms not yet populated</small></div>
					</div>
				</div>
			</template>

			<v-info v-else-if="error" type="danger" icon="error" :title="error" center />
		</div>

		<template #sidebar>
			<sidebar-detail id="info" icon="info" title="Conversation Quality">
				<div class="sidebar-info">
					<p>Conversation outcomes, response time percentiles, and tool success rates over the selected period.</p>
				</div>
			</sidebar-detail>
		</template>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { useObservatoryApi } from '../composables/use-observatory-api';
import type { QualityMetrics } from '../types';
import ObservatoryNavigation from '../components/observatory-navigation.vue';

const api = useApi();
const { loading, error, fetchQualityMetrics } = useObservatoryApi(api);
const data = ref<QualityMetrics | null>(null);

const dateOptions = [
	{ label: '7d', value: 7 },
	{ label: '30d', value: 30 },
	{ label: '90d', value: 90 },
];
const selectedDays = ref(30);

async function selectDays(days: number) {
	selectedDays.value = days;
	data.value = await fetchQualityMetrics(days);
}

const totalConversations = computed(() =>
	Object.values(data.value?.outcomes ?? {}).reduce((s, v) => s + v, 0)
);

const completionRate = computed(() => {
	if (!totalConversations.value) return 0;
	return ((data.value?.outcomes.completed ?? 0) / totalConversations.value) * 100;
});

const maxDailyConv = computed(() =>
	Math.max(1, ...(data.value?.daily_conversations ?? []).map(d => d.count))
);

const outcomeEntries = computed(() =>
	Object.entries(data.value?.outcomes ?? {}).sort((a, b) => b[1] - a[1])
);

function barPct(val: number, max: number): number {
	return Math.max(2, (val / max) * 100);
}

const rtMax = computed(() => data.value?.response_time.p99 || 1);

function rtBarPct(ms: number): number {
	return Math.min(100, (ms / rtMax.value) * 100);
}

function fmtMs(ms: number): string {
	if (!ms) return '–';
	if (ms >= 60000) return (ms / 60000).toFixed(1) + 'm';
	if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
	return ms + 'ms';
}

function shortDate(iso: string): string {
	const d = new Date(iso);
	return (d.getMonth() + 1) + '/' + d.getDate();
}

function outcomeLabel(outcome: string): string {
	const labels: Record<string, string> = {
		completed: 'Completed',
		abandoned: 'Abandoned',
		error: 'Error',
		budget_exhausted: 'Budget Exhausted',
		active: 'Active',
	};
	return labels[outcome] ?? outcome;
}

onMounted(async () => {
	data.value = await fetchQualityMetrics(selectedDays.value);
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

.kpi-card.kpi-success { border-color: var(--theme--success); }
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

.chart-card {
	background: var(--theme--background);
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	padding: 20px;
	margin-bottom: 32px;
}

.chart-card.no-margin { margin-bottom: 0; }

.chart-title {
	font-size: 13px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	margin-bottom: 12px;
}

.bar-chart {
	display: flex;
	flex-direction: column;
	height: 160px;
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

.bar-label.visible { color: var(--theme--foreground-subdued); }

.two-col {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
	gap: 24px;
	margin-bottom: 32px;
}

/* Outcome breakdown */
.outcome-list {
	display: flex;
	flex-direction: column;
	gap: 14px;
}

.outcome-row {
	display: flex;
	align-items: center;
	gap: 10px;
}

.outcome-dot {
	width: 10px;
	height: 10px;
	border-radius: 50%;
	flex-shrink: 0;
}

.dot-completed { background: var(--theme--success, #2ecda7); }
.dot-abandoned { background: var(--theme--warning, #ecb95d); }
.dot-error { background: var(--theme--danger, #e35169); }
.dot-budget_exhausted { background: var(--theme--danger, #e35169); opacity: 0.6; }
.dot-active { background: var(--theme--primary); }

.outcome-label {
	width: 110px;
	font-size: 13px;
	color: var(--theme--foreground);
	flex-shrink: 0;
}

.outcome-bar-wrap {
	flex: 1;
	height: 8px;
	background: var(--theme--border-color);
	border-radius: 4px;
	overflow: hidden;
}

.outcome-bar {
	height: 100%;
	border-radius: 4px;
	transition: width 0.3s;
}

.bar-completed { background: var(--theme--success, #2ecda7); }
.bar-abandoned { background: var(--theme--warning, #ecb95d); }
.bar-error { background: var(--theme--danger, #e35169); }
.bar-budget_exhausted { background: var(--theme--danger, #e35169); opacity: 0.6; }
.bar-active { background: var(--theme--primary); }

.outcome-count {
	width: 40px;
	text-align: right;
	font-size: 13px;
	font-weight: 600;
	color: var(--theme--foreground);
}

.outcome-pct {
	width: 36px;
	text-align: right;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

/* Response time */
.rt-list {
	display: flex;
	flex-direction: column;
	gap: 16px;
}

.rt-row {
	display: flex;
	align-items: center;
	gap: 12px;
}

.rt-pct {
	width: 28px;
	font-size: 11px;
	font-weight: 700;
	color: var(--theme--foreground-subdued);
	text-transform: uppercase;
}

.rt-bar-wrap {
	flex: 1;
	height: 10px;
	background: var(--theme--border-color);
	border-radius: 5px;
	overflow: hidden;
}

.rt-bar {
	height: 100%;
	background: var(--theme--primary);
	border-radius: 5px;
	transition: width 0.3s;
}

.rt-bar-warn { background: var(--theme--warning, #ecb95d); }
.rt-bar-danger { background: var(--theme--danger, #e35169); }

.rt-val {
	width: 56px;
	text-align: right;
	font-size: 13px;
	font-weight: 600;
	color: var(--theme--foreground);
}

.rt-sample {
	font-size: 11px;
	color: var(--theme--foreground-subdued);
	margin-top: 4px;
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
