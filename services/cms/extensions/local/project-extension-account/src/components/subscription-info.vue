<template>
	<div class="subscription-info">
		<!-- AI Wallet card — always at the top, even when balance is zero. -->
		<div class="card wallet-card" :class="{ 'low-balance': isLowBalance }">
			<div class="card-header">
				<div class="card-title-row">
					<v-icon name="account_balance_wallet" />
					<span class="card-title">AI Wallet</span>
				</div>
				<v-chip v-if="wallet.auto_reload_enabled" small class="chip-info">Auto-reload on</v-chip>
			</div>
			<div class="wallet-balance">{{ formatEur(wallet.balance_eur) }}</div>
			<div v-if="wallet.monthly_cap_eur" class="wallet-meta">
				Monthly cap: {{ formatEur(wallet.monthly_cap_eur) }}
			</div>
			<v-notice v-if="isLowBalance" type="warning" class="wallet-warning">
				Balance is low. Top up to keep AI calls flowing.
			</v-notice>
			<div class="card-actions">
				<v-button small @click="handleTopup">
					<v-icon name="add" left small />
					Top up
				</v-button>
				<v-button small secondary @click="walletSettingsVisible = true">
					<v-icon name="settings" left small />
					Settings
				</v-button>
				<v-button v-if="wallet.recent_ledger.length" small secondary @click="ledgerVisible = !ledgerVisible">
					<v-icon name="history" left small />
					{{ ledgerVisible ? 'Hide' : 'View' }} transactions
				</v-button>
			</div>

			<div v-if="ledgerVisible && wallet.recent_ledger.length" class="ledger-list">
				<div
					v-for="entry in wallet.recent_ledger.slice(0, 10)"
					:key="entry.id"
					class="ledger-row"
				>
					<div class="ledger-col-source">
						<v-icon
							:name="entry.entry_type === 'credit' ? 'arrow_downward' : 'arrow_upward'"
							:class="entry.entry_type === 'credit' ? 'icon-credit' : 'icon-debit'"
							small
						/>
						<span>{{ formatLedgerSource(entry.source, entry.entry_type) }}</span>
					</div>
					<div class="ledger-col-amount" :class="entry.entry_type === 'credit' ? 'icon-credit' : 'icon-debit'">
						{{ entry.entry_type === 'credit' ? '+' : '−' }}{{ formatEur(entry.amount_eur) }}
					</div>
					<div class="ledger-col-date">{{ formatDateShort(entry.occurred_at) }}</div>
				</div>
			</div>
		</div>

		<!-- Wallet auto-reload settings dialog -->
		<wallet-settings-dialog
			v-model="walletSettingsVisible"
			:initial-config="walletConfig"
			:saving="walletConfigSaving"
			:save-error="walletConfigError"
			@save="handleWalletConfigSave"
		/>

		<!-- Per-module subscription cards — one per module, in fixed order. -->
		<div
			v-for="mod in moduleOrder"
			:key="mod.key"
			class="card module-card"
			:class="{ inactive: !subscriptionsByModule[mod.key] }"
		>
			<div class="card-header">
				<div class="card-title-row">
					<v-icon :name="mod.icon" />
					<span class="card-title">{{ mod.label }}</span>
				</div>
				<v-chip v-if="subscriptionsByModule[mod.key]" small :class="statusClass(subscriptionsByModule[mod.key]!.status)">
					{{ statusLabel(subscriptionsByModule[mod.key]!.status) }}
				</v-chip>
				<v-chip v-else small class="chip-muted">Not active</v-chip>
			</div>

			<template v-if="subscriptionsByModule[mod.key]">
				<div class="plan-tier">
					{{ subscriptionsByModule[mod.key]!.plan?.name || tierLabel(subscriptionsByModule[mod.key]!.tier) }}
				</div>

				<div class="allowances">
					<div
						v-for="row in allowanceRows(mod.key, subscriptionsByModule[mod.key]!)"
						:key="row.label"
						class="allowance-row"
					>
						<span class="allowance-label">{{ row.label }}</span>
						<span class="allowance-value">{{ row.value }}</span>
					</div>
				</div>

				<div class="card-meta">
					<span v-if="subscriptionsByModule[mod.key]!.current_period_end">
						Renews {{ formatDateLong(subscriptionsByModule[mod.key]!.current_period_end!) }}
					</span>
					<span v-else-if="subscriptionsByModule[mod.key]!.trial_end">
						Trial ends {{ formatDateLong(subscriptionsByModule[mod.key]!.trial_end!) }}
					</span>
				</div>

				<div v-if="subscriptionsByModule[mod.key]!.plan" class="card-meta">
					{{ priceLabel(subscriptionsByModule[mod.key]!) }}
				</div>
			</template>

			<template v-else>
				<p class="not-active-msg">No active subscription for this module.</p>
				<div class="card-actions">
					<v-button small @click="$emit('activate', mod.key)">
						<v-icon name="add" left small />
						Activate
					</v-button>
				</div>
			</template>
		</div>

		<!-- Monthly total — sum of active module subs, normalised to per-month. -->
		<div class="total-card">
			<span class="total-label">Subscription total</span>
			<span class="total-value">{{ formatEur(monthlyTotalEur) }}<span class="total-period">/mo</span></span>
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import type { SubscriptionsByModule, AIWalletState, Module, Subscription, SubscriptionStatus } from '../types';
import WalletSettingsDialog from './wallet-settings-dialog.vue';
import { formatApiError } from '../utils/format-api-error';

