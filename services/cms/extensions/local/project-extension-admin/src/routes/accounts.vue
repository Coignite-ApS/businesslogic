<template>
	<private-view :title="accountId ? detailTitle : 'Accounts'">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="admin_panel_settings" />
			</v-button>
		</template>

		<template #navigation>
			<admin-navigation />
		</template>

		<template #actions>
			<v-button v-if="accountId" rounded icon secondary @click="$router.push('/admin-dashboard/accounts')">
				<v-icon name="arrow_back" />
			</v-button>
		</template>

		<div class="admin-content">
			<!-- Account Detail -->
			<template v-if="accountId && detail">
				<!-- Usage KPIs -->
				<div class="kpi-grid">
					<kpi-card
						label="Plan"
						:value="0"
						icon="credit_card"
						:icon-variant="planVariant"
					>
						<template #custom-value>
							<div class="kpi-value">{{ detail.subscription?.plan_name || 'None' }}</div>
						</template>
						<template #custom-subtitle>
							<v-chip v-if="detail.subscription" :class="'chip-' + detail.subscription.status" x-small>
								{{ detail.subscription.status }}
							</v-chip>
							<span v-if="detail.account.exempt_from_subscription" class="exempt-badge">Exempt</span>
						</template>
					</kpi-card>
					<kpi-card
						label="Calculators"
						:value="detail.calculators.length"
						:max="detail.subscription?.calculator_limit || undefined"
						icon="calculate"
						:progress="calcProgress"
						:subtitle="activeCalcs + ' active, ' + (detail.subscription?.calculator_limit ? (detail.subscription.calculator_limit - detail.calculators.length) + ' remaining' : 'no limit')"
						:icon-variant="calcProgress > 90 ? 'danger' : calcProgress > 70 ? 'warning' : undefined"
					/>
					<kpi-card
						label="API Calls"
						:value="totalMonthlyCalls"
						:max="detail.subscription?.calls_per_month || undefined"
						icon="trending_up"
						:progress="callsProgress"
						:subtitle="detail.subscription?.calls_per_month ? Math.round(callsProgress) + '% of monthly limit used' : 'no monthly limit'"
						:icon-variant="callsProgress > 90 ? 'danger' : callsProgress > 70 ? 'warning' : undefined"
					/>
					<kpi-card
						label="Errors"
						:value="totalMonthlyErrors"
						icon="error_outline"
						:subtitle="totalMonthlyCalls ? (Math.round((totalMonthlyErrors / totalMonthlyCalls) * 100)) + '% of ' + totalMonthlyCalls + ' calls failed' : 'no calls this month'"
						:icon-variant="totalMonthlyErrors > 0 ? 'danger' : 'success'"
					/>
				</div>

				<!-- Admin Actions -->
				<div class="section">
					<div class="actions-bar">
						<div class="action-row">
							<v-input v-model="trialDays" type="number" placeholder="Days" small style="width: 80px" />
							<v-button small @click="handleExtendTrial" :loading="actionLoading">Extend Trial</v-button>
						</div>
						<v-button
							small
							:kind="detail.account.exempt_from_subscription ? 'warning' : 'primary'"
							@click="handleToggleExempt"
							:loading="actionLoading"
						>
							{{ detail.account.exempt_from_subscription ? 'Remove Exemption' : 'Mark Exempt' }}
						</v-button>
						<v-button
							v-if="detail.subscription?.stripe_customer_id"
							small secondary
							:href="stripeUrl"
							target="_blank"
						>
							Open in Stripe
						</v-button>
						<span v-if="actionError" class="action-error">{{ actionError }}</span>
						<span v-if="actionSuccess" class="action-success">{{ actionSuccess }}</span>
					</div>
				</div>

				<!-- Calculators table -->
				<div class="section">
					<h3 class="section-title">Calculators ({{ detail.calculators.length }})</h3>
					<calculator-table
						v-if="detail.calculators.length"
						:calculators="detail.calculators"
						:show-account="false"
						@click-calculator="(c) => $router.push('/calculators/' + c.id)"
					/>
					<div v-else class="no-data">No calculators</div>
				</div>

				<!-- Usage chart -->
				<div class="section" v-if="detail.usage.length">
					<div class="chart-card">
						<mini-chart title="Calls — Last 30 Days" type="line" :data="usageChartData" :height="180" />
					</div>
				</div>
			</template>

			<!-- Account detail loading -->
			<div v-else-if="accountId && loading" class="loading-state">
				<v-progress-circular indeterminate />
			</div>

			<!-- Account List -->
			<template v-else-if="!accountId">
				<!-- List KPIs -->
				<div v-if="overview" class="kpi-grid">
					<kpi-card
						label="Accounts"
						:value="overview.accounts.total"
						icon="people"
						:subtitle="overview.revenue.active_subscriptions + ' paying, ' + (overview.accounts.total - overview.revenue.active_subscriptions) + ' free or trial'"
					/>
					<kpi-card
						label="Churn"
						:value="overview.revenue.churned_30d"
						icon="trending_down"
						:subtitle="overview.revenue.churned_30d + ' canceled last 30 days'"
						:icon-variant="overview.revenue.churned_30d > 0 ? 'danger' : 'success'"
					/>
					<kpi-card
						label="Plans"
						:value="0"
						icon="pie_chart"
					>
						<template #custom-value>
							<div class="plan-chips-inline">
								<v-chip v-for="p in overview.subscriptions.by_plan" :key="p.plan" x-small>
									{{ p.plan }}: {{ p.count }}
								</v-chip>
								<span v-if="!overview.subscriptions.by_plan.length" class="kpi-value">—</span>
							</div>
						</template>
						<template #custom-subtitle>
							<div class="kpi-subtitle">active subscriptions by plan</div>
						</template>
					</kpi-card>
					<kpi-card
						label="Trial Conversion"
						:value="conversionRate"
						icon="swap_horiz"
						suffix="%"
						:icon-variant="conversionRate > 50 ? 'success' : conversionRate > 20 ? 'warning' : 'danger'"
						:subtitle="overview.revenue.trial_converted + ' of ' + overview.revenue.trial_total + ' trials became paid'"
					/>
				</div>

				<!-- Registration trend chart -->
				<div v-if="overview && registrationChartData.length" class="section">
					<div class="chart-card">
						<mini-chart title="Accounts — Last 12 Months" type="line" :data="registrationChartData" :height="180" />
						<div class="chart-legend">
							<span class="legend-item"><span class="legend-dot dot-primary" /> Registrations</span>
							<span class="legend-item"><span class="legend-dot dot-error" /> Deletions</span>
							<span class="legend-item"><span class="legend-dot dot-success" /> Conversions</span>
						</div>
					</div>
				</div>

				<div class="toolbar">
					<v-input v-model="search" placeholder="Search accounts..." @input="debouncedFetch">
						<template #prepend><v-icon name="search" /></template>
					</v-input>
				</div>

				<div v-if="accounts.length" class="account-table">
					<div class="acct-header">
						<div class="col-name">Account</div>
						<div class="col-plan">Plan</div>
						<div class="col-status">Status</div>
						<div class="col-usage">Calculators</div>
						<div class="col-usage">Calls/Mo</div>
						<div class="col-date">Created</div>
					</div>
					<div
						v-for="acct in accounts"
						:key="acct.id"
						class="acct-row"
						@click="$router.push('/admin-dashboard/accounts/' + acct.id)"
					>
						<div class="col-name">
							<span class="acct-name">{{ acct.name || '—' }}</span>
							<span v-if="acct.exempt_from_subscription" class="exempt-badge">Exempt</span>
						</div>
						<div class="col-plan">{{ acct.plan_name || '—' }}</div>
						<div class="col-status">
							<v-chip v-if="acct.subscription_status" :class="'chip-' + acct.subscription_status" x-small>
								{{ acct.subscription_status }}
							</v-chip>
							<span v-else class="no-data-inline">—</span>
						</div>
						<div class="col-usage">
							<span class="usage-value">{{ acct.active_count }}</span>
							<span class="usage-total"> / {{ acct.calculator_count }}</span>
						</div>
						<div class="col-usage">
							<span class="usage-value">{{ acct.monthly_calls }}</span>
						</div>
						<div class="col-date">{{ formatDateShort(acct.date_created) }}</div>
					</div>
				</div>

				<div v-if="meta.total > meta.limit" class="pagination">
					<v-button small secondary :disabled="meta.page <= 1" @click="changePage(-1)">Previous</v-button>
					<span class="page-info">Page {{ meta.page }} of {{ Math.ceil(meta.total / meta.limit) }}</span>
					<v-button small secondary :disabled="meta.page * meta.limit >= meta.total" @click="changePage(1)">Next</v-button>
				</div>

				<div v-if="!accounts.length && !loading" class="loading-state">
					<v-info icon="people" title="No accounts found" center />
				</div>

				<div v-if="loading" class="loading-state">
					<v-progress-circular indeterminate />
				</div>
			</template>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useApi } from '@directus/extensions-sdk';
