<template>
	<div class="feedback-dashboard">
		<h3>Feedback Analytics</h3>
		<p class="fb-desc">Review user feedback to identify content gaps and improve answer quality.</p>

		<div v-if="loading" class="fb-loading">
			<v-progress-circular indeterminate />
		</div>

		<template v-else-if="stats">
			<!-- KPI cards -->
			<div class="kpi-row">
				<div class="kpi-card">
					<div class="kpi-value" :class="satisfactionColor">
						{{ stats.satisfaction_rate != null ? stats.satisfaction_rate + '%' : '—' }}
					</div>
					<div class="kpi-label">Satisfaction</div>
				</div>
				<div class="kpi-card">
					<div class="kpi-value">{{ stats.total }}</div>
					<div class="kpi-label">Total ratings</div>
				</div>
				<div class="kpi-card">
					<div class="kpi-value kpi-up">{{ stats.up_count }}</div>
					<div class="kpi-label">Positive</div>
				</div>
				<div class="kpi-card">
					<div class="kpi-value kpi-down">{{ stats.down_count }}</div>
					<div class="kpi-label">Negative</div>
				</div>
			</div>

			<!-- Category breakdown -->
			<div v-if="stats.categories.length > 0" class="fb-section">
				<h4>Issue Categories</h4>
				<div class="cat-bars">
					<div v-for="cat in stats.categories" :key="cat.category" class="cat-bar-row">
						<span class="cat-label">{{ categoryLabel(cat.category) }}</span>
						<div class="cat-bar-track">
							<div class="cat-bar-fill" :style="{ width: catPercent(cat.count) + '%' }"></div>
						</div>
						<span class="cat-count">{{ cat.count }}</span>
					</div>
				</div>
			</div>

			<!-- Top down-voted queries -->
			<div v-if="stats.top_downvoted.length > 0" class="fb-section">
				<h4>Top Down-Voted Queries</h4>
				<table class="fb-table">
					<thead>
						<tr><th>Query</th><th>Downvotes</th><th></th></tr>
					</thead>
					<tbody>
						<tr v-for="item in stats.top_downvoted" :key="item.query">
							<td class="td-query">{{ item.query }}</td>
							<td class="td-count">{{ item.down_count }}</td>
							<td class="td-action">
								<v-button x-small secondary @click="$emit('create-curated-from', item.query)">
									Create Curated
								</v-button>
							</td>
						</tr>
					</tbody>
				</table>
			</div>

			<!-- Problem chunks -->
			<div v-if="stats.problem_chunks.length > 0" class="fb-section">
				<h4>Problem Chunks</h4>
				<p class="fb-hint">Chunks appearing most in down-voted answers — may need content fixes.</p>
				<table class="fb-table">
					<thead>
						<tr><th>Chunk ID</th><th>Downvotes</th></tr>
					</thead>
					<tbody>
						<tr v-for="chunk in stats.problem_chunks" :key="chunk.chunk_id">
							<td class="td-chunk">{{ chunk.chunk_id.slice(0, 8) }}…</td>
							<td class="td-count">{{ chunk.down_count }}</td>
						</tr>
					</tbody>
				</table>
			</div>

			<!-- Suggestions -->
			<div v-if="suggestions.length > 0" class="fb-section">
				<h4>Suggested Curated Answers</h4>
				<p class="fb-hint">Frequently down-voted queries that could benefit from a curated answer.</p>
				<table class="fb-table">
					<thead>
						<tr><th>Query</th><th>Down</th><th>Up</th><th>Curated?</th><th></th></tr>
					</thead>
					<tbody>
						<tr v-for="s in suggestions" :key="s.query">
							<td class="td-query">{{ s.query }}</td>
							<td class="td-count">{{ s.down_count }}</td>
							<td class="td-count">{{ s.up_count }}</td>
							<td>
								<v-icon v-if="s.has_curated_answer" name="check_circle" x-small class="icon-yes" />
								<v-icon v-else name="cancel" x-small class="icon-no" />
							</td>
							<td class="td-action">
								<v-button v-if="!s.has_curated_answer" x-small secondary @click="$emit('create-curated-from', s.query)">
									Create
								</v-button>
							</td>
						</tr>
					</tbody>
				</table>
			</div>

			<div v-if="stats.total === 0" class="fb-empty">
				<v-icon name="thumbs_up_down" />
				<p>No feedback yet. Feedback will appear here once users rate answers.</p>
			</div>
		</template>
	</div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useApi } from '@directus/extensions-sdk';

