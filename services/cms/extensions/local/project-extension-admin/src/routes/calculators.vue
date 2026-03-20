<template>
	<private-view title="Calculators">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="admin_panel_settings" />
			</v-button>
		</template>

		<template #navigation>
			<admin-navigation />
		</template>

		<div class="admin-content">
			<!-- KPI cards -->
			<div v-if="overview" class="kpi-grid">
				<kpi-card
					label="Active Calculators"
					:value="overview.calculators.active"
					:max="overview.calculators.total"
					icon="calculate"
					:progress="overview.calculators.total ? (overview.calculators.active / overview.calculators.total) * 100 : 0"
					:subtitle="overview.calculators.active + ' serving API requests, ' + (overview.calculators.total - overview.calculators.active) + ' inactive (won\'t respond to calls)'"
				/>
				<kpi-card
					label="Error Rate"
					:value="errorRate"
					icon="error_outline"
					suffix="%"
					:icon-variant="errorRate > 5 ? 'danger' : errorRate > 1 ? 'warning' : 'success'"
					:subtitle="errorRate > 5 ? 'High — check errors in the table below' : errorRate > 1 ? 'Elevated — review failing calculators' : overview.calls.errors_month + ' errors of ' + overview.calls.month + ' calls this month'"
				/>
				<kpi-card
					label="Calls Today"
					:value="overview.calls.today"
					icon="today"
					subtitle="API calls since midnight"
				/>
				<kpi-card
					label="Calls This Month"
					:value="overview.calls.month"
					icon="calendar_month"
					subtitle="total API calls this month"
				/>
			</div>

			<div class="toolbar">
				<v-input v-model="search" placeholder="Search by name, ID, or account..." @input="debouncedFetch">
					<template #prepend><v-icon name="search" /></template>
				</v-input>
			</div>

			<!-- Live server heap breakdown -->
			<div v-if="memoryDistribution.length" class="section">
				<h4 class="sub-title">Server Memory — {{ (cluster.totalHeapUsedMB ?? 0).toFixed(0) }} MB JS heap across {{ cluster.instances ?? 0 }} instance{{ (cluster.instances ?? 0) !== 1 ? 's' : '' }}</h4>
				<div class="stacked-bar">
					<div
						v-for="(seg, idx) in memoryDistribution"
						:key="seg.id"
						class="stacked-segment"
						:style="{ width: seg.pct + '%', background: segmentColor(idx) }"
						:title="seg.id + ': ' + seg.heapMB.toFixed(1) + ' MB (' + seg.pct.toFixed(1) + '% of heap)'"
					/>
					<div
						class="stacked-segment stacked-segment--overhead"
						:style="{ width: overheadPct + '%' }"
						:title="'Runtime overhead: ' + overheadMB.toFixed(1) + ' MB (' + overheadPct.toFixed(1) + '%)'"
					/>
				</div>
				<div class="stacked-legend">
					<span v-for="(seg, idx) in memoryDistribution.slice(0, 12)" :key="seg.id" class="legend-item">
						<span class="legend-dot" :style="{ background: segmentColor(idx) }" />
						{{ seg.id }} ({{ seg.heapMB.toFixed(1) }} MB)
					</span>
					<span class="legend-item">
						<span class="legend-dot legend-dot--overhead" />
						Runtime overhead ({{ overheadMB.toFixed(1) }} MB)
					</span>
				</div>
				<div class="heap-summary">
					<span class="heap-legend-item"><span class="memory-dot memory-dot--active" /> In worker memory ({{ inMemoryIds.size }}) — instant response</span>
					<span class="heap-legend-item"><span class="memory-dot memory-dot--cached" /> Cached in Redis ({{ inRedisCount }}) — loads on first call</span>
				</div>
			</div>

			<div v-if="loading" class="loading-state">
				<v-progress-circular indeterminate />
			</div>

			<template v-else-if="calculators.length">
				<calculator-table
					:calculators="calculators"
					:show-account="true"
					:in-memory-ids="inMemoryIds"
					:in-redis-ids="inRedisIds"
					@click-calculator="(c) => $router.push('/calculators/' + c.id)"
					@click-account="(c) => $router.push('/admin-dashboard/accounts/' + c.account_id)"
					@click-errors="openErrorDrawer"
				/>

				<div v-if="meta.total > meta.limit" class="pagination">
					<v-button small secondary :disabled="meta.page <= 1" @click="changePage(-1)">Previous</v-button>
					<span class="page-info">Page {{ meta.page }} of {{ Math.ceil(meta.total / meta.limit) }}</span>
					<v-button small secondary :disabled="meta.page * meta.limit >= meta.total" @click="changePage(1)">Next</v-button>
				</div>
			</template>

			<div v-else class="loading-state">
				<v-info icon="calculate" title="No calculators found" center />
			</div>
		</div>

		<!-- Error drawer -->
		<v-drawer
			v-model:modelValue="errorDrawerOpen"
			:title="'Errors — ' + (errorDrawerCalc?.name || errorDrawerCalc?.id || '')"
			icon="error_outline"
			@cancel="errorDrawerOpen = false"
		>
			<div class="error-drawer-content">
				<div v-if="errorsLoading" class="loading-state-sm">
					<v-progress-circular indeterminate />
				</div>
				<template v-else-if="errorList.length">
					<div class="error-summary">
						{{ errorDrawerCalc?.monthly_errors }} errors this month
					</div>
					<div v-for="err in errorList" :key="err.id" class="error-item">
						<div class="error-time">{{ formatErrorTime(err.timestamp) }}</div>
						<div class="error-message">{{ err.error_message || 'Unknown error' }}</div>
						<div class="error-meta">
							<span v-if="err.response_time_ms">{{ err.response_time_ms }}ms</span>
							<span v-if="err.test" class="error-env">test</span>
							<span v-else class="error-env error-env--live">live</span>
						</div>
					</div>
				</template>
				<div v-else class="no-data">No recent errors found.</div>
			</div>
		</v-drawer>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { useAdminApi } from '../composables/use-admin-api';
