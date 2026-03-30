<template>
	<private-view title="KB &amp; Retrieval">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="search" />
			</v-button>
		</template>

		<template #navigation>
			<observatory-navigation />
		</template>

		<div class="obs-content">
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
						<div class="kpi-icon"><v-icon name="search" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Total Queries ({{ selectedDays }}d)</div>
							<div class="kpi-value">{{ (data.total_searches + data.total_asks).toLocaleString() }}</div>
							<div class="kpi-subtitle">{{ data.total_searches }} search + {{ data.total_asks }} ask</div>
						</div>
					</div>
					<div class="kpi-card" :class="{ 'kpi-success': data.avg_similarity >= 0.7, 'kpi-warn': data.avg_similarity < 0.5 }">
						<div class="kpi-icon"><v-icon name="leaderboard" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Avg Similarity</div>
							<div class="kpi-value">{{ data.avg_similarity.toFixed(3) }}</div>
							<div class="kpi-subtitle">across all results</div>
						</div>
					</div>
					<div class="kpi-card" :class="{ 'kpi-success': data.avg_context_utilization >= 0.6, 'kpi-warn': data.avg_context_utilization < 0.3 }">
						<div class="kpi-icon"><v-icon name="auto_awesome" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Context Utilization</div>
							<div class="kpi-value">{{ (data.avg_context_utilization * 100).toFixed(0) }}%</div>
							<div class="kpi-subtitle">chunks used / injected</div>
						</div>
					</div>
					<div class="kpi-card" :class="{ 'kpi-success': data.curated_hit_rate >= 0.2, 'kpi-warn': data.curated_hit_rate < 0.05 }">
						<div class="kpi-icon"><v-icon name="verified" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Curated Hit Rate</div>
							<div class="kpi-value">{{ (data.curated_hit_rate * 100).toFixed(0) }}%</div>
							<div class="kpi-subtitle">{{ data.curated_stats.total_curated }} curated answers</div>
						</div>
					</div>
					<div class="kpi-card" :class="{ 'kpi-warn': data.search_latency.p50 > 500 }">
						<div class="kpi-icon"><v-icon name="speed" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Search Latency P50</div>
							<div class="kpi-value">{{ fmtMs(data.search_latency.p50) }}</div>
							<div class="kpi-subtitle">P95: {{ fmtMs(data.search_latency.p95) }}</div>
						</div>
					</div>
				</div>

				<!-- Daily Volume Chart -->
				<div class="chart-card">
					<div class="chart-header">
						<div class="chart-title">Daily Query Volume — Last {{ selectedDays }} Days</div>
						<div class="chart-legend">
							<span class="legend-item"><span class="legend-dot" style="background: var(--theme--primary)" />Search</span>
							<span class="legend-item"><span class="legend-dot" style="background: #6644AA" />Ask</span>
						</div>
					</div>
					<div v-if="data.daily_volume.length" class="bar-chart" style="height: 160px">
						<div class="bar-chart-inner">
							<div
								v-for="d in data.daily_volume"
								:key="d.date"
								class="bar-col"
								:title="d.date + ': ' + d.searches + ' search, ' + d.asks + ' ask'"
							>
								<div class="bar-segment" style="background: #6644AA" :style="{ height: barPct(d.asks, maxDailyVol) + '%' }" />
								<div class="bar-segment" :style="{ height: barPct(d.searches, maxDailyVol) + '%' }" />
							</div>
						</div>
						<div class="bar-labels">
							<span
								v-for="(d, i) in data.daily_volume"
								:key="'l' + i"
								class="bar-label"
								:class="{ visible: i % 5 === 0 || i === data.daily_volume.length - 1 }"
							>{{ shortDate(d.date) }}</span>
						</div>
					</div>
					<div v-else class="empty-state">No retrieval data in range</div>
				</div>

				<!-- Two-column: similarity distribution + confidence breakdown -->
				<div class="two-col">
					<div class="chart-card no-margin">
						<div class="chart-title">Similarity Distribution</div>
						<div v-if="data.similarity_distribution.length" class="dist-list">
							<div v-for="b in data.similarity_distribution" :key="b.bucket" class="dist-row">
								<span class="dist-label">{{ b.bucket }}</span>
								<div class="dist-bar-wrap">
									<div class="dist-bar" :class="simBarClass(b.bucket)" :style="{ width: distBarPct(b.count) + '%' }" />
								</div>
								<span class="dist-count">{{ b.count }}</span>
							</div>
						</div>
						<div v-else class="empty-state">No similarity data</div>
					</div>

					<div class="chart-card no-margin">
						<div class="chart-title">Answer Confidence (Ask queries)</div>
						<div v-if="totalConfidence > 0" class="dist-list">
							<div v-for="[level, count] in confidenceEntries" :key="level" class="dist-row">
								<span class="dist-label">{{ level }}</span>
								<div class="dist-bar-wrap">
									<div class="dist-bar" :class="'conf-' + level" :style="{ width: (count / totalConfidence * 100) + '%' }" />
								</div>
								<span class="dist-count">{{ count }}</span>
								<span class="dist-pct">{{ (count / totalConfidence * 100).toFixed(0) }}%</span>
							</div>
						</div>
						<div v-else class="empty-state">No ask queries yet</div>
					</div>
				</div>

				<!-- Per-KB Performance Table -->
				<div class="section">
					<div class="section-title">Per-KB Performance</div>
					<div class="table-wrap">
						<table v-if="data.kb_performance.length" class="data-table">
							<thead>
								<tr>
									<th>Knowledge Base</th>
									<th class="num">Searches</th>
									<th class="num">Asks</th>
									<th class="num">Avg Similarity</th>
									<th class="num">Utilization</th>
									<th class="num">Curated Hits</th>
									<th class="num">Avg Latency</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="kb in data.kb_performance" :key="kb.kb_id">
									<td class="mono">{{ kb.kb_name }}</td>
									<td class="num">{{ kb.search_count }}</td>
									<td class="num">{{ kb.ask_count }}</td>
									<td class="num" :class="simCellClass(kb.avg_similarity)">{{ kb.avg_similarity.toFixed(3) }}</td>
									<td class="num" :class="utilCellClass(kb.avg_utilization)">{{ (kb.avg_utilization * 100).toFixed(0) }}%</td>
									<td class="num">{{ (kb.curated_hit_rate * 100).toFixed(0) }}%</td>
									<td class="num">{{ kb.avg_search_latency_ms }}ms</td>
								</tr>
							</tbody>
						</table>
						<div v-else class="empty-state">No per-KB data yet</div>
					</div>
				</div>

				<!-- Two-column: curated stats + latency -->
				<div class="two-col">
					<div class="chart-card no-margin">
						<div class="chart-title">Curated Answer Impact</div>
						<div class="curated-stats">
							<div class="curated-row">
								<span class="curated-label">Curated answers available</span>
								<span class="curated-value">{{ data.curated_stats.total_curated }}</span>
							</div>
							<div class="curated-row">
								<span class="curated-label">Total hits in period</span>
								<span class="curated-value">{{ data.curated_stats.total_hits }}</span>
							</div>
							<div class="curated-row">
								<span class="curated-label">Override mode</span>
								<span class="curated-value">{{ data.curated_stats.override_count }}</span>
							</div>
							<div class="curated-row">
								<span class="curated-label">Boost mode</span>
								<span class="curated-value">{{ data.curated_stats.boost_count }}</span>
							</div>
						</div>
					</div>

					<div class="chart-card no-margin">
						<div class="chart-title">Search Latency Percentiles</div>
						<div v-if="data.search_latency.sample_size > 0" class="rt-list">
							<div class="rt-row">
								<span class="rt-pct">P50</span>
								<div class="rt-bar-wrap">
									<div class="rt-bar" :style="{ width: ltBarPct(data.search_latency.p50) + '%' }" />
								</div>
								<span class="rt-val">{{ fmtMs(data.search_latency.p50) }}</span>
							</div>
							<div class="rt-row">
								<span class="rt-pct">P95</span>
								<div class="rt-bar-wrap">
									<div class="rt-bar rt-bar-warn" :style="{ width: ltBarPct(data.search_latency.p95) + '%' }" />
								</div>
								<span class="rt-val">{{ fmtMs(data.search_latency.p95) }}</span>
							</div>
							<div class="rt-row">
								<span class="rt-pct">P99</span>
								<div class="rt-bar-wrap">
									<div class="rt-bar rt-bar-danger" :style="{ width: ltBarPct(data.search_latency.p99) + '%' }" />
								</div>
								<span class="rt-val">{{ fmtMs(data.search_latency.p99) }}</span>
							</div>
							<div class="rt-sample">Based on {{ data.search_latency.sample_size.toLocaleString() }} queries</div>
						</div>
						<div v-else class="empty-state">No latency data<br><small>search_latency_ms not yet populated</small></div>
					</div>
				</div>
			</template>

			<v-info v-else-if="error" type="danger" icon="error" :title="error" center />
		</div>

		<template #sidebar>
			<sidebar-detail icon="info" title="KB &amp; Retrieval" close>
				<div class="sidebar-info">
					<p>Cross-KB retrieval performance: similarity scores, context utilization, curated answer impact, and search latency over the selected period. Complements the per-KB feedback dashboard in the Knowledge extension.</p>
				</div>
			</sidebar-detail>
		</template>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { useObservatoryApi } from '../composables/use-observatory-api';
