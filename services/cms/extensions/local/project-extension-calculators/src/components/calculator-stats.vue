<template>
	<div class="stats-section">
		<div class="chart-section">
			<div class="chart-toolbar">
				<div class="link-toggle">
					<a :class="{ active: timeRange === '7d' }" @click="timeRange = '7d'">7 days</a>
					<span class="toggle-sep">|</span>
					<a :class="{ active: timeRange === '12m' }" @click="timeRange = '12m'">12 months</a>
				</div>
				<div class="toolbar-spacer" />
				<div class="link-toggle">
					<a :class="{ active: envFilter === 'test' }" @click="envFilter = 'test'">Test</a>
					<span class="toggle-sep">|</span>
					<a :class="{ active: envFilter === 'live' }" @click="envFilter = 'live'">Live</a>
				</div>
			</div>

			<div class="chart">
				<div class="chart-gradient" />
				<!-- Placeholder bars when no data -->
				<template v-if="chartEmpty">
					<div v-for="(bar, idx) in chartBars" :key="bar.label" class="chart-bar-group">
						<div class="chart-bar-wrapper" :style="{ height: placeholderHeights[idx % placeholderHeights.length] + '%' }">
							<div class="chart-bar">
								<div class="bar-segment bar-placeholder" style="flex: 1" />
							</div>
						</div>
					</div>
				</template>
				<!-- Real bars -->
				<template v-else>
					<div v-for="bar in chartBars" :key="bar.label" class="chart-bar-group">
						<div class="chart-bar-wrapper" :style="{ height: bar.heightPct + '%' }">
							<div class="chart-bar-count">{{ bar.total || '' }}</div>
							<div class="chart-bar">
								<div
									v-if="bar.error"
									class="bar-segment bar-error"
									:style="{ flex: bar.error }"
									@click="openErrorDrawer(bar)"
								>
									<span class="segment-tooltip">{{ bar.error }}</span>
								</div>
								<div
									v-if="bar.cached"
									class="bar-segment bar-cached"
									:style="{ flex: bar.cached }"
								>
									<span class="segment-tooltip">{{ bar.cached }}</span>
								</div>
								<div
									v-if="bar.success"
									class="bar-segment bar-success"
									:style="{ flex: bar.success }"
								>
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
				<span class="legend-item">
					<span class="legend-dot dot-success" :class="{ pulsing: successPulse }" />
					Success
				</span>
				<span class="legend-item">
					<span class="legend-dot dot-error" :class="{ pulsing: errorPulse }" />
					Error
				</span>
			</div>
		</div>

		<v-drawer v-model="showErrors" :title="'Errors — ' + errorDrawerLabel" icon="error" @cancel="showErrors = false">
			<div class="error-drawer-content">
				<div v-if="errorRecords.length === 0" class="error-empty">No errors for this period.</div>
				<div v-for="(rec, idx) in errorRecords" :key="idx" class="error-row">
					<div class="error-time">{{ formatTime(rec.timestamp) }}</div>
					<div class="error-msg">{{ rec.error_message || 'Unknown error' }}</div>
				</div>
			</div>
		</v-drawer>
	</div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import type { CallRecord } from '../types';

const POLL_INTERVAL = 5000;

const props = defineProps<{
	calculatorId: string;
	activated?: boolean;
}>();

const api = useApi();
const records = ref<CallRecord[]>([]);
const live = ref(false);
let pollTimer: ReturnType<typeof setInterval> | null = null;

const timeRange = ref<'7d' | '12m'>('7d');
const envFilter = ref<'live' | 'test'>(props.activated ? 'live' : 'test');

// Pulse state
const successPulse = ref(false);
const errorPulse = ref(false);
let prevSuccessCount = -1;
let prevErrorCount = -1;

// Reset pulse counters on filter change
watch(envFilter, () => { prevSuccessCount = -1; prevErrorCount = -1; });
let successPulseTimer: ReturnType<typeof setTimeout> | null = null;
let errorPulseTimer: ReturnType<typeof setTimeout> | null = null;