import { useServerStats } from '../composables/use-health';
import type { AdminCalculator, OverviewData, ServerStatsResponse, ServerStatsCluster } from '../types';
import AdminNavigation from '../components/admin-navigation.vue';
import KpiCard from '../components/kpi-card.vue';
import CalculatorTable from '../components/calculator-table.vue';

const api = useApi();
const { loading, fetchCalculators, fetchCalculatorErrors, fetchOverview } = useAdminApi(api);
const { stats, fetchStats } = useServerStats(api);

const overview = ref<OverviewData | null>(null);
const calculators = ref<AdminCalculator[]>([]);
const meta = ref({ total: 0, page: 1, limit: 25 });
const search = ref('');

const serverStats = computed(() => stats.value as ServerStatsResponse | null);
const cluster = computed<ServerStatsCluster>(() => serverStats.value?.cluster || {} as ServerStatsCluster);

// Memory distribution from live server stats
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

// In-memory IDs: strip -test suffix to match calculator table IDs
const inMemoryIds = computed(() => {
	const ids = new Set<string>();
	for (const seg of memoryDistribution.value) {
		ids.add(seg.id.replace(/-test$/, ''));
	}
	return ids;
});

// Redis-cached IDs: calculators loaded in cache but not in workers
const inRedisIds = computed(() => {
	const ids = new Set<string>();
	if (!serverStats.value?.instances) return ids;
	for (const inst of Object.values(serverStats.value.instances)) {
		if (!inst.cache?.lru) continue;
		// Cache size > 0 means some calculators are cached
		// We can't get exact IDs from cache, so mark activated calculators
		// that are NOT in workers as potentially cached
	}
	// For now: calculators that are activated but not in worker memory
	// are likely in Redis cache if the server has seen them
	for (const calc of calculators.value) {
		if (calc.activated && !inMemoryIds.value.has(calc.id)) {
			ids.add(calc.id);
		}
	}
	return ids;
});

const inRedisCount = computed(() => {
	if (!serverStats.value?.instances) return 0;
	let total = 0;
	for (const inst of Object.values(serverStats.value.instances)) {
		total += inst.cache?.lru?.size ?? 0;
	}
	return Math.max(0, total - inMemoryIds.value.size);
});

const totalCalcHeapMB = computed(() => memoryDistribution.value.reduce((sum, s) => sum + s.heapMB, 0));
const overheadMB = computed(() => Math.max(0, (cluster.value.totalHeapUsedMB ?? 0) - totalCalcHeapMB.value));
const overheadPct = computed(() => {
	const total = cluster.value.totalHeapUsedMB || 1;
	return (overheadMB.value / total) * 100;
});

const SEGMENT_COLORS = [
	'#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6',
	'#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#a855f7',
	'#eab308', '#3b82f6', '#10b981', '#e11d48', '#7c3aed',
];
function segmentColor(idx: number) { return SEGMENT_COLORS[idx % SEGMENT_COLORS.length]; }

// Error drawer
const errorDrawerOpen = ref(false);
const errorDrawerCalc = ref<AdminCalculator | null>(null);
const errorList = ref<any[]>([]);
const errorsLoading = ref(false);

