<template>
	<private-view title="Model Performance">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="compare_arrows" />
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
						<div class="kpi-icon"><v-icon name="compare_arrows" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Models Used ({{ selectedDays }}d)</div>
							<div class="kpi-value">{{ data.summary.models_used }}</div>
							<div class="kpi-subtitle">{{ data.summary.total_calls.toLocaleString() }} total calls</div>
						</div>
					</div>
					<div class="kpi-card">
						<div class="kpi-icon"><v-icon name="query_stats" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Total Model Calls</div>
							<div class="kpi-value">{{ data.summary.total_calls.toLocaleString() }}</div>
							<div class="kpi-subtitle">across all models</div>
						</div>
					</div>
					<div class="kpi-card kpi-success">
						<div class="kpi-icon"><v-icon name="savings" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Best Cost Efficiency</div>
							<div class="kpi-value model-name">{{ shortModelName(data.summary.best_cost_efficiency) }}</div>
							<div class="kpi-subtitle">lowest cost per 1K tokens</div>
						</div>
					</div>
					<div class="kpi-card">
						<div class="kpi-icon"><v-icon name="speed" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Fastest Model (P50)</div>
							<div class="kpi-value model-name">{{ shortModelName(data.summary.fastest_model_p50) }}</div>
							<div class="kpi-subtitle">lowest median latency</div>
						</div>
					</div>
				</div>

				<!-- Per-model stats table -->
				<div class="section">
					<div class="section-title">Per-Model Statistics</div>
					<div class="table-wrap">
						<table v-if="data.models.length" class="data-table">
							<thead>
								<tr>
									<th>Model</th>
									<th class="num">Calls</th>
									<th class="num">Input Tokens</th>
									<th class="num">Output Tokens</th>
									<th class="num">Cost (USD)</th>
									<th class="num">Cost / 1K Tokens</th>
									<th class="num">Avg Latency</th>
									<th class="num">P50</th>
									<th class="num">P95</th>
									<th class="num">P99</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="m in data.models" :key="m.model">
									<td class="mono model-cell">
										<span class="model-badge" :class="modelBadgeClass(m.model)">{{ shortModelName(m.model) }}</span>
									</td>
									<td class="num">{{ m.calls.toLocaleString() }}</td>
									<td class="num">{{ m.input_tokens.toLocaleString() }}</td>
									<td class="num">{{ m.output_tokens.toLocaleString() }}</td>
									<td class="num">{{ fmtCost(m.cost_usd) }}</td>
									<td class="num" :class="costEffClass(m.cost_per_1k_tokens, data.models)">{{ fmtCostPer1k(m.cost_per_1k_tokens) }}</td>
									<td class="num">{{ fmtMs(m.avg_response_ms) }}</td>
									<td class="num" :class="latencyClass(m.p50_ms)">{{ fmtMs(m.p50_ms) }}</td>
									<td class="num" :class="latencyClass(m.p95_ms)">{{ fmtMs(m.p95_ms) }}</td>
									<td class="num" :class="latencyClass(m.p99_ms)">{{ fmtMs(m.p99_ms) }}</td>
								</tr>
							</tbody>
						</table>
						<div v-else class="empty-state">No model usage data in range</div>
					</div>
				</div>

				<!-- Latency comparison -->
				<div class="section" v-if="data.models.length">
					<div class="section-title">Latency Comparison</div>
					<div class="two-col">
						<div class="chart-card no-margin">
							<div class="chart-title">P50 Median Latency by Model</div>
							<div class="model-bar-list">
								<div v-for="m in modelsByP50" :key="'p50-' + m.model" class="model-bar-row">
									<span class="model-bar-label">{{ shortModelName(m.model) }}</span>
									<div class="model-bar-wrap">
										<div class="model-bar" :class="latencyBarClass(m.p50_ms)" :style="{ width: ltPct(m.p50_ms, maxP99) + '%' }" />
									</div>
									<span class="model-bar-val">{{ fmtMs(m.p50_ms) }}</span>
								</div>
							</div>
						</div>
						<div class="chart-card no-margin">
							<div class="chart-title">P95 / P99 Tail Latency by Model</div>
							<div class="model-bar-list">
								<div v-for="m in modelsByP50" :key="'p99-' + m.model" class="model-bar-row-group">
									<div class="model-bar-group-label">{{ shortModelName(m.model) }}</div>
									<div class="model-bar-row indent">
										<span class="model-bar-sublabel">P95</span>
										<div class="model-bar-wrap">
											<div class="model-bar rt-bar-warn" :style="{ width: ltPct(m.p95_ms, maxP99) + '%' }" />
										</div>
										<span class="model-bar-val">{{ fmtMs(m.p95_ms) }}</span>
									</div>
									<div class="model-bar-row indent">
										<span class="model-bar-sublabel">P99</span>
										<div class="model-bar-wrap">
											<div class="model-bar rt-bar-danger" :style="{ width: ltPct(m.p99_ms, maxP99) + '%' }" />
										</div>
										<span class="model-bar-val">{{ fmtMs(m.p99_ms) }}</span>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>

				<!-- Cost efficiency comparison -->
				<div class="section" v-if="data.models.length">
					<div class="section-title">Cost Efficiency — Cost per 1K Tokens</div>
					<div class="chart-card">
						<div class="model-bar-list">
							<div v-for="m in modelsByCost" :key="'cost-' + m.model" class="model-bar-row">
								<span class="model-bar-label">{{ shortModelName(m.model) }}</span>
								<div class="model-bar-wrap">
									<div
										class="model-bar"
										:class="m.cost_per_1k_tokens === minCostPer1k ? 'cost-best' : 'cost-default'"
										:style="{ width: costBarPct(m.cost_per_1k_tokens) + '%' }"
									/>
								</div>
								<span class="model-bar-val" :class="m.cost_per_1k_tokens === minCostPer1k ? 'cell-success' : ''">
									{{ fmtCostPer1k(m.cost_per_1k_tokens) }}
									<span v-if="m.cost_per_1k_tokens === minCostPer1k" class="best-badge">best</span>
								</span>
							</div>
						</div>
					</div>
				</div>

				<!-- Task-type breakdown matrix -->
				<div class="section" v-if="taskModels.length">
					<div class="section-title">Task-Type Breakdown</div>
					<div class="table-wrap">
						<table class="data-table">
							<thead>
								<tr>
									<th>Model</th>
									<th v-for="tt in taskTypes" :key="tt" class="num">{{ fmtTaskType(tt) }}</th>
									<th class="num">Total</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="m in taskModels" :key="'task-' + m">
									<td class="mono model-cell">
										<span class="model-badge" :class="modelBadgeClass(m)">{{ shortModelName(m) }}</span>
									</td>
									<td v-for="tt in taskTypes" :key="tt + m" class="num">
										<span v-if="taskCount(m, tt) > 0" :class="taskCountClass(taskCount(m, tt), maxTaskCount)">
											{{ taskCount(m, tt).toLocaleString() }}
										</span>
										<span v-else class="muted">—</span>
									</td>
									<td class="num">{{ taskTotal(m).toLocaleString() }}</td>
								</tr>
							</tbody>
						</table>
					</div>
				</div>

				<!-- Routing note -->
				<div class="info-card">
					<v-icon name="info" />
					<div class="info-content">
						<div class="info-title">Model Routing Configuration</div>
						<div class="info-body">Automated model routing rules (e.g. "Use Haiku for KB queries") are coming soon. Use the data above to make manual routing decisions in your AI API configuration.</div>
					</div>
				</div>
			</template>

			<v-info v-else-if="error" type="danger" icon="error" :title="error" center />
		</div>

		<template #sidebar>
			<sidebar-detail id="info" icon="info" title="Model Performance">
				<div class="sidebar-info">
					<p>Compare AI model performance across cost, latency, and task types. Use this data to optimize model routing — e.g. directing KB queries to cheaper models while using premium models for complex calculator builds.</p>
					<p style="margin-top: 8px; font-size: 12px; color: var(--theme--foreground-subdued);">Task types are derived from tool_calls: KB tools = knowledge, calculator tools = calculator, no tools = general chat, other tools = tool use.</p>
				</div>
			</sidebar-detail>
		</template>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { useObservatoryApi } from '../composables/use-observatory-api';
