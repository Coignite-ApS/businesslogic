<template>
	<private-view title="Infrastructure">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="admin_panel_settings" />
			</v-button>
		</template>

		<template #navigation>
			<admin-navigation />
		</template>

		<template #actions>
			<v-button rounded icon secondary @click="refreshAll" :loading="statsLoading">
				<v-icon name="refresh" />
			</v-button>
		</template>

		<div class="admin-content">
			<!-- Live Cluster Overview -->
			<div class="section">
				<div class="section-header">
					<h3 class="section-title">Cluster Overview</h3>
					<div class="auto-refresh">
						<label class="toggle-label">
							<input type="checkbox" v-model="autoRefresh" @change="toggleAutoRefresh" />
							Auto-refresh (30s)
						</label>
					</div>
				</div>

				<div v-if="statsLoading && !serverStats" class="loading-state">
					<v-progress-circular indeterminate />
				</div>

				<template v-else-if="serverStats">
					<!-- Status bar -->
					<div class="status-bar" :class="'status-' + serverStats.status">
						<v-icon :name="statusIcon" />
						<span class="status-text">{{ serverStats.status.toUpperCase() }}</span>
						<span class="status-detail">{{ instanceCount }} instance{{ instanceCount !== 1 ? 's' : '' }} · {{ cluster.totalWorkers ?? 0 }} workers</span>
						<span class="status-time">Up for {{ uptimeLabel }} · {{ responseTime }}ms</span>
					</div>

					<!-- KPI cards -->
					<div class="kpi-grid">
						<kpi-card
							label="Heap Usage"
							:value="Math.round(cluster.totalHeapUsedMB ?? 0)"
							:max="Math.round(cluster.totalHeapTotalMB ?? 0)"
							icon="memory"
							suffix=" MB"
							:progress="(cluster.totalHeapTotalMB ?? 0) ? ((cluster.totalHeapUsedMB ?? 0) / (cluster.totalHeapTotalMB ?? 1)) * 100 : 0"
							:icon-variant="heapPct > 85 ? 'danger' : heapPct > 70 ? 'warning' : 'success'"
							:subtitle="heapPct + '% — ' + (heapPct > 85 ? 'critical, scale up now' : heapPct > 70 ? 'getting high, consider scaling' : 'healthy')"
						/>
						<kpi-card
							label="Concurrent Capacity"
							:value="cluster.totalQueuePending ?? 0"
							:max="cluster.totalQueueMax ?? 0"
							icon="queue"
							:progress="clusterQueuePct"
							:subtitle="(cluster.totalQueuePending ?? 0) + ' in-flight — new requests get 503 after ' + (cluster.totalQueueMax ?? 0)"
							:icon-variant="clusterQueuePct > 80 ? 'danger' : clusterQueuePct > 50 ? 'warning' : 'success'"
						/>
						<kpi-card
							label="Worker Threads"
							:value="busyWorkerCount"
							:max="cluster.totalWorkers ?? 0"
							icon="engineering"
							:progress="(cluster.totalWorkers ?? 0) ? (busyWorkerCount / (cluster.totalWorkers ?? 1)) * 100 : 0"
							:subtitle="busyWorkerCount + ' hold ' + activeCalcCount + ' calculators — ' + ((cluster.totalWorkers ?? 0) - busyWorkerCount) + ' idle threads share the load'"
							:icon-variant="(cluster.totalWorkers ?? 0) && busyWorkerCount >= (cluster.totalWorkers ?? 0) ? 'warning' : 'success'"
						/>
						<kpi-card
							label="Response Time"
							:value="responseTime"
							icon="speed"
							suffix="ms"
							:icon-variant="responseTime > 1000 ? 'danger' : responseTime > 500 ? 'warning' : 'success'"
							:subtitle="responseTime > 1000 ? 'slow — server may be overloaded' : responseTime > 500 ? 'elevated — watch for degradation' : 'healthy — fast responses'"
						/>
					</div>

					<!-- Memory distribution stacked bar -->
					<div class="memory-section">
						<h4 class="sub-title">JS Heap per Calculator — which calculators use most memory?</h4>
						<div class="section-hint">Largest segments are candidates for optimization. This is JS heap only — native/Rust memory is measured separately in Build RSS below.</div>
						<div v-if="memoryDistribution.length" class="stacked-bar">
							<div
								v-for="(seg, idx) in memoryDistribution"
								:key="seg.id"
								class="stacked-segment"
								:style="{ width: seg.pct + '%', background: segmentColor(idx) }"
								:title="seg.id + ': ' + seg.heapMB.toFixed(1) + ' MB (' + seg.pct.toFixed(1) + '%)'"
							/>
						</div>
						<div v-if="memoryDistribution.length" class="stacked-legend">
							<span v-for="(seg, idx) in memoryDistribution.slice(0, 10)" :key="seg.id" class="legend-item">
								<span class="legend-dot" :style="{ background: segmentColor(idx) }" />
								{{ seg.id }} ({{ seg.heapMB.toFixed(1) }} MB)
							</span>
							<span v-if="memoryDistribution.length > 10" class="legend-item">+{{ memoryDistribution.length - 10 }} more</span>
						</div>
						<div class="heap-summary">
							{{ memoryDistribution.length }} in workers ({{ totalCalcHeapMB.toFixed(1) }} MB) · {{ (cluster.totalCalculators ?? 0) - memoryDistribution.length }} in Redis cache (instant swap, no heap) · {{ ((cluster.totalHeapUsedMB ?? 0) - totalCalcHeapMB).toFixed(1) }} MB runtime overhead
						</div>
					</div>
				</template>

				<v-info v-else-if="statsError" type="warning" icon="warning" :title="statsError" center />
			</div>

			<!-- Historical Charts -->
			<div class="section">
				<div class="section-header">
					<h3 class="section-title">Health History</h3>
					<div class="range-toggle">
						<v-button
							x-small
							:secondary="historyRange !== '24h'"
							:disabled="historyRange === '24h'"
							@click="setRange('24h')"
						>24h</v-button>
						<v-button
							x-small
							:secondary="historyRange !== '7d'"
							:disabled="historyRange === '7d'"
							@click="setRange('7d')"
						>7 days</v-button>
					</div>
				</div>

				<div v-if="historyLoading" class="loading-state-sm">
					<v-progress-circular indeterminate />
				</div>

				<template v-else-if="historySnapshots.length">
					<div class="charts-grid">
						<div class="chart-card">
							<mini-chart
								title="Heap Usage"
								type="line"
								unit=" MB"
								:data="heapChart"
								:height="200"
							/>
						</div>
						<div class="chart-card">
							<mini-chart
								title="Response Time"
								type="line"
								unit="ms"
								:data="responseTimeChart"
								:height="200"
							/>
						</div>
					</div>

					<!-- Status timeline -->
					<div class="status-timeline">
						<div class="timeline-header">
							<h4 class="sub-title">Uptime — {{ uptimePct }}% over {{ historyRange === '24h' ? 'last 24 hours' : 'last 7 days' }}</h4>
							<div class="timeline-legend">
								<span class="tl-legend-item"><span class="tl-dot status-bg-ok" /> OK</span>
								<span class="tl-legend-item"><span class="tl-dot status-bg-degraded" /> Degraded</span>
								<span class="tl-legend-item"><span class="tl-dot status-bg-error" /> Error</span>
							</div>
						</div>
						<div class="timeline-bar">
							<div
								v-for="(s, idx) in statusTimeline"
								:key="idx"
								class="timeline-segment"
								:class="'status-bg-' + s.status"
								:style="{ flex: s.count }"
								:title="s.label + ': ' + s.status + ' (' + s.count + ' checks)'"
							/>
						</div>
						<div class="timeline-labels">
							<span>{{ timelineStartFull }}</span>
							<span>{{ timelineEndFull }}</span>
						</div>
					</div>
				</template>

				<div v-else class="no-data">No health snapshots yet. Snapshots are collected every {{ snapshotInterval }} minutes.</div>
			</div>

			<!-- Calculator Profiles -->
			<div class="section">
				<h3 class="section-title">Calculator Profiles</h3>
				<div class="section-hint">Build-time metrics for each calculator. Build RSS = total process memory used during build (JS + native/Rust). Large values indicate heavy Excel models — consider splitting sheets.</div>
				<div v-if="profilesLoading" class="loading-state-sm">
					<v-progress-circular indeterminate />
				</div>
				<template v-else-if="profiles.length">
					<div class="profile-table">
						<div class="profile-header">
							<div class="col-pname">Calculator</div>
							<div>Sheets</div>
							<div>Formulas</div>
							<div>Cells</div>
							<div>Est. Memory</div>
							<div>Build (ms)</div>
							<div>Build RSS</div>
							<div>Remarks</div>
						</div>
						<div v-for="p in profiles" :key="p.id" class="profile-row">
							<div class="col-pname">
								<span class="profile-calc-name">{{ p.name || p.id }}</span>
							</div>
							<div>{{ p.profile?.sheetCount || '—' }}</div>
							<div>{{ p.profile?.formulaCount || '—' }}</div>
							<div>{{ p.profile?.totalCells || '—' }}</div>
							<div>{{ formatProfileMB(p.profile?.estimatedMemoryMB) }}</div>
							<div>
								<span v-if="p.profile?.buildMs" class="measured">{{ p.profile.buildMs }}</span>
								<span v-else-if="p.profile?.estimatedBuildMs" class="estimated">~{{ p.profile.estimatedBuildMs }}</span>
								<span v-else>—</span>
							</div>
							<div>{{ p.profile?.heapDeltaMB ? p.profile.heapDeltaMB.toFixed(1) + ' MB' : '—' }}</div>
							<div class="remark-badges">
								<span
									v-for="r in (p.profile?.remarks || [])"
									:key="r.code"
									class="remark-badge"
									:class="'remark-' + r.level"
									:title="r.message"
								>{{ r.code }}</span>
								<span v-if="p.unresolved_functions?.length"
									class="remark-badge remark-warning"
									:title="'Unsupported: ' + p.unresolved_functions.map((f: any) => f.name).join(', ')"
								>UNSUPPORTED_FN</span>
								<span v-if="!p.profile?.remarks?.length && !p.unresolved_functions?.length">—</span>
							</div>
						</div>
					</div>
				</template>
				<div v-else class="no-data">No calculator profiles found.</div>
			</div>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { useAdminApi } from '../composables/use-admin-api';