import type { RetrievalMetrics } from '../types';
import ObservatoryNavigation from '../components/observatory-navigation.vue';

const api = useApi();
const { loading, error, fetchRetrievalMetrics } = useObservatoryApi(api);
const data = ref<RetrievalMetrics | null>(null);

const dateOptions = [
	{ label: '7d', value: 7 },
	{ label: '30d', value: 30 },
	{ label: '90d', value: 90 },
];
const selectedDays = ref(30);

async function selectDays(days: number) {
	selectedDays.value = days;
	data.value = await fetchRetrievalMetrics(days);
}

const maxDailyVol = computed(() =>
	Math.max(1, ...(data.value?.daily_volume ?? []).map(d => d.searches + d.asks))
);

const maxDist = computed(() =>
	Math.max(1, ...(data.value?.similarity_distribution ?? []).map(b => b.count))
);

const confidenceEntries = computed(() =>
	Object.entries(data.value?.confidence_breakdown ?? {}).sort((a, b) => {
		const order: Record<string, number> = { high: 0, medium: 1, not_found: 2 };
		return (order[a[0]] ?? 99) - (order[b[0]] ?? 99);
	})
);

const totalConfidence = computed(() =>
	Object.values(data.value?.confidence_breakdown ?? {}).reduce((s, v) => s + v, 0)
);