const props = defineProps<{ kbId: string }>();

defineEmits<{
	'create-curated-from': [query: string];
}>();

const api = useApi();
const loading = ref(false);
const stats = ref<any>(null);
const suggestions = ref<any[]>([]);

const satisfactionColor = computed(() => {
	const rate = stats.value?.satisfaction_rate;
	if (rate == null) return '';
	if (rate >= 80) return 'kpi-up';
	if (rate >= 50) return 'kpi-warn';
	return 'kpi-down';
});

function categoryLabel(cat: string): string {
	const labels: Record<string, string> = {
		irrelevant: 'Irrelevant',
		incorrect: 'Incorrect',
		outdated: 'Outdated',
		incomplete: 'Incomplete',
		hallucination: 'Hallucination',
		perfect: 'Perfect',
	};
	return labels[cat] || cat;
}

function catPercent(count: number): number {
	const max = Math.max(...(stats.value?.categories?.map((c: any) => c.count) || [1]));
	return (count / max) * 100;
}

async function fetchStats() {
	loading.value = true;
	try {
		const [statsRes, suggestionsRes] = await Promise.all([
			api.get(`/kb/${props.kbId}/feedback/stats`),
			api.get(`/kb/${props.kbId}/feedback/suggestions`),
		]);
		stats.value = statsRes.data.data;
		suggestions.value = suggestionsRes.data.data || [];
	} catch {
		stats.value = { total: 0, up_count: 0, down_count: 0, satisfaction_rate: null, categories: [], top_downvoted: [], problem_chunks: [], timeline: [] };
		suggestions.value = [];
	} finally {
		loading.value = false;
	}
}

watch(() => props.kbId, () => fetchStats(), { immediate: true });
</script>

<style scoped>
.feedback-dashboard h3 {
	margin: 0 0 4px;
	font-size: 16px;
	font-weight: 600;
}

.fb-desc {
	margin: 0 0 20px;
	font-size: 13px;
	color: var(--theme--foreground-subdued);
}

.fb-loading {
	display: flex;
	justify-content: center;
	padding: 40px;
}

.kpi-row {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 12px;
	margin-bottom: 24px;
}

.kpi-card {
	padding: 16px;
	background: var(--theme--background-subdued);
	border-radius: var(--theme--border-radius);
	border: 1px solid var(--theme--border-color-subdued);
	text-align: center;
}

.kpi-value {
	font-size: 28px;
	font-weight: 700;
	line-height: 1.2;
}

.kpi-label {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	margin-top: 4px;
	text-transform: uppercase;
	letter-spacing: 0.5px;
}

.kpi-up { color: var(--theme--success); }
.kpi-down { color: var(--theme--danger); }
.kpi-warn { color: var(--theme--warning); }

.fb-section {
	margin-bottom: 24px;
}

.fb-section h4 {
	margin: 0 0 12px;
	font-size: 14px;
	font-weight: 600;
}

.fb-hint {
	margin: 0 0 12px;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.cat-bars {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.cat-bar-row {
	display: flex;
	align-items: center;
	gap: 12px;
}

.cat-label {
	font-size: 13px;
	min-width: 100px;
}

.cat-bar-track {
	flex: 1;
	height: 20px;
	background: var(--theme--background-subdued);
	border-radius: 4px;
	overflow: hidden;
}

.cat-bar-fill {
	height: 100%;
	background: var(--theme--danger);
	border-radius: 4px;
	opacity: 0.7;
	transition: width 0.3s;
}

.cat-count {
	font-size: 13px;
	font-weight: 600;
	min-width: 30px;
	text-align: right;
}

.fb-table {
	width: 100%;
	border-collapse: collapse;
	font-size: 13px;
}

.fb-table th {
	text-align: left;
	padding: 8px 12px;
	font-size: 11px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	color: var(--theme--foreground-subdued);
	border-bottom: 1px solid var(--theme--border-color-subdued);
}

.fb-table td {
	padding: 8px 12px;
	border-bottom: 1px solid var(--theme--border-color-subdued);
}

.td-query {
	max-width: 400px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.td-chunk {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 12px;
}

.td-count {
	text-align: center;
	font-weight: 600;
	min-width: 60px;
}

.td-action {
	text-align: right;
}

.icon-yes { color: var(--theme--success); }
.icon-no { color: var(--theme--foreground-subdued); }

.fb-empty {
	text-align: center;
	padding: 40px;
	color: var(--theme--foreground-subdued);
}

.fb-empty p {
	margin-top: 8px;
	font-size: 14px;
}
</style>