import { useServerStats } from '../composables/use-health';
import AdminNavigation from '../components/admin-navigation.vue';
import KpiCard from '../components/kpi-card.vue';
import MiniChart from '../components/mini-chart.vue';
import type { ServerStatsResponse, ServerStatsCluster } from '../types';

const api = useApi();
const { stats, loading: statsLoading, error: statsError, responseTime, fetchStats, startPolling, stopPolling } = useServerStats(api);
const { fetchHealthHistory, fetchCalculators } = useAdminApi(api);

const autoRefresh = ref(true);
const historyRange = ref<'24h' | '7d'>('24h');
const historyDays = computed(() => historyRange.value === '24h' ? 1 : 7);
const snapshotInterval = ref(5);
const historySnapshots = ref<any[]>([]);
const historyLoading = ref(false);

const profiles = ref<any[]>([]);
const profilesLoading = ref(false);

const serverStats = computed(() => stats.value as ServerStatsResponse | null);
const cluster = computed<ServerStatsCluster>(() => serverStats.value?.cluster || {} as ServerStatsCluster);
const instanceCount = computed(() => cluster.value.instances ?? Object.keys(serverStats.value?.instances || {}).length);

const statusIcon = computed(() => {
	switch (serverStats.value?.status) {
		case 'ok': return 'check_circle';
		case 'degraded': return 'warning';
		case 'error': return 'error';
		default: return 'help';
	}
});