async function openErrorDrawer(calc: AdminCalculator) {
	errorDrawerCalc.value = calc;
	errorDrawerOpen.value = true;
	errorsLoading.value = true;
	errorList.value = [];

	const result = await fetchCalculatorErrors(calc.id);
	if (result) errorList.value = result.data;
	errorsLoading.value = false;
}

function formatErrorTime(ts: string): string {
	const d = new Date(ts);
	return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
		' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedFetch() {
	if (debounceTimer) clearTimeout(debounceTimer);
	debounceTimer = setTimeout(() => loadCalculators(), 300);
}

async function loadCalculators() {
	const result = await fetchCalculators({
		search: search.value || undefined,
		page: meta.value.page,
		limit: meta.value.limit,
	});
	if (result) {
		calculators.value = result.data;
		meta.value = result.meta;
	}
}

function changePage(delta: number) {
	meta.value.page += delta;
	loadCalculators();
}

const errorRate = computed(() => {
	if (!overview.value || !overview.value.calls.month) return 0;
	return Math.round((overview.value.calls.errors_month / overview.value.calls.month) * 100);
});

onMounted(() => {
	loadCalculators();
	fetchStats();
	fetchOverview().then(d => { overview.value = d; });
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

.loading-state-sm {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 120px;
}

.kpi-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	gap: 16px;
	margin-bottom: 24px;
}

.toolbar {
	margin-bottom: 16px;
	max-width: 400px;
}

.section { margin-bottom: 24px; }

.sub-title {
	font-size: 13px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	margin-bottom: 8px;
}

.section-hint {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	margin-bottom: 12px;
	line-height: 1.5;
	opacity: 0.8;
}

/* Stacked bar */
.stacked-bar {
	display: flex;
	height: 28px;
	border-radius: var(--theme--border-radius);
	overflow: hidden;
	border: 1px solid var(--theme--border-color);
}

.stacked-segment {
	min-width: 2px;
	transition: width 0.3s;
	cursor: help;
}

.stacked-segment--overhead {
	background: var(--theme--background-normal, #e4e7eb);
}

.stacked-legend {
	display: flex;
	flex-wrap: wrap;
	gap: 6px 14px;
	margin-top: 8px;
	font-size: 11px;
}

.legend-item {
	display: flex;
	align-items: center;
	gap: 4px;
}

.legend-dot {
	width: 8px;
	height: 8px;
	border-radius: 2px;
	flex-shrink: 0;
}

.legend-dot--overhead {
	background: var(--theme--background-normal, #e4e7eb);
}

.heap-summary {
	margin-top: 8px;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	display: flex;
	align-items: center;
	gap: 6px;
	flex-wrap: wrap;
}

.heap-legend-item {
	display: inline-flex;
	align-items: center;
	gap: 4px;
}

.heap-legend-sep {
	opacity: 0.4;
}

.memory-dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	flex-shrink: 0;
	display: inline-block;
}

.memory-dot--active {
	background: var(--theme--success, #2ecda7);
	box-shadow: 0 0 4px var(--theme--success, #2ecda7);
}

.memory-dot--cached {
	background: var(--theme--warning, #ffa439);
}

.pagination {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 16px;
	margin-top: 16px;
}

.page-info {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
}

/* Error drawer */
.error-drawer-content {
	padding: 16px 24px;
}

.error-summary {
	font-size: 14px;
	font-weight: 600;
	color: var(--theme--danger);
	margin-bottom: 16px;
	padding-bottom: 12px;
	border-bottom: 1px solid var(--theme--border-color);
}

.error-item {
	padding: 12px 0;
	border-bottom: 1px solid var(--theme--border-color);
}

.error-item:last-child {
	border-bottom: none;
}

.error-time {
	font-size: 11px;
	color: var(--theme--foreground-subdued);
	font-family: var(--theme--fonts--monospace--font-family);
	margin-bottom: 4px;
}

.error-message {
	font-size: 13px;
	color: var(--theme--danger);
	word-break: break-word;
}

.error-meta {
	display: flex;
	gap: 8px;
	margin-top: 4px;
	font-size: 11px;
	color: var(--theme--foreground-subdued);
}

.error-env {
	padding: 0 4px;
	border-radius: 2px;
	background: var(--theme--background-subdued);
	font-weight: 600;
}

.error-env--live {
	background: var(--theme--success-background, rgba(46, 205, 167, 0.1));
	color: var(--theme--success);
}

.no-data {
	color: var(--theme--foreground-subdued);
	font-style: italic;
	font-size: 14px;
	text-align: center;
	padding: 24px 0;
}
</style>