import { useAdminApi } from '../composables/use-admin-api';
import type { AccountListItem, AccountDetail, OverviewData } from '../types';
import AdminNavigation from '../components/admin-navigation.vue';
import KpiCard from '../components/kpi-card.vue';
import MiniChart from '../components/mini-chart.vue';
import CalculatorTable from '../components/calculator-table.vue';

const api = useApi();
const route = useRoute();
const { loading, fetchAccounts, fetchAccountDetail, fetchOverview, extendTrial, setExempt } = useAdminApi(api);

const accounts = ref<AccountListItem[]>([]);
const detail = ref<AccountDetail | null>(null);
const overview = ref<OverviewData | null>(null);
const meta = ref({ total: 0, page: 1, limit: 25 });
const search = ref('');

const trialDays = ref('7');
const actionLoading = ref(false);
const actionError = ref<string | null>(null);
const actionSuccess = ref<string | null>(null);

const stripeBaseUrl = ref('https://dashboard.stripe.com');

const accountId = computed(() => (route.params.accountId as string) || null);
const detailTitle = computed(() => detail.value?.account?.name || 'Account');
const stripeUrl = computed(() => {
	const custId = detail.value?.subscription?.stripe_customer_id;
	return custId ? `${stripeBaseUrl.value}/customers/${custId}` : null;
});