const props = defineProps<{
	subscriptionsByModule: SubscriptionsByModule;
	wallet: AIWalletState;
	monthlyTotalEur: number;
}>();

const emit = defineEmits<{
	topup: [];
	activate: [module: Module];
	walletUpdated: [];
}>();

const api = useApi();
const ledgerVisible = ref(false);
const walletSettingsVisible = ref(false);
const walletConfigSaving = ref(false);
const walletConfigError = ref<string | null>(null);

const walletConfig = computed(() => ({
	auto_reload_enabled: props.wallet.auto_reload_enabled,
	auto_reload_threshold_eur: (props.wallet as any).auto_reload_threshold_eur ?? null,
	auto_reload_amount_eur: (props.wallet as any).auto_reload_amount_eur ?? null,
	monthly_cap_eur: props.wallet.monthly_cap_eur != null ? Number(props.wallet.monthly_cap_eur) : null,
}));

async function handleWalletConfigSave(config: {
	auto_reload_enabled: boolean;
	auto_reload_threshold_eur: number | null;
	auto_reload_amount_eur: number | null;
	monthly_cap_eur: number | null;
}) {
	walletConfigSaving.value = true;
	walletConfigError.value = null;
	try {
		await api.post('/stripe/wallet-config', config);
		walletSettingsVisible.value = false;
		emit('walletUpdated');
	} catch (err: any) {
		walletConfigError.value = formatApiError(err);
	} finally {
		walletConfigSaving.value = false;
	}
}

const moduleOrder: { key: Module; label: string; icon: string }[] = [
	{ key: 'calculators', label: 'Calculators', icon: 'calculate' },
	{ key: 'kb', label: 'Knowledge Base', icon: 'menu_book' },
	{ key: 'flows', label: 'Flows', icon: 'account_tree' },
];

const isLowBalance = computed(() => Number(props.wallet.balance_eur) < 1);

function formatEur(n: number | string | null | undefined): string {
	const v = Number(n || 0);
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(v);
}

function formatDateLong(iso: string): string {
	return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));
}

function formatDateShort(iso: string): string {
	return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(iso));
}

function statusLabel(s: SubscriptionStatus | string): string {
	switch (s) {
		case 'trialing': return 'Trial';
		case 'active': return 'Active';
		case 'past_due': return 'Past Due';
		case 'canceled': return 'Canceled';
		case 'expired': return 'Expired';
		default: return String(s || 'Unknown');
	}
}

function statusClass(s: SubscriptionStatus | string): string {
	switch (s) {
		case 'active': return 'chip-active';
		case 'trialing': return 'chip-trial';
		case 'past_due': return 'chip-past-due';
		case 'canceled':
		case 'expired': return 'chip-danger';
		default: return '';
	}
}

function tierLabel(t: string | null | undefined): string {
	if (!t) return 'Unknown';
	return t.charAt(0).toUpperCase() + t.slice(1);
}

// Per-module allowance breakdown (only the fields that matter for that module).
function allowanceRows(mod: Module, sub: Subscription): { label: string; value: string }[] {
	const plan = sub.plan;
	if (!plan) return [];
	const fmtNullable = (v: number | null | undefined, suffix = '') =>
		v == null ? 'Unlimited' : `${v.toLocaleString()}${suffix}`;

	if (mod === 'calculators') {
		return [
			{ label: 'Slots', value: fmtNullable(plan.slot_allowance) },
			{ label: 'Always-on', value: fmtNullable(plan.ao_allowance) },
			{ label: 'Requests / mo', value: fmtNullable(plan.request_allowance) },
		];
	}
	if (mod === 'kb') {
		return [
			{ label: 'Storage', value: plan.storage_mb == null ? 'Unlimited' : `${plan.storage_mb.toLocaleString()} MB` },
			{ label: 'Embed tokens / mo', value: plan.embed_tokens_m == null ? 'Unlimited' : `${plan.embed_tokens_m}M` },
		];
	}
	// flows
	return [
		{ label: 'Executions / mo', value: fmtNullable(plan.executions) },
		{ label: 'Max steps / flow', value: fmtNullable(plan.max_steps) },
		{ label: 'Concurrent runs', value: fmtNullable(plan.concurrent_runs) },
	];
}

