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
								<div v-if="bar.ask" class="bar-segment bar-ask" :style="{ flex: bar.ask }">
									<span class="segment-tooltip">{{ bar.ask }}</span>
								</div>
								<div v-if="bar.search" class="bar-segment bar-search" :style="{ flex: bar.search }">
									<span class="segment-tooltip">{{ bar.search }}</span>
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
				<span class="legend-item"><span class="legend-dot dot-search" /> Search</span>
				<span class="legend-item"><span class="legend-dot dot-ask" /> Ask</span>
			</div>
		</div>

		<!-- KPI cards -->
		<div class="kpi-grid">
			<kpi-card
				label="Total KBs"
				:value="props.knowledgeBases.length"
				icon="menu_book"
			/>
			<kpi-card
				:label="'Total Queries (' + rangeLabel + ')'"
				:value="queriesCount"
				icon="search"
			/>
			<kpi-card
				label="Documents"
				:value="totalDocuments"
				icon="description"
			/>
			<kpi-card
				label="Storage"
				:value="storageMb"
				icon="storage"
				suffix=" MB"
			/>
		</div>

		<!-- KB card grid -->
		<div class="kb-grid">
			<div
				v-for="kb in props.knowledgeBases"
				:key="kb.id"
				class="kb-card"
				@click="$router.push(`/knowledge/${kb.id}`)"
			>
				<div class="kb-card-header">
					<v-icon :name="kb.icon || 'menu_book'" class="kb-card-icon" />
					<span class="kb-card-name">{{ kb.name }}</span>
					<span class="status-badge" :class="statusClass(kb)">{{ kb.status }}</span>
				</div>
				<div class="kb-card-subtitle">{{ kb.document_count }} docs &middot; {{ kb.chunk_count }} chunks</div>
			</div>
			<div class="kb-card new-card" @click="$emit('create')">
				<div class="new-card-content">
					<v-icon name="add" x-large />
					<span class="new-card-label">New Knowledge Base</span>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import type { KnowledgeBase } from '../composables/use-knowledge-bases';
import { useKbDashboardStats, type TimeRange } from '../composables/use-kb-dashboard-stats';
import KpiCard from './kpi-card.vue';

const props = defineProps<{
	knowledgeBases: KnowledgeBase[];
	api: any;
}>();

defineEmits<{ create: [] }>();

const VALID_RANGES: TimeRange[] = ['today', '7d', '30d', '12m'];
const stored = localStorage.getItem('bl_kb_timeRange') as TimeRange | null;
const timeRange = ref<TimeRange>(stored && VALID_RANGES.includes(stored) ? stored : '7d');

const {
	totalQueries,
	buildAggregateChart,
	fetchQueryData,
	startPolling,
	stopPolling,
} = useKbDashboardStats(props.api);

const queriesCount = computed(() => totalQueries(timeRange.value));

const rangeLabel = computed(() => {
	if (timeRange.value === 'today') return 'today';
	if (timeRange.value === '7d') return '7d';
	if (timeRange.value === '30d') return '30d';
	return '12m';
});

const totalDocuments = computed(() =>
	props.knowledgeBases.reduce((sum, kb) => sum + (kb.document_count || 0), 0)
);

const storageMb = computed(() =>
	Math.round(props.knowledgeBases.reduce((sum, kb) => sum + (kb.chunk_count || 0) * 0.002, 0) * 10) / 10
);

const chartBars = computed(() => buildAggregateChart(timeRange.value));
const chartEmpty = computed(() => chartBars.value.every((b) => b.total === 0));
const placeholderHeights = [35, 55, 25, 65, 40, 75, 30, 50, 45, 60, 20, 70];

function statusClass(kb: KnowledgeBase): string {
	if (kb.status === 'active') return 'badge-active';
	if (kb.status === 'indexing') return 'badge-indexing';
	return 'badge-error';
}

watch(timeRange, (val) => localStorage.setItem('bl_kb_timeRange', val));

onMounted(() => {
	fetchQueryData();
	startPolling();
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

.bar-search .segment-tooltip { background: var(--theme--primary, #6644ff); }
.bar-ask .segment-tooltip { background: #8b5cf6; }
.bar-segment:hover .segment-tooltip { display: block; }

.bar-search { background: var(--theme--primary, #6644ff); }
.bar-ask { background: #8b5cf6; }
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

.dot-search { background: var(--theme--primary, #6644ff); }
.dot-ask { background: #8b5cf6; }

/* KPI grid */
.kpi-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	gap: 16px;
	margin-bottom: 32px;
}

/* KB card grid */
.kb-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
	gap: 16px;
}

.kb-card {
	padding: 16px;
	background: var(--theme--background);
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	cursor: pointer;
	transition: border-color 0.15s, box-shadow 0.15s;
}

.kb-card:hover {
	border-color: var(--theme--primary);
	box-shadow: 0 0 0 1px var(--theme--primary);
}

.kb-card-header {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 8px;
}

.kb-card-icon {
	color: var(--theme--foreground-subdued);
}

.kb-card-name {
	font-weight: 600;
	font-size: 14px;
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.kb-card-subtitle {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
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

.badge-indexing {
	background: var(--theme--warning-background);
	color: var(--theme--warning);
}

.badge-error {
	background: var(--theme--danger-background);
	color: var(--theme--danger);
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