const ltMax = computed(() => data.value?.search_latency.p99 || 1);

function barPct(val: number, max: number): number {
	return Math.max(1, (val / max) * 100);
}

function distBarPct(count: number): number {
	return Math.max(2, (count / maxDist.value) * 100);
}

function ltBarPct(ms: number): number {
	return Math.min(100, (ms / ltMax.value) * 100);
}

function simBarClass(bucket: string): string {
	if (bucket.startsWith('0.8') || bucket.startsWith('0.9')) return 'sim-high';
	if (bucket.startsWith('0.6') || bucket.startsWith('0.7')) return 'sim-mid';
	return 'sim-low';
}

function simCellClass(sim: number): string {
	if (sim >= 0.7) return 'cell-success';
	if (sim < 0.5) return 'cell-danger';
	return '';
}

function utilCellClass(util: number): string {
	if (util >= 0.6) return 'cell-success';
	if (util < 0.3) return 'cell-danger';
	return '';
}

function fmtMs(ms: number): string {
	if (!ms) return '–';
	if (ms >= 60000) return (ms / 60000).toFixed(1) + 'm';
	if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
	return Math.round(ms) + 'ms';
}

function shortDate(iso: string): string {
	const d = new Date(iso);
	return (d.getMonth() + 1) + '/' + d.getDate();
}

onMounted(async () => {
	data.value = await fetchRetrievalMetrics(selectedDays.value);
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

.date-range-bar { display: flex; gap: 8px; margin-bottom: 24px; }

.range-btn {
	padding: 6px 16px;
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	background: var(--theme--background);
	color: var(--theme--foreground-subdued);
	font-size: 13px; font-weight: 600;
	cursor: pointer; transition: all 0.15s;
}
.range-btn:hover { border-color: var(--theme--primary); color: var(--theme--primary); }
.range-btn.active { background: var(--theme--primary); border-color: var(--theme--primary); color: #fff; }

.kpi-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
	gap: 16px; margin-bottom: 32px;
}

.kpi-card {
	display: flex; align-items: flex-start; gap: 16px; padding: 20px;
	background: var(--theme--background);
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
}
.kpi-card.kpi-success { border-color: var(--theme--success); }
.kpi-card.kpi-warn { border-color: var(--theme--warning); }

.kpi-icon {
	width: 44px; height: 44px;
	display: flex; align-items: center; justify-content: center;
	background: var(--theme--primary-background);
	border-radius: var(--theme--border-radius);
	color: var(--theme--primary); flex-shrink: 0;
}
.kpi-body { flex: 1; min-width: 0; }
.kpi-label { font-size: 11px; font-weight: 600; color: var(--theme--foreground-subdued); text-transform: uppercase; letter-spacing: 0.5px; }
.kpi-value { font-size: 24px; font-weight: 700; color: var(--theme--foreground); line-height: 1.2; }
.kpi-subtitle { font-size: 11px; color: var(--theme--foreground-subdued); margin-top: 2px; }

.chart-card {
	background: var(--theme--background);
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	padding: 20px; margin-bottom: 32px;
}
.chart-card.no-margin { margin-bottom: 0; }
.chart-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; flex-wrap: wrap; gap: 8px; }
.chart-title { font-size: 13px; font-weight: 600; color: var(--theme--foreground-subdued); margin-bottom: 12px; }
.chart-legend { display: flex; gap: 12px; flex-wrap: wrap; }
.legend-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--theme--foreground-subdued); }
.legend-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