const showErrors = ref(false);
const errorDrawerLabel = ref('');
let errorBucketStart = 0;
let errorBucketEnd = 0;

async function fetchRecords() {
	const since = new Date();
	since.setMonth(since.getMonth() - 12);
	try {
		const res = await api.get('/items/calculator_calls', {
			params: {
				'filter[calculator][_eq]': props.calculatorId,
				'filter[timestamp][_gte]': since.toISOString(),
				fields: 'timestamp,error,cached,response_time_ms,error_message,test',
				sort: '-timestamp',
				limit: -1,
			},
		});
		records.value = res.data.data || [];
		live.value = true;
	} catch {
		live.value = false;
	}
}

function startPolling() {
	pollTimer = setInterval(fetchRecords, POLL_INTERVAL);
}

onMounted(() => {
	fetchRecords();
	startPolling();
});

onBeforeUnmount(() => {
	if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
	if (successPulseTimer) clearTimeout(successPulseTimer);
	if (errorPulseTimer) clearTimeout(errorPulseTimer);
});

// Filter records by environment
const filteredRecords = computed(() => {
	const isTest = envFilter.value === 'test';
	return records.value.filter((r) => !!r.test === isTest);
});

// Detect new data and trigger pulse
watch(filteredRecords, (recs) => {
	let sc = 0, ec = 0;
	for (const r of recs) {
		if (r.error) ec++;
		else sc++;
	}
	if (prevSuccessCount >= 0 && sc > prevSuccessCount) {
		successPulse.value = true;
		if (successPulseTimer) clearTimeout(successPulseTimer);
		successPulseTimer = setTimeout(() => { successPulse.value = false; }, 2000);
	}
	if (prevErrorCount >= 0 && ec > prevErrorCount) {
		errorPulse.value = true;
		if (errorPulseTimer) clearTimeout(errorPulseTimer);
		errorPulseTimer = setTimeout(() => { errorPulse.value = false; }, 2000);
	}
	prevSuccessCount = sc;
	prevErrorCount = ec;
});

// Helpers
function tsMs(ts: string): number {
	return new Date(ts.endsWith('Z') ? ts : ts + 'Z').getTime();
}

// Chart bar type
interface ChartBar {
	label: string;
	success: number;
	cached: number;
	error: number;
	total: number;
	heightPct: number;
	start: number;
	end: number;
}

const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function buildBars(buckets: Array<{ start: number; end: number; label: string }>, recs: CallRecord[]): ChartBar[] {
	const counts = buckets.map((b) => {
		let success = 0, cached = 0, error = 0;
		for (const r of recs) {
			const t = tsMs(r.timestamp);
			if (t >= b.start && t < b.end) {
				if (r.error) error++;
				else if (r.cached) cached++;
				else success++;
			}
		}
		return { label: b.label, success, cached, error, total: success + cached + error, start: b.start, end: b.end };
	});
	const maxTotal = Math.max(1, ...counts.map((c) => c.total));
	return counts.map((c) => ({ ...c, heightPct: (c.total / maxTotal) * 100 }));
}

const chart7d = computed<ChartBar[]>(() => {
	const now = new Date();
	const buckets: Array<{ start: number; end: number; label: string }> = [];
	for (let i = 6; i >= 0; i--) {
		const d = new Date(now);
		d.setDate(d.getDate() - i);
		d.setHours(0, 0, 0, 0);
		const end = new Date(d);
		end.setDate(end.getDate() + 1);
		buckets.push({ start: d.getTime(), end: end.getTime(), label: dayLabels[d.getDay()] });
	}
	return buildBars(buckets, filteredRecords.value);
});

const chart12m = computed<ChartBar[]>(() => {
	const now = new Date();
	const buckets: Array<{ start: number; end: number; label: string }> = [];
	for (let i = 11; i >= 0; i--) {
		const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
		const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
		buckets.push({ start: d.getTime(), end: end.getTime(), label: monthLabels[d.getMonth()] });
	}
	return buildBars(buckets, filteredRecords.value);
});