// List view computed
const conversionRate = computed(() => {
	if (!overview.value?.revenue.trial_total) return 0;
	return Math.round((overview.value.revenue.trial_converted / overview.value.revenue.trial_total) * 100);
});

const churnRateLabel = computed(() => {
	if (!overview.value) return '';
	const active = overview.value.revenue.active_subscriptions;
	const churned = overview.value.revenue.churned_30d;
	if (!active && !churned) return 'no subscriptions';
	const rate = Math.round((churned / (active + churned)) * 100);
	return rate + '% churn rate';
});

const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const registrationChartData = computed(() => {
	if (!overview.value) return [];
	const deletions = new Map((overview.value.charts.deletions_per_month || []).map((d: any) => [d.month, d.count]));
	const conversions = new Map((overview.value.charts.conversions_per_month || []).map((d: any) => [d.month, d.count]));
	return overview.value.charts.accounts_per_month.map(d => {
		const [, m] = d.month.split('-');
		return {
			label: monthLabels[parseInt(m, 10) - 1] || m,
			primary: d.count,
			secondary: deletions.get(d.month) || 0,
			tertiary: conversions.get(d.month) || 0,
		};
	});
});

// Account detail computed
const activeCalcs = computed(() => detail.value?.calculators.filter((c: any) => c.activated).length ?? 0);
const totalMonthlyCalls = computed(() => detail.value?.calculators.reduce((s: number, c: any) => s + (c.monthly_calls || 0), 0) ?? 0);
const totalMonthlyErrors = computed(() => detail.value?.calculators.reduce((s: number, c: any) => s + (c.monthly_errors || 0), 0) ?? 0);
const errorRateLabel = computed(() => {
	if (!totalMonthlyCalls.value) return 'no calls';
	const pct = Math.round((totalMonthlyErrors.value / totalMonthlyCalls.value) * 100);
	return pct + '% error rate';
});
const calcProgress = computed(() => {
	const limit = detail.value?.subscription?.calculator_limit;
	if (!limit) return 0;
	return (detail.value!.calculators.length / limit) * 100;
});
const callsProgress = computed(() => {
	const limit = detail.value?.subscription?.calls_per_month;
	if (!limit) return 0;
	return (totalMonthlyCalls.value / limit) * 100;
});
const planVariant = computed(() => {
	const status = detail.value?.subscription?.status;
	if (!status || status === 'canceled' || status === 'expired') return 'danger' as const;
	if (status === 'trialing') return 'warning' as const;
	return 'success' as const;
});

const usageChartData = computed(() => {
	if (!detail.value) return [];
	return detail.value.usage.map(d => ({
		label: new Date(d.date).getDate().toString(),
		primary: d.total,
		secondary: d.errors,
	}));
});

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedFetch() {
	if (debounceTimer) clearTimeout(debounceTimer);
	debounceTimer = setTimeout(() => loadAccounts(), 300);
}

async function loadAccounts() {
	const result = await fetchAccounts({ search: search.value || undefined, page: meta.value.page, limit: meta.value.limit });
	if (result) {
		accounts.value = result.data;
		meta.value = result.meta;
	}
}

async function loadDetail() {
	if (!accountId.value) return;
	detail.value = await fetchAccountDetail(accountId.value);
}

