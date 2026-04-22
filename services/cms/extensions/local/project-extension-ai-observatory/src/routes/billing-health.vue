<template>
	<private-view title="Billing Health">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="health_and_safety" />
			</v-button>
		</template>

		<template #navigation>
			<observatory-navigation />
		</template>

		<div class="obs-content">
			<!-- Banner -->
			<div
				v-if="data?.banner"
				class="banner"
				:class="{
					'banner-red': data.banner.state === 'red',
					'banner-green': data.banner.state === 'green',
					'banner-neutral': data.banner.state === 'neutral',
				}"
			>
				<v-icon :name="bannerIcon" class="banner-icon" />
				<div class="banner-text">
					<div class="banner-title">{{ bannerTitle }}</div>
					<div class="banner-msg">{{ data.banner.message }}</div>
				</div>
				<div class="banner-refresh">
					<span class="refresh-hint">Auto-refresh 60s</span>
					<v-button
						x-small
						secondary
						icon
						@click="refresh"
						v-tooltip="'Refresh now'"
					><v-icon name="refresh" /></v-button>
				</div>
			</div>

			<!-- Loading first paint -->
			<div v-if="loading && !data" class="loading-state">
				<v-progress-circular indeterminate />
			</div>

			<template v-else-if="data">
				<!-- Stale-data ribbon: shown when a poll error occurs after the first successful fetch -->
				<div v-if="error" class="stale-ribbon">
					<v-icon name="warning" class="stale-ribbon-icon" />
					<span>Last refresh failed — showing data from {{ staleMessage }}</span>
				</div>

				<!-- KPI Row: 24h counters -->
				<div class="kpi-grid">
					<div class="kpi-card">
						<div class="kpi-icon kpi-icon-ok"><v-icon name="check_circle" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Success (24h)</div>
							<div class="kpi-value">{{ data.counters_24h.success }}</div>
						</div>
					</div>
					<div class="kpi-card">
						<div class="kpi-icon" :class="{ 'kpi-icon-bad': totalFailures > 0 }"><v-icon name="error" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Failures (24h)</div>
							<div class="kpi-value">{{ totalFailures }}</div>
						</div>
					</div>
					<div v-if="(data.counters_24h.reconciled ?? 0) > 0" class="kpi-card kpi-card-reconcile">
						<div class="kpi-icon kpi-icon-reconcile"><v-icon name="sync" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Reconciled (24h)</div>
							<div class="kpi-value">{{ data.counters_24h.reconciled }}</div>
						</div>
					</div>
					<div class="kpi-card">
						<div class="kpi-icon"><v-icon name="summarize" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Total (24h)</div>
							<div class="kpi-value">{{ data.counters_24h.total }}</div>
						</div>
					</div>
				</div>

				<!-- Reconciliation activity (Task 57) -->
				<div v-if="(data.counters_24h.reconciled ?? 0) > 0" class="section">
					<div class="section-title">Reconciliation activity (24h)</div>
					<div class="reconcile-card">
						<v-icon name="info" class="reconcile-icon" />
						<div class="reconcile-body">
							<strong>{{ data.counters_24h.reconciled }} row(s)</strong> were synthetically recovered by the nightly reconciliation cron.
							This means webhook events were missed (e.g. CMS was down during Stripe delivery) and have now been repaired.
							Check <code>stripe_webhook_log</code> where <code>status = 'reconciled'</code> for details.
						</div>
					</div>
				</div>

				<!-- Failure breakdown (only if any) -->
				<div v-if="failureEntries.length" class="section">
					<div class="section-title">Failure breakdown (24h)</div>
					<div class="table-wrap">
						<table class="data-table">
							<thead>
								<tr>
									<th>Status</th>
									<th>Meaning</th>
									<th class="num">Count</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="f in failureEntries" :key="f.status">
									<td class="mono">{{ f.status }}</td>
									<td>{{ statusMeaning(f.status) }}</td>
									<td class="num">{{ f.count }}</td>
								</tr>
							</tbody>
						</table>
					</div>
				</div>

				<!-- Last success -->
				<div class="section">
					<div class="section-title">Last successful webhook</div>
					<div v-if="data.last_success" class="detail-card">
						<div class="detail-row">
							<span class="detail-label">When</span>
							<span class="detail-value">{{ formatDate(data.last_success.received_at) }} <span class="detail-muted">({{ timeAgo(data.last_success.received_at) }})</span></span>
						</div>
						<div class="detail-row">
							<span class="detail-label">Event type</span>
							<span class="detail-value mono">{{ data.last_success.event_type ?? '—' }}</span>
						</div>
						<div class="detail-row">
							<span class="detail-label">Event ID</span>
							<span class="detail-value mono">{{ data.last_success.event_id ?? '—' }}</span>
						</div>
					</div>
					<div v-else class="empty-state">No successful webhook recorded yet.</div>
				</div>

				<!-- Last failure -->
				<div class="section">
					<div class="section-title">Last failure</div>
					<div v-if="data.last_failure" class="detail-card detail-card-failure">
						<div class="detail-row">
							<span class="detail-label">When</span>
							<span class="detail-value">{{ formatDate(data.last_failure.received_at) }} <span class="detail-muted">({{ timeAgo(data.last_failure.received_at) }})</span></span>
						</div>
						<div class="detail-row">
							<span class="detail-label">Status</span>
							<span class="detail-value mono">{{ data.last_failure.status }} — {{ statusMeaning(data.last_failure.status) }}</span>
						</div>
						<div class="detail-row">
							<span class="detail-label">Event type</span>
							<span class="detail-value mono">{{ data.last_failure.event_type ?? '—' }}</span>
						</div>
						<div class="detail-row">
							<span class="detail-label">Event ID</span>
							<span class="detail-value mono">{{ data.last_failure.event_id ?? '—' }}</span>
						</div>
						<div v-if="data.last_failure.error_message" class="detail-row">
							<span class="detail-label">Error</span>
							<span class="detail-value mono wrap">{{ data.last_failure.error_message }}</span>
						</div>
					</div>
					<div v-else class="empty-state">No failures recorded — good news.</div>
				</div>
			</template>

			<v-info v-else-if="error" type="danger" icon="error" :title="error" center />
		</div>

		<template #sidebar>
			<sidebar-detail id="info" icon="info" title="Billing Health">
				<div class="sidebar-info">
					<p>Live status of the Stripe webhook pipeline.</p>
					<p>A red banner means signature verification is failing — usually a stale <code>STRIPE_WEBHOOK_SECRET</code>. Green means the pipeline is healthy and recent. Polling every 60 seconds while this page is visible.</p>
				</div>
			</sidebar-detail>
		</template>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { useObservatoryApi } from '../composables/use-observatory-api';