const chartBars = computed(() => timeRange.value === '7d' ? chart7d.value : chart12m.value);
const chartEmpty = computed(() => chartBars.value.every(b => b.total === 0));
const placeholderHeights = [35, 55, 25, 65, 40, 75, 30, 50, 45, 60, 20, 70];

function openErrorDrawer(bar: ChartBar) {
	if (!bar.error) return;
	errorDrawerLabel.value = bar.label;
	errorBucketStart = bar.start;
	errorBucketEnd = bar.end;
	showErrors.value = true;
}

const errorRecords = computed(() => {
	if (!showErrors.value) return [];
	return filteredRecords.value.filter((r) => {
		if (!r.error) return false;
		const t = tsMs(r.timestamp);
		return t >= errorBucketStart && t < errorBucketEnd;
	});
});

function formatTime(ts: string): string {
	const d = new Date(ts.endsWith('Z') ? ts : ts + 'Z');
	return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
</script>

<style scoped>
.stats-section {
	margin-bottom: 24px;
}

/* Chart */
.chart-section {
	margin-top: 8px;
}

/* Toolbar with button groups */
.chart-toolbar {
	display: flex;
	align-items: center;
	margin-bottom: 12px;
}

.toolbar-spacer {
	flex: 1;
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
	height: 280px;
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

.bar-success .segment-tooltip {
	background: var(--theme--success, #2ecda7);
}

.bar-cached .segment-tooltip {
	background: #22a687;
}

.bar-error .segment-tooltip {
	background: var(--theme--danger, #e35169);
}

.bar-segment:hover .segment-tooltip {
	display: block;
}

.bar-success {
	background: var(--theme--success, #2ecda7);
}

.bar-cached {
	background: #22a687;
}

.bar-error {
	background: var(--theme--danger, #e35169);
	cursor: pointer;
}

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

/* Legend with pulsating dots */
.chart-legend {
	display: flex;
	justify-content: flex-end;
	gap: 16px;
	margin-top: 16px;
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

.dot-success {
	background: var(--theme--success, #2ecda7);
}

.dot-error {
	background: var(--theme--danger, #e35169);
}

.legend-dot.pulsing {
	animation: pulse-ring 1s ease-out 2;
}

@keyframes pulse-ring {
	0% {
		box-shadow: 0 0 0 0 currentColor;
		opacity: 1;
	}
	70% {
		box-shadow: 0 0 0 6px transparent;
		opacity: 0.7;
	}
	100% {
		box-shadow: 0 0 0 0 transparent;
		opacity: 1;
	}
}

.dot-success.pulsing {
	color: var(--theme--success, #2ecda7);
	animation: pulse-success 1s ease-out 2;
}

.dot-error.pulsing {
	color: var(--theme--danger, #e35169);
	animation: pulse-error 1s ease-out 2;
}

@keyframes pulse-success {
	0% {
		box-shadow: 0 0 0 0 var(--theme--success, rgba(46, 205, 167, 0.7));
	}
	70% {
		box-shadow: 0 0 0 8px rgba(46, 205, 167, 0);
	}
	100% {
		box-shadow: 0 0 0 0 rgba(46, 205, 167, 0);
	}
}

@keyframes pulse-error {
	0% {
		box-shadow: 0 0 0 0 var(--theme--danger, rgba(227, 81, 105, 0.7));
	}
	70% {
		box-shadow: 0 0 0 8px rgba(227, 81, 105, 0);
	}
	100% {
		box-shadow: 0 0 0 0 rgba(227, 81, 105, 0);
	}
}

/* Error drawer */
.error-drawer-content {
	padding: 20px;
}

.error-empty {
	color: var(--theme--foreground-subdued);
	font-style: italic;
}

.error-row {
	padding: 12px 0;
	border-bottom: 1px solid var(--theme--border-color);
}

.error-row:last-child {
	border-bottom: none;
}

.error-time {
	font-size: 12px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	margin-bottom: 4px;
}

.error-msg {
	font-size: 14px;
	color: var(--theme--danger, #e35169);
	word-break: break-word;
}
</style>