// Count unique calculators actively assigned to workers
const activeCalcCount = computed(() => {
	if (!serverStats.value?.instances) return 0;
	const ids = new Set<string>();
	for (const inst of Object.values(serverStats.value.instances)) {
		if (!inst.workers) continue;
		for (const w of inst.workers) {
			for (const cid of (w.calculatorIds || [])) ids.add(cid);
		}
	}
	return ids.size;
});

const busyWorkerCount = computed(() => {
	if (!serverStats.value?.instances) return 0;
	let count = 0;
	for (const inst of Object.values(serverStats.value.instances)) {
		if (!inst.workers) continue;
		for (const w of inst.workers) {
			if (w.calculatorIds?.length) count++;
		}
	}
	return count;
});

const heapPct = computed(() => {
	if (!cluster.value.totalHeapTotalMB) return 0;
	return Math.round(((cluster.value.totalHeapUsedMB ?? 0) / cluster.value.totalHeapTotalMB) * 100);
});

const clusterQueuePct = computed(() => {
	if (!cluster.value.totalQueueMax) return 0;
	return Math.round(((cluster.value.totalQueuePending || 0) / cluster.value.totalQueueMax) * 100);
});

// Memory distribution
const memoryDistribution = computed(() => {
	if (!serverStats.value?.instances) return [];
	const calcHeap: Record<string, number> = {};

	for (const inst of Object.values(serverStats.value.instances)) {
		if (!inst.workers) continue;
		for (const w of inst.workers) {
			const heapPerCalc = w.calculatorIds?.length ? w.heapUsedMB / w.calculatorIds.length : 0;
			for (const cid of (w.calculatorIds || [])) {
				calcHeap[cid] = (calcHeap[cid] || 0) + heapPerCalc;
			}
		}
	}

	const totalHeap = cluster.value.totalHeapUsedMB || 1;
	return Object.entries(calcHeap)
		.map(([id, heapMB]) => ({ id, heapMB, pct: (heapMB / totalHeap) * 100 }))
		.sort((a, b) => b.heapMB - a.heapMB);
});