import type { ModelPerformanceData } from '../types';
import ObservatoryNavigation from '../components/observatory-navigation.vue';

const api = useApi();
const { loading, error, fetchModelPerformance } = useObservatoryApi(api);
const data = ref<ModelPerformanceData | null>(null);

const dateOptions = [
	{ label: '7d', value: 7 },
	{ label: '30d', value: 30 },
	{ label: '90d', value: 90 },
];
const selectedDays = ref(30);

async function selectDays(days: number) {
	selectedDays.value = days;
	data.value = await fetchModelPerformance(days);
}

const modelsByP50 = computed(() =>
	[...(data.value?.models ?? [])].filter(m => m.p50_ms > 0).sort((a, b) => a.p50_ms - b.p50_ms)
);

const modelsByCost = computed(() =>
	[...(data.value?.models ?? [])].filter(m => m.cost_per_1k_tokens > 0).sort((a, b) => a.cost_per_1k_tokens - b.cost_per_1k_tokens)
);

const maxP99 = computed(() =>
	Math.max(1, ...(data.value?.models ?? []).map(m => m.p99_ms))
);

const minCostPer1k = computed(() => {
	const vals = (data.value?.models ?? []).map(m => m.cost_per_1k_tokens).filter(v => v > 0);
	return vals.length ? Math.min(...vals) : 0;
});