function changePage(delta: number) {
	meta.value.page += delta;
	loadAccounts();
}

async function handleExtendTrial() {
	if (!accountId.value) return;
	actionLoading.value = true;
	actionError.value = null;
	actionSuccess.value = null;
	const result = await extendTrial(accountId.value, parseInt(trialDays.value, 10) || 7);
	actionLoading.value = false;
	if (result) {
		actionSuccess.value = `Trial extended to ${formatDate(result.trial_end)}`;
		await loadDetail();
	} else {
		actionError.value = 'Failed to extend trial';
	}
}

async function handleToggleExempt() {
	if (!accountId.value || !detail.value) return;
	actionLoading.value = true;
	actionError.value = null;
	actionSuccess.value = null;
	const newExempt = !detail.value.account.exempt_from_subscription;
	const result = await setExempt(accountId.value, newExempt);
	actionLoading.value = false;
	if (result) {
		actionSuccess.value = newExempt ? 'Account marked as exempt' : 'Exemption removed';
		await loadDetail();
	} else {
		actionError.value = 'Failed to update exemption';
	}
}

function formatDate(date: string | null): string {
	if (!date) return '—';
	return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date));
}

function formatDateShort(date: string | null): string {
	if (!date) return '—';
	return new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' }).format(new Date(date));
}

watch(accountId, (id) => {
	if (id) loadDetail();
	else {
		loadAccounts();
		if (!overview.value) fetchOverview().then(d => { overview.value = d; });
	}
}, { immediate: true });

onMounted(() => {
	if (!accountId.value) {
		loadAccounts();
		fetchOverview().then(d => { overview.value = d; });
	}
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

.toolbar {
	margin-bottom: 16px;
	max-width: 400px;
}

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

.plan-chips-inline {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	margin-top: 4px;
}

.actions-bar {
	display: flex;
	align-items: center;
	gap: 12px;
	flex-wrap: wrap;
}

.action-row {
	display: flex;
	align-items: center;
	gap: 8px;
}

.action-error {
	color: var(--theme--danger);
	font-size: 13px;
}

.action-success {
	color: var(--theme--success);
	font-size: 13px;
}

.section {
	margin-bottom: 24px;
}

.section-title {
	font-size: 14px;
	font-weight: 600;
	margin-bottom: 12px;
}

.chart-card {
	background: var(--theme--background);
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	padding: 20px;
}

.chart-legend {
	display: flex;
	justify-content: flex-end;
	gap: 16px;
	margin-top: 12px;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.legend-item { display: flex; align-items: center; gap: 4px; }
.legend-dot { width: 8px; height: 8px; border-radius: 50%; }
.dot-primary { background: var(--theme--primary); }
.dot-error { background: var(--theme--danger, #e35169); }
.dot-success { background: var(--theme--success, #2ecda7); }

.no-data {
	color: var(--theme--foreground-subdued);
	font-style: italic;
	font-size: 14px;
}

.exempt-badge {
	font-size: 10px;
	padding: 1px 6px;
	border-radius: 3px;
	background: var(--theme--primary-background);
	color: var(--theme--primary);
	font-weight: 600;
	margin-left: 6px;
}

.account-table {
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	overflow: hidden;
}

.acct-header, .acct-row {
	display: grid;
	grid-template-columns: 2fr 1fr 90px 100px 90px 80px;
	gap: 8px;
	padding: 12px 16px;
	align-items: center;
}

.acct-header {
	background: var(--theme--background-subdued);
	font-size: 11px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	text-transform: uppercase;
	letter-spacing: 0.5px;
}

.acct-row {
	border-top: 1px solid var(--theme--border-color);
	cursor: pointer;
	transition: background 0.15s;
	font-size: 14px;
}

.acct-row:hover {
	background: var(--theme--background-subdued);
}

.acct-name { font-weight: 600; }
.usage-value { font-weight: 600; }
.usage-total { color: var(--theme--foreground-subdued); font-size: 12px; }
.no-data-inline { color: var(--theme--foreground-subdued); }
.col-date { font-size: 12px; color: var(--theme--foreground-subdued); }

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

.chip-active {
	--v-chip-background-color: var(--theme--success-background);
	--v-chip-color: var(--theme--success);
}

.chip-trialing {
	--v-chip-background-color: var(--theme--warning-background);
	--v-chip-color: var(--theme--warning);
}

.chip-canceled, .chip-expired {
	--v-chip-background-color: var(--theme--danger-background);
	--v-chip-color: var(--theme--danger);
}
</style>