import type { WebhookHealth } from '../types';
import ObservatoryNavigation from '../components/observatory-navigation.vue';

const api = useApi();
const { loading, error, fetchWebhookHealth } = useObservatoryApi(api);
const data = ref<WebhookHealth | null>(null);
const lastSuccessfulFetch = ref<Date | null>(null);

const POLL_MS = 60_000;
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function refresh() {
	const next = await fetchWebhookHealth();
	if (next) {
		data.value = next;
		lastSuccessfulFetch.value = new Date();
	}
}

onMounted(async () => {
	await refresh();
	pollTimer = setInterval(refresh, POLL_MS);
});

onBeforeUnmount(() => {
	if (pollTimer) {
		clearInterval(pollTimer);
		pollTimer = null;
	}
});

// ─── Derived values ─────────────────────────────────

const totalFailures = computed(() => {
	const f = data.value?.counters_24h.failures ?? {};
	return Object.values(f).reduce((s, n) => s + n, 0);
});

const failureEntries = computed(() => {
	const f = data.value?.counters_24h.failures ?? {};
	return Object.entries(f)
		.map(([status, count]) => ({ status, count }))
		.sort((a, b) => b.count - a.count);
});

const bannerIcon = computed(() => {
	const state = data.value?.banner.state ?? 'neutral';
	if (state === 'red') return 'error';
	if (state === 'green') return 'check_circle';
	return 'help_outline';
});

const bannerTitle = computed(() => {
	const state = data.value?.banner.state ?? 'neutral';
	if (state === 'red') return 'Action required';
	if (state === 'green') return 'Healthy';
	return 'Quiet';
});

const staleMessage = computed(() => {
	if (!lastSuccessfulFetch.value) return 'unknown time ago';
	return timeAgo(lastSuccessfulFetch.value.toISOString());
});

// ─── Formatters ─────────────────────────────────────

function statusMeaning(status: string): string {
	switch (status) {
		case '200':
			return 'Success';
		case '400_signature':
			return 'Signature verification failed — check STRIPE_WEBHOOK_SECRET';
		case '400_parse':
			return 'Payload parse error';
		case '400_missing_metadata':
			return 'Missing required metadata';
		case '500':
			return 'Handler error (backend)';
		case 'reconciled':
			return 'Recovered by nightly reconciliation cron (missed webhook)';
		default:
			return status;
	}
}

function formatDate(iso: string): string {
	const d = new Date(iso);
	return d.toLocaleString();
}

function timeAgo(iso: string): string {
	const then = new Date(iso).getTime();
	const now = Date.now();
	const secs = Math.max(0, Math.floor((now - then) / 1000));
	if (secs < 60) return `${secs}s ago`;
	if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
	if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
	return `${Math.floor(secs / 86400)}d ago`;
}
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

/* Banner */
.banner {
	display: flex;
	align-items: center;
	gap: 16px;
	padding: 18px 20px;
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	margin-bottom: 24px;
}