const maxCostPer1k = computed(() =>
	Math.max(1, ...(data.value?.models ?? []).map(m => m.cost_per_1k_tokens))
);

const taskTypes = computed(() => {
	const set = new Set<string>();
	(data.value?.task_breakdown ?? []).forEach(r => set.add(r.task_type));
	const order = ['general_chat', 'knowledge', 'calculator', 'tool_use'];
	return [...set].sort((a, b) => {
		const ai = order.indexOf(a); const bi = order.indexOf(b);
		return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
	});
});

const taskModels = computed(() => {
	const set = new Set<string>();
	(data.value?.task_breakdown ?? []).forEach(r => set.add(r.model));
	return [...set];
});

const maxTaskCount = computed(() =>
	Math.max(1, ...(data.value?.task_breakdown ?? []).map(r => r.calls))
);

function taskCount(model: string, taskType: string): number {
	return data.value?.task_breakdown.find(r => r.model === model && r.task_type === taskType)?.calls ?? 0;
}

function taskTotal(model: string): number {
	return (data.value?.task_breakdown ?? []).filter(r => r.model === model).reduce((s, r) => s + r.calls, 0);
}

function ltPct(ms: number, max: number): number {
	if (!ms || !max) return 0;
	return Math.max(2, (ms / max) * 100);
}

function costBarPct(cost: number): number {
	if (!cost || !maxCostPer1k.value) return 2;
	return Math.max(2, (cost / maxCostPer1k.value) * 100);
}

function shortModelName(model: string): string {
	if (!model || model === 'none') return model;
	// claude-3-5-haiku-20241022 → Haiku 3.5, claude-3-opus-20240229 → Opus 3
	const m = model.toLowerCase();
	if (m.includes('haiku')) return 'Haiku' + (m.includes('3-5') || m.includes('3.5') ? ' 3.5' : ' 3');
	if (m.includes('sonnet')) return 'Sonnet' + (m.includes('3-7') || m.includes('3.7') ? ' 3.7' : m.includes('3-5') || m.includes('3.5') ? ' 3.5' : ' 3');
	if (m.includes('opus')) return 'Opus' + (m.includes('4') ? ' 4' : ' 3');
	if (m.includes('gpt-4o-mini')) return 'GPT-4o mini';
	if (m.includes('gpt-4o')) return 'GPT-4o';
	if (m.includes('gpt-4')) return 'GPT-4';
	// fallback: truncate at 16 chars
	return model.length > 16 ? model.slice(0, 14) + '…' : model;
}

function modelBadgeClass(model: string): string {
	const m = model.toLowerCase();
	if (m.includes('haiku')) return 'badge-haiku';
	if (m.includes('sonnet')) return 'badge-sonnet';
	if (m.includes('opus')) return 'badge-opus';
	if (m.includes('gpt')) return 'badge-gpt';
	return 'badge-default';
}

function latencyClass(ms: number): string {
	if (!ms) return 'muted';
	if (ms <= 1000) return 'cell-success';
	if (ms >= 5000) return 'cell-danger';
	return '';
}

function latencyBarClass(ms: number): string {
	if (ms <= 1000) return 'rt-bar';
	if (ms >= 5000) return 'rt-bar-danger';
	return 'rt-bar-warn';
}

function costEffClass(cost: number, models: ModelPerformanceData['models']): string {
	if (!cost) return 'muted';
	const min = Math.min(...models.filter(m => m.cost_per_1k_tokens > 0).map(m => m.cost_per_1k_tokens));
	return cost === min ? 'cell-success' : '';
}

function taskCountClass(count: number, max: number): string {
	if (count >= max * 0.5) return 'task-high';
	if (count >= max * 0.1) return 'task-mid';
	return '';
}

function fmtMs(ms: number): string {
	if (!ms) return '–';
	if (ms >= 60000) return (ms / 60000).toFixed(1) + 'm';
	if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
	return Math.round(ms) + 'ms';
}

function fmtCost(usd: number): string {
	if (!usd) return '$0.000000';
	return '$' + usd.toFixed(6);
}

function fmtCostPer1k(usd: number): string {
	if (!usd) return '–';
	if (usd < 0.001) return '$' + usd.toFixed(6);
	return '$' + usd.toFixed(4);
}