const totalCalcHeapMB = computed(() => memoryDistribution.value.reduce((sum, s) => sum + s.heapMB, 0));

const SEGMENT_COLORS = [
	'#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6',
	'#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#a855f7',
	'#eab308', '#3b82f6', '#10b981', '#e11d48', '#7c3aed',
];
function segmentColor(idx: number) {
	return SEGMENT_COLORS[idx % SEGMENT_COLORS.length];
}

// Uptime — find earliest consecutive 'ok' status from latest snapshot backwards
const uptimeLabel = computed(() => {
	if (!historySnapshots.value.length) return '—';
	// Find the first non-ok going backwards from latest
	let oldestOk = historySnapshots.value[historySnapshots.value.length - 1];
	for (let i = historySnapshots.value.length - 1; i >= 0; i--) {
		if (historySnapshots.value[i].status !== 'ok') break;
		oldestOk = historySnapshots.value[i];
	}
	const ms = Date.now() - new Date(oldestOk.date_created).getTime();
	if (ms < 3600000) return Math.round(ms / 60000) + 'm';
	if (ms < 86400000) return Math.round(ms / 3600000) + 'h';
	return Math.round(ms / 86400000) + 'd';
});

const uptimePct = computed(() => {
	if (!historySnapshots.value.length) return 0;
	const okCount = historySnapshots.value.filter(s => s.status === 'ok').length;
	return Math.round((okCount / historySnapshots.value.length) * 100);
});

const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Aggregate snapshots by day — always returns 7 points (one per day), filling gaps with 0
function aggregateByDay(snapshots: any[], field: string): { label: string; primary: number }[] {
	const buckets: Record<string, { sum: number; count: number }> = {};
	for (const s of snapshots) {
		const d = new Date(s.date_created);
		const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
		if (!buckets[key]) buckets[key] = { sum: 0, count: 0 };
		buckets[key].sum += (s[field] || 0);
		buckets[key].count++;
	}
	// Build 7 days from 6 days ago to today
	const result: { label: string; primary: number }[] = [];
	for (let i = 6; i >= 0; i--) {
		const d = new Date();
		d.setDate(d.getDate() - i);
		const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
		const b = buckets[key];
		result.push({
			label: weekDays[d.getDay()],
			primary: b ? Math.round(b.sum / b.count) : 0,
		});
	}
	return result;
}