.bar-chart { display: flex; flex-direction: column; }
.bar-chart-inner { flex: 1; display: flex; align-items: flex-end; gap: 3px; }
.bar-col { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; cursor: default; }
.bar-segment { min-height: 1px; transition: height 0.2s; background: var(--theme--primary); }
.bar-segment:first-child { border-radius: 2px 2px 0 0; }
.bar-col:hover .bar-segment { opacity: 0.8; }
.bar-labels { display: flex; gap: 3px; border-top: 1px solid var(--theme--border-color); padding-top: 4px; margin-top: 4px; }
.bar-label { flex: 1; font-size: 10px; color: transparent; text-align: center; overflow: hidden; white-space: nowrap; }
.bar-label.visible { color: var(--theme--foreground-subdued); }

.two-col {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
	gap: 24px; margin-bottom: 32px;
}

.dist-list { display: flex; flex-direction: column; gap: 8px; }
.dist-row { display: flex; align-items: center; gap: 10px; }
.dist-label { width: 60px; font-size: 11px; font-weight: 600; color: var(--theme--foreground-subdued); flex-shrink: 0; }
.dist-bar-wrap { flex: 1; height: 10px; background: var(--theme--border-color); border-radius: 5px; overflow: hidden; }
.dist-bar { height: 100%; border-radius: 5px; transition: width 0.3s; }
.dist-count { width: 36px; text-align: right; font-size: 12px; font-weight: 600; color: var(--theme--foreground); }
.dist-pct { width: 36px; text-align: right; font-size: 11px; color: var(--theme--foreground-subdued); }

.sim-high { background: var(--theme--success, #2ecda7); }
.sim-mid { background: var(--theme--primary); }
.sim-low { background: var(--theme--warning, #ecb95d); }

.conf-high { background: var(--theme--success, #2ecda7); }
.conf-medium { background: var(--theme--warning, #ecb95d); }
.conf-not_found { background: var(--theme--danger, #e35169); }

.section { margin-bottom: 32px; }
.section-title { font-size: 14px; font-weight: 600; color: var(--theme--foreground); margin-bottom: 12px; }
.table-wrap { background: var(--theme--background); border: 1px solid var(--theme--border-color); border-radius: var(--theme--border-radius); overflow: hidden; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { padding: 10px 16px; text-align: left; font-size: 13px; border-bottom: 1px solid var(--theme--border-color); }
.data-table th { font-weight: 600; color: var(--theme--foreground-subdued); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; background: var(--theme--background-subdued); }
.data-table tr:last-child td { border-bottom: none; }
.num { text-align: right !important; }
.mono { font-family: var(--theme--fonts--mono--font-family, monospace); font-size: 12px; }
.cell-success { color: var(--theme--success, #2ecda7) !important; font-weight: 600; }
.cell-danger { color: var(--theme--danger, #e35169) !important; font-weight: 600; }

.curated-stats { display: flex; flex-direction: column; gap: 12px; }
.curated-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--theme--border-color); }
.curated-row:last-child { border-bottom: none; }
.curated-label { font-size: 13px; color: var(--theme--foreground-subdued); }
.curated-value { font-size: 16px; font-weight: 700; color: var(--theme--foreground); }

.rt-list { display: flex; flex-direction: column; gap: 16px; }
.rt-row { display: flex; align-items: center; gap: 12px; }
.rt-pct { width: 28px; font-size: 11px; font-weight: 700; color: var(--theme--foreground-subdued); text-transform: uppercase; }
.rt-bar-wrap { flex: 1; height: 10px; background: var(--theme--border-color); border-radius: 5px; overflow: hidden; }
.rt-bar { height: 100%; background: var(--theme--primary); border-radius: 5px; transition: width 0.3s; }
.rt-bar-warn { background: var(--theme--warning, #ecb95d); }
.rt-bar-danger { background: var(--theme--danger, #e35169); }
.rt-val { width: 56px; text-align: right; font-size: 13px; font-weight: 600; color: var(--theme--foreground); }
.rt-sample { font-size: 11px; color: var(--theme--foreground-subdued); margin-top: 4px; }

.empty-state { padding: 32px; text-align: center; color: var(--theme--foreground-subdued); font-size: 14px; }
.sidebar-info { padding: 12px; line-height: 1.6; }
</style>