function priceLabel(sub: Subscription): string {
	const plan = sub.plan;
	if (!plan) return '';
	if (sub.billing_cycle === 'annual') {
		const annual = Number(plan.price_eur_annual || 0);
		if (!annual) return '';
		const monthly = Math.round((annual / 12) * 100) / 100;
		return `${formatEur(monthly)}/mo (billed ${formatEur(annual)}/yr)`;
	}
	const monthly = Number(plan.price_eur_monthly || 0);
	return monthly ? `${formatEur(monthly)}/mo` : '';
}

function formatLedgerSource(source: string, kind: 'credit' | 'debit'): string {
	switch (source) {
		case 'topup': return 'Top-up';
		case 'usage': return 'AI usage';
		case 'refund': return 'Refund';
		case 'promo': return 'Promotional credit';
		case 'adjustment': return kind === 'credit' ? 'Adjustment (credit)' : 'Adjustment (debit)';
		default: return source;
	}
}

function handleTopup() {
	// Bubble up — the parent route owns the topup action so the redirect can
	// happen via the composable. Default to €20 (smallest standard amount).
	emit('topup');
}
</script>

<style scoped>
.subscription-info {
	display: flex;
	flex-direction: column;
	gap: 16px;
}

.card {
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	padding: 20px;
	background: var(--theme--background);
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.card.inactive {
	background: var(--theme--background-subdued);
	border-style: dashed;
}

.wallet-card {
	border-color: var(--theme--primary);
	background: var(--theme--primary-background);
}

.wallet-card.low-balance {
	border-color: var(--theme--warning, #d8a04e);
}

.card-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}

.card-title-row {
	display: flex;
	align-items: center;
	gap: 8px;
}

.card-title {
	font-size: 14px;
	font-weight: 700;
	color: var(--theme--foreground);
	text-transform: uppercase;
	letter-spacing: 0.4px;
}

.wallet-balance {
	font-size: 28px;
	font-weight: 700;
	color: var(--theme--foreground);
}

.wallet-meta {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.wallet-warning {
	margin: 4px 0;
}

.plan-tier {
	font-size: 18px;
	font-weight: 700;
}

.allowances {
	display: flex;
	flex-direction: column;
	gap: 6px;
	border-top: 1px solid var(--theme--border-color);
	border-bottom: 1px solid var(--theme--border-color);
	padding: 10px 0;
}

.allowance-row {
	display: flex;
	justify-content: space-between;
	font-size: 13px;
}

.allowance-label {
	color: var(--theme--foreground-subdued);
}

.allowance-value {
	font-weight: 600;
}

.card-meta {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.card-actions {
	display: flex;
	gap: 8px;
	margin-top: 4px;
	flex-wrap: wrap;
}

.not-active-msg {
	margin: 0;
	font-size: 13px;
	color: var(--theme--foreground-subdued);
}

.ledger-list {
	border-top: 1px solid var(--theme--border-color);
	margin-top: 4px;
	padding-top: 8px;
	display: flex;
	flex-direction: column;
}

.ledger-row {
	display: grid;
	grid-template-columns: 1fr auto auto;
	gap: 12px;
	padding: 6px 0;
	font-size: 12px;
	align-items: center;
}

.ledger-col-source {
	display: flex;
	align-items: center;
	gap: 6px;
	color: var(--theme--foreground);
}

.ledger-col-amount {
	font-weight: 600;
}

.ledger-col-date {
	color: var(--theme--foreground-subdued);
}

.icon-credit { color: var(--theme--success, #2ecda7); }
.icon-debit { color: var(--theme--foreground-subdued); }

.total-card {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	padding: 14px 20px;
	background: var(--theme--background-subdued);
	border-radius: var(--theme--border-radius);
}

.total-label {
	font-size: 13px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	text-transform: uppercase;
	letter-spacing: 0.4px;
}

.total-value {
	font-size: 22px;
	font-weight: 700;
}

.total-period {
	font-size: 13px;
	font-weight: 400;
	color: var(--theme--foreground-subdued);
}

.chip-active {
	--v-chip-background-color: var(--theme--success-background, rgba(46, 205, 167, 0.1));
	--v-chip-color: var(--theme--success);
}

.chip-trial {
	--v-chip-background-color: var(--theme--warning-background);
	--v-chip-color: var(--theme--warning);
}

.chip-past-due {
	--v-chip-background-color: rgba(216, 160, 78, 0.15);
	--v-chip-color: #b97c2a;
}

.chip-danger {
	--v-chip-background-color: var(--theme--danger-background);
	--v-chip-color: var(--theme--danger);
}

.chip-info {
	--v-chip-background-color: var(--theme--primary-background);
	--v-chip-color: var(--theme--primary);
}

.chip-muted {
	--v-chip-background-color: var(--theme--background-subdued);
	--v-chip-color: var(--theme--foreground-subdued);
}
</style>