// Historical chart data
const responseTimeChart = computed(() => {
	if (historyRange.value === '7d') return aggregateByDay(historySnapshots.value, 'response_time_ms');
	return historySnapshots.value.map(s => ({
		label: formatChartLabel(s.date_created),
		primary: s.response_time_ms || 0,
	}));
});

const heapChart = computed(() => {
	if (historyRange.value === '7d') return aggregateByDay(historySnapshots.value, 'heap_used_mb');
	return historySnapshots.value.map(s => ({
		label: formatChartLabel(s.date_created),
		primary: s.heap_used_mb || 0,
	}));
});

function formatChartLabel(dateStr: string): string {
	const d = new Date(dateStr);
	return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function setRange(range: '24h' | '7d') {
	historyRange.value = range;
	loadHistory();
}

const statusTimeline = computed(() => {
	if (!historySnapshots.value.length) return [];
	const groups: { status: string; count: number; label: string }[] = [];
	for (const s of historySnapshots.value) {
		const status = s.status || 'unknown';
		const d = new Date(s.date_created);
		const label = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
		if (groups.length && groups[groups.length - 1].status === status) {
			groups[groups.length - 1].count++;
		} else {
			groups.push({ status, count: 1, label });
		}
	}
	return groups;
});

const timelineStart = computed(() => {
	if (!historySnapshots.value.length) return '';
	return formatTime(new Date(historySnapshots.value[0].date_created));
});

const timelineEnd = computed(() => {
	if (!historySnapshots.value.length) return '';
	return formatTime(new Date(historySnapshots.value[historySnapshots.value.length - 1].date_created));
});

function formatDateTime(date: Date): string {
	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
		' ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

const timelineStartFull = computed(() => {
	if (!historySnapshots.value.length) return '';
	return formatDateTime(new Date(historySnapshots.value[0].date_created));
});

const timelineEndFull = computed(() => {
	if (!historySnapshots.value.length) return '';
	return formatDateTime(new Date(historySnapshots.value[historySnapshots.value.length - 1].date_created));
});

function toggleAutoRefresh() {
	if (autoRefresh.value) startPolling(30000);
	else stopPolling();
}

async function loadHistory() {
	historyLoading.value = true;
	const result = await fetchHealthHistory(historyDays.value);
	if (result) historySnapshots.value = result.data;
	historyLoading.value = false;
}

async function loadProfiles() {
	profilesLoading.value = true;
	const result = await fetchCalculators({ limit: 100 });
	if (result) profiles.value = result.data.filter((c: any) => c.profile);
	profilesLoading.value = false;
}

async function refreshAll() {
	await fetchStats();
	await Promise.all([loadHistory(), loadProfiles()]);
}

function formatProfileMB(mb: number | undefined): string {
	if (!mb) return '—';
	return mb < 1 ? '<1 MB' : mb.toFixed(1) + ' MB';
}

function formatTime(date: Date): string {
	return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

onMounted(() => {
	if (autoRefresh.value) startPolling(30000);
	else fetchStats();
	loadHistory();
	loadProfiles();
});

onBeforeUnmount(() => stopPolling());
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

.loading-state-sm {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 120px;
}

.section {
	margin-bottom: 32px;
}

.section-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 16px;
}

.section-title {
	font-size: 14px;
	font-weight: 600;
}

.sub-title {
	font-size: 13px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	margin-bottom: 8px;
	margin-top: 16px;
}

.section-hint {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	margin-bottom: 12px;
	line-height: 1.5;
	opacity: 0.8;
}

.auto-refresh {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
}

.toggle-label {
	display: flex;
	align-items: center;
	gap: 6px;
	cursor: pointer;
}

/* KPI grid */
.kpi-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	gap: 16px;
	margin-bottom: 24px;
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

/* Status bar */
.status-bar {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 12px 16px;
	border-radius: var(--theme--border-radius);
	margin-bottom: 16px;
	font-weight: 600;
}

.status-ok { background: var(--theme--success-background, rgba(46, 205, 167, 0.1)); color: var(--theme--success); }
.status-degraded { background: var(--theme--warning-background); color: var(--theme--warning); }
.status-error, .status-unknown { background: var(--theme--danger-background); color: var(--theme--danger); }
.status-text { font-size: 14px; }
.status-detail { font-size: 13px; font-weight: 400; }
.status-time { margin-left: auto; font-size: 12px; font-weight: 400; opacity: 0.7; }

/* Memory distribution */
.memory-section { margin-bottom: 24px; }

.stacked-bar {
	display: flex;
	height: 32px;
	border-radius: var(--theme--border-radius);
	overflow: hidden;
	border: 1px solid var(--theme--border-color);
}

.stacked-segment {
	min-width: 2px;
	transition: width 0.3s;
	cursor: help;
}

.stacked-legend {
	display: flex;
	flex-wrap: wrap;
	gap: 8px 16px;
	margin-top: 8px;
	font-size: 12px;
}

.legend-item {
	display: flex;
	align-items: center;
	gap: 4px;
}

.legend-dot {
	width: 10px;
	height: 10px;
	border-radius: 2px;
	flex-shrink: 0;
}

.heap-summary {
	margin-top: 8px;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

/* Charts */
.charts-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
	gap: 16px;
}

.chart-card {
	background: var(--theme--background);
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	padding: 16px;
}

/* Status timeline */
.status-timeline { margin-top: 16px; }
.timeline-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.timeline-header .sub-title { margin: 0; }
.timeline-legend { display: flex; gap: 12px; font-size: 11px; color: var(--theme--foreground-subdued); }
.tl-legend-item { display: flex; align-items: center; gap: 4px; }
.tl-dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
.timeline-bar {
	display: flex;
	height: 24px;
	border-radius: var(--theme--border-radius);
	overflow: hidden;
	border: 1px solid var(--theme--border-color);
}
.timeline-segment { min-width: 2px; transition: flex 0.3s; }
.status-bg-ok { background: var(--theme--success, #2ecda7); }
.status-bg-degraded { background: var(--theme--warning, #ffa439); }
.status-bg-error, .status-bg-unknown { background: var(--theme--danger, #e35169); }
.timeline-labels {
	display: flex;
	justify-content: space-between;
	font-size: 11px;
	color: var(--theme--foreground-subdued);
	margin-top: 4px;
}

/* Profile table */
.profile-table {
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	overflow-x: auto;
	font-size: 13px;
}

.profile-header {
	display: grid;
	grid-template-columns: 2fr repeat(7, 1fr);
	padding: 8px 12px;
	background: var(--theme--background-subdued);
	font-weight: 600;
	font-size: 11px;
	text-transform: uppercase;
	color: var(--theme--foreground-subdued);
	min-width: 900px;
}

.profile-row {
	display: grid;
	grid-template-columns: 2fr repeat(7, 1fr);
	padding: 8px 12px;
	border-top: 1px solid var(--theme--border-color);
	align-items: center;
	min-width: 900px;
}

.profile-calc-name { font-weight: 600; }
.measured { color: var(--theme--foreground); font-weight: 600; }
.estimated { color: var(--theme--foreground-subdued); font-style: italic; }

.remark-badges { display: flex; gap: 4px; flex-wrap: wrap; }

.remark-badge {
	font-size: 10px;
	padding: 1px 6px;
	border-radius: 3px;
	font-weight: 600;
	cursor: help;
}

.remark-info { background: var(--theme--primary-background); color: var(--theme--primary); }
.remark-warning { background: var(--theme--warning-background); color: var(--theme--warning); }
.remark-error { background: var(--theme--danger-background); color: var(--theme--danger); }

.range-toggle {
	display: flex;
	gap: 4px;
}

.no-data {
	color: var(--theme--foreground-subdued);
	font-style: italic;
	font-size: 14px;
}
</style>