.banner-red {
	background: rgba(227, 81, 105, 0.08);
	border-color: var(--theme--danger, #e35169);
	color: var(--theme--danger, #e35169);
}

.banner-green {
	background: rgba(46, 174, 93, 0.08);
	border-color: var(--theme--success, #2eae5d);
	color: var(--theme--success, #2eae5d);
}

.banner-neutral {
	background: var(--theme--background-subdued);
	color: var(--theme--foreground-subdued);
}

.banner-icon {
	--v-icon-size: 32px;
	flex-shrink: 0;
}

.banner-text {
	flex: 1;
	min-width: 0;
}

.banner-title {
	font-size: 15px;
	font-weight: 700;
	margin-bottom: 2px;
}

.banner-msg {
	font-size: 13px;
	color: var(--theme--foreground);
	opacity: 0.88;
}

.banner-refresh {
	display: flex;
	align-items: center;
	gap: 8px;
}

.refresh-hint {
	font-size: 11px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	text-transform: uppercase;
	letter-spacing: 0.5px;
}

/* Stale-data ribbon */
.stale-ribbon {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 14px;
	margin-bottom: 16px;
	border: 1px solid var(--theme--warning, #d4a017);
	border-radius: var(--theme--border-radius);
	background: rgba(212, 160, 23, 0.08);
	color: var(--theme--warning, #d4a017);
	font-size: 13px;
}

.stale-ribbon-icon {
	--v-icon-size: 18px;
	flex-shrink: 0;
}

/* KPI */
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

.kpi-icon-ok { background: rgba(46, 174, 93, 0.12); color: var(--theme--success, #2eae5d); }
.kpi-icon-bad { background: rgba(227, 81, 105, 0.12); color: var(--theme--danger, #e35169); }
.kpi-icon-reconcile { background: rgba(97, 154, 220, 0.12); color: var(--theme--primary, #619adc); }
.kpi-card-reconcile { border-color: var(--theme--primary, #619adc); }

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

/* Reconciliation activity card */
.reconcile-card {
	display: flex;
	align-items: flex-start;
	gap: 12px;
	padding: 14px 18px;
	border: 1px solid var(--theme--primary, #619adc);
	border-radius: var(--theme--border-radius);
	background: rgba(97, 154, 220, 0.06);
	font-size: 13px;
	line-height: 1.6;
	color: var(--theme--foreground);
}

.reconcile-icon {
	--v-icon-size: 20px;
	color: var(--theme--primary, #619adc);
	flex-shrink: 0;
	margin-top: 2px;
}

.reconcile-body code {
	background: var(--theme--background-subdued);
	padding: 1px 4px;
	border-radius: 3px;
	font-size: 11px;
	font-family: var(--theme--fonts--mono--font-family, monospace);
}

/* Detail card */
.section { margin-bottom: 24px; }

.section-title {
	font-size: 14px;
	font-weight: 600;
	color: var(--theme--foreground);
	margin-bottom: 12px;
}

.detail-card {
	background: var(--theme--background);
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	padding: 16px 20px;
}

.detail-card-failure {
	border-color: var(--theme--danger, #e35169);
}

.detail-row {
	display: flex;
	gap: 16px;
	padding: 6px 0;
	font-size: 13px;
	border-bottom: 1px solid var(--theme--border-color-subdued, rgba(0,0,0,0.04));
}

.detail-row:last-child { border-bottom: none; }

.detail-label {
	width: 120px;
	flex-shrink: 0;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	font-size: 11px;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	padding-top: 2px;
}

.detail-value {
	flex: 1;
	min-width: 0;
	color: var(--theme--foreground);
	word-break: break-word;
}

.detail-value.wrap { white-space: pre-wrap; }

.detail-muted {
	color: var(--theme--foreground-subdued);
	font-size: 12px;
	margin-left: 6px;
}

.mono {
	font-family: var(--theme--fonts--mono--font-family, monospace);
	font-size: 12px;
}

/* Table */
.table-wrap {
	background: var(--theme--background);
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	overflow: hidden;
}

.data-table {
	width: 100%;
	border-collapse: collapse;
}

.data-table th,
.data-table td {
	padding: 10px 16px;
	text-align: left;
	font-size: 13px;
	border-bottom: 1px solid var(--theme--border-color);
}

.data-table th {
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	font-size: 11px;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	background: var(--theme--background-subdued);
}

.data-table tr:last-child td { border-bottom: none; }

.num { text-align: right !important; }

.empty-state {
	padding: 24px;
	text-align: center;
	color: var(--theme--foreground-subdued);
	font-size: 13px;
	background: var(--theme--background-subdued);
	border-radius: var(--theme--border-radius);
}

.sidebar-info {
	padding: 12px;
	line-height: 1.6;
}

.sidebar-info code {
	background: var(--theme--background-subdued);
	padding: 1px 4px;
	border-radius: 3px;
	font-size: 12px;
}
</style>