function fmtTaskType(tt: string): string {
	const map: Record<string, string> = {
		general_chat: 'General Chat',
		knowledge: 'KB / Search',
		calculator: 'Calculator',
		tool_use: 'Tool Use',
	};
	return map[tt] || tt;
}

onMounted(async () => {
	data.value = await fetchModelPerformance(selectedDays.value);
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
.kpi-value.model-name { font-size: 18px; }
.kpi-subtitle { font-size: 11px; color: var(--theme--foreground-subdued); margin-top: 2px; }

.section { margin-bottom: 32px; }
.section-title { font-size: 14px; font-weight: 600; color: var(--theme--foreground); margin-bottom: 12px; }
.table-wrap { background: var(--theme--background); border: 1px solid var(--theme--border-color); border-radius: var(--theme--border-radius); overflow: hidden; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { padding: 10px 16px; text-align: left; font-size: 13px; border-bottom: 1px solid var(--theme--border-color); }
.data-table th { font-weight: 600; color: var(--theme--foreground-subdued); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; background: var(--theme--background-subdued); }
.data-table tr:last-child td { border-bottom: none; }
.num { text-align: right !important; }
.mono { font-family: var(--theme--fonts--mono--font-family, monospace); font-size: 12px; }
.muted { color: var(--theme--foreground-subdued); }
.cell-success { color: var(--theme--success, #2ecda7) !important; font-weight: 600; }
.cell-danger { color: var(--theme--danger, #e35169) !important; font-weight: 600; }
.task-high { font-weight: 700; color: var(--theme--foreground); }
.task-mid { color: var(--theme--foreground); }

.model-cell { white-space: nowrap; }
.model-badge {
	display: inline-block;
	padding: 2px 8px;
	border-radius: 10px;
	font-size: 11px; font-weight: 700;
	letter-spacing: 0.3px;
}
.badge-haiku { background: #e8f5e9; color: #2e7d32; }
.badge-sonnet { background: var(--theme--primary-background); color: var(--theme--primary); }
.badge-opus { background: #f3e5f5; color: #6a1b9a; }
.badge-gpt { background: #e3f2fd; color: #1565c0; }
.badge-default { background: var(--theme--background-subdued); color: var(--theme--foreground-subdued); }

.chart-card {
	background: var(--theme--background);
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	padding: 20px; margin-bottom: 32px;
}
.chart-card.no-margin { margin-bottom: 0; }
.chart-title { font-size: 13px; font-weight: 600; color: var(--theme--foreground-subdued); margin-bottom: 16px; }

.two-col {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
	gap: 24px; margin-bottom: 32px;
}

.model-bar-list { display: flex; flex-direction: column; gap: 12px; }
.model-bar-row { display: flex; align-items: center; gap: 12px; }
.model-bar-row-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 4px; }
.model-bar-group-label { font-size: 12px; font-weight: 700; color: var(--theme--foreground-subdued); }
.model-bar-row.indent { padding-left: 12px; }
.model-bar-label { width: 72px; font-size: 12px; font-weight: 600; color: var(--theme--foreground-subdued); flex-shrink: 0; text-align: right; }
.model-bar-sublabel { width: 28px; font-size: 11px; font-weight: 700; color: var(--theme--foreground-subdued); flex-shrink: 0; }
.model-bar-wrap { flex: 1; height: 10px; background: var(--theme--border-color); border-radius: 5px; overflow: hidden; }
.model-bar { height: 100%; background: var(--theme--primary); border-radius: 5px; transition: width 0.3s; }
.rt-bar { height: 100%; background: var(--theme--primary); border-radius: 5px; transition: width 0.3s; }
.rt-bar-warn { background: var(--theme--warning, #ecb95d); }
.rt-bar-danger { background: var(--theme--danger, #e35169); }
.cost-best { background: var(--theme--success, #2ecda7); }
.cost-default { background: var(--theme--primary); }
.model-bar-val { width: 64px; text-align: right; font-size: 12px; font-weight: 600; color: var(--theme--foreground); display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
.best-badge { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--theme--success, #2ecda7); }

.info-card {
	display: flex; align-items: flex-start; gap: 12px; padding: 16px 20px;
	background: var(--theme--background-subdued);
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	margin-bottom: 32px;
	color: var(--theme--foreground-subdued);
}
.info-content { flex: 1; }
.info-title { font-size: 13px; font-weight: 600; color: var(--theme--foreground); margin-bottom: 4px; }
.info-body { font-size: 12px; line-height: 1.6; }

.empty-state { padding: 32px; text-align: center; color: var(--theme--foreground-subdued); font-size: 14px; }
.sidebar-info { padding: 12px; line-height: 1.6; }
</style>
