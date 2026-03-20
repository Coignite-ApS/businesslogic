<template>
	<div class="config-section">
		<div class="section-header">
			<h2 class="section-title">{{ title }}</h2>
			<p class="section-desc">{{ subtitle }}</p>
		</div>

		<!-- Over-limit warning -->
		<v-notice v-if="!editable && overLimit && activated" type="warning" class="overlimit-notice">
			<div class="overlimit-content">
				<span v-if="activationExpired">Over plan limit — this calculator is being deactivated. Upgrade your plan or deactivate another calculator.</span>
				<span v-else>Over plan limit — deactivating in {{ countdownText(activationExpiresAt) }}. Upgrade your plan or deactivate another calculator.</span>
				<v-button class="overlimit-btn" small @click="openUpgradeDialog()">
					<v-icon name="upgrade" left />
					Upgrade plan
				</v-button>
			</div>
		</v-notice>

		<div v-if="config" :class="['config-box', label === 'Test' ? 'test-env' : 'live-env']">
			<div class="config-grid">
				<div class="config-field">
					<div class="config-label">Version</div>
					<div class="config-value version-value">
						{{ displayVersion }}
						<v-icon
							v-if="configIsComplete"
							class="token-action"
							name="download"
							small
							clickable
							v-tooltip.bottom="'Download Excel'"
							@click="$emit('download')"
						/>
					</div>
				</div>
				<div class="config-field">
					<div class="config-label">Status</div>
					<div class="config-value status-value">
						<template v-if="verifying">
							<v-progress-circular x-small indeterminate />
						</template>
						<template v-else-if="editable">
							<!-- Test card -->
							<template v-if="testActive">
								<v-chip small class="deployed-chip">
									<v-icon name="cloud_done" x-small left />
									Active · {{ countdownText(testExpiresAt) }}
								</v-chip>
							</template>
							<template v-else>
								<v-chip small class="inactive-chip">
									<v-icon name="cloud_off" x-small left />
									Deactivated
								</v-chip>
							</template>
						</template>
						<template v-else>
							<!-- Live card -->
							<template v-if="loading">
								<v-progress-circular x-small indeterminate />
								<span class="status-hint">{{ activated ? 'Deactivating…' : 'Activating…' }}</span>
							</template>
							<template v-else-if="activated && overLimit && activationExpired">
								<v-chip small class="danger-chip">
									<v-icon name="warning" x-small left />
									Expiring
								</v-chip>
							</template>
							<template v-else-if="activated && overLimit">
								<v-chip small class="warning-chip">
									<v-icon name="schedule" x-small left />
									Active · {{ countdownText(activationExpiresAt) }}
								</v-chip>
							</template>
							<template v-else-if="activated">
								<v-chip small class="deployed-chip">
									<v-icon name="cloud_done" x-small left />
									Active
								</v-chip>
							</template>
							<template v-else>
								<v-chip small class="inactive-chip">
									<v-icon name="cloud_off" x-small left />
									Deactivated
								</v-chip>
							</template>
						</template>
					</div>
				</div>
				<div v-if="effectiveId" class="config-field">
					<div class="config-label">Calculator ID</div>
					<div class="config-value token-value">
						<code>{{ effectiveId }}</code>
						<v-icon
							class="token-action"
							name="content_copy"
							small
							clickable
							v-tooltip.bottom="'Copy'"
							@click="copyText(effectiveId)"
						/>
					</div>
				</div>
				<div class="config-field">
					<div class="config-label">API token</div>
					<div class="config-value token-value">
						<template v-if="config.api_key">
							<v-progress-circular v-if="fetchingKey" x-small indeterminate />
							<code v-else-if="showApiKey && decryptedKey">{{ decryptedKey }}</code>
							<code v-else>{{ maskedKey }}</code>
							<v-icon
								class="token-action"
								:name="showApiKey ? 'visibility_off' : 'visibility'"
								small
								clickable
								@click="toggleShowKey"
							/>
							<v-icon
								class="token-action"
								name="content_copy"
								small
								clickable
								v-tooltip.bottom="'Copy'"
								@click="copyApiKey"
							/>
						</template>
						<span v-else class="muted">not set</span>
						<v-dialog v-model="confirmRegenerate" @esc="confirmRegenerate = false">
							<template #activator="{ on }">
								<span class="token-action-link" @click="on">
									<v-icon name="refresh" small class="token-action" />
									{{ config.api_key ? 'Regenerate' : 'Generate' }}
								</span>
							</template>
							<v-card>
								<v-card-title>Regenerate Token</v-card-title>
								<v-card-text>{{ config.api_key ? 'The current token will be replaced. Any integrations using it will stop working.' : 'A new API token will be generated for this configuration.' }}</v-card-text>
								<v-card-actions>
									<v-button secondary @click="confirmRegenerate = false">Cancel</v-button>
									<v-button kind="danger" @click="$emit('regenerate-api-key'); confirmRegenerate = false">Regenerate Token</v-button>
								</v-card-actions>
							</v-card>
						</v-dialog>
					</div>
				</div>
			</div>
		</div>

		<div v-else class="config-empty">
			<span class="muted">No {{ label.toLowerCase() }} configuration yet.</span>
		</div>

		<!-- Unresolved functions warning -->
		<v-notice v-if="unresolvedFunctions?.length" type="warning" class="unresolved-notice">
			Unsupported Excel functions: {{ unresolvedFunctions.map((f: any) => f.name).join(', ') }}.
			These may cause #NAME? errors in calculations.
		</v-notice>

		<!-- Action error -->
		<v-notice v-if="actionError" type="danger" class="action-error">{{ actionError }}</v-notice>

		<div class="section-actions">
			<template v-if="editable">
				<v-button secondary :disabled="!config" @click="$emit('configure')">
					<v-icon name="tune" left />
					Configure {{ displayVersion }}
				</v-button>
				<v-button secondary :disabled="!config" @click="$emit('test')">
					<v-icon name="play_arrow" left />
					Test {{ displayVersion }}
				</v-button>
				<div class="actions-spacer" />
				<span v-if="configChanged" class="changed-hint">Configuration has changed.</span>
				<v-button
					:disabled="!canLaunch"
					:loading="loading"
					@click="$emit('launch')"
				>
					<v-icon name="rocket_launch" left />
					Go live {{ displayVersion }}
				</v-button>
			</template>
			<template v-else>
				<v-button v-if="activated" kind="warning" :loading="loading" @click="confirmDeactivateVisible = true">
					<v-icon name="power_settings_new" left />
					Deactivate
				</v-button>
				<v-button v-if="!activated && !overLimit" :disabled="!config" :loading="loading" @click="$emit('activate')">
					<v-icon name="rocket_launch" left />
					Activate {{ displayVersion }}
				</v-button>
			</template>
		</div>

		<!-- Deactivate confirmation -->
		<v-dialog v-model="confirmDeactivateVisible" @esc="confirmDeactivateVisible = false">
			<v-card>
				<v-card-title>Deactivate Calculator?</v-card-title>
				<v-card-text>This will remove the calculator from the Formula API. It can be reactivated later by clicking Activate.</v-card-text>
				<v-card-actions>
					<v-button secondary @click="confirmDeactivateVisible = false">Cancel</v-button>
					<v-button kind="danger" @click="confirmDeactivateVisible = false; $emit('deactivate')">Deactivate</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<!-- Upgrade plan dialog -->
		<v-dialog v-model="upgradeVisible" @esc="upgradeVisible = false">
			<v-card class="upgrade-card">
				<div class="upgrade-body">
					<div class="upgrade-title">Upgrade Plan</div>
					<p class="upgrade-desc">You've reached the calculator limit on your current plan. Upgrade to activate more calculators, increase your API call volume, and unlock higher throughput.</p>

					<div v-if="!plansLoaded" class="upgrade-loading">
						<v-progress-circular indeterminate />
					</div>
					<plan-cards
						v-else
						:plans="plans"
						:current-plan-id="currentPlanId"
						:current-plan-sort="currentPlanSort"
						:checking-out="checkingOut"
						:error="upgradeError"
						@checkout="handleCheckout"
					/>

					<div class="upgrade-actions">
						<v-button secondary @click="upgradeVisible = false">Close</v-button>
					</div>
				</div>
			</v-card>
		</v-dialog>
	</div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import type { CalculatorConfig } from '../types';
import PlanCards from 'project-shared-ui/plan-cards.vue';
import type { PlanInfo } from 'project-shared-ui/plan-cards.vue';

interface SubscriptionInfo {
	plan: { id: string; sort: number | null };
}

const props = defineProps<{
	config: CalculatorConfig | null;
	label: 'Test' | 'Live';
	title: string;
	subtitle: string;
	editable: boolean;
	loading: boolean;
	configChanged: boolean;
	canLaunch: boolean;
	activated?: boolean;
	calculatorId?: string;
	testEnabled?: boolean;
	testExpiresAt?: string | null;
	overLimit?: boolean;
	activationExpiresAt?: string | null;
	actionError?: string | null;
}>();

defineEmits<{
	launch: [];
	configure: [];
	test: [];
	activate: [];
	deactivate: [];
	'regenerate-api-key': [];
	download: [];
}>();

const api = useApi();

// Reactive tick for countdown (30s)
const countdownTick = ref(0);
let tickInterval: ReturnType<typeof setInterval> | null = null;
onMounted(() => { tickInterval = setInterval(() => { countdownTick.value++; }, 30_000); });
onBeforeUnmount(() => { if (tickInterval) clearInterval(tickInterval); });

const activationExpired = computed(() => {
	void countdownTick.value;
	if (!props.activationExpiresAt) return false;
	return new Date(props.activationExpiresAt).getTime() <= Date.now();
});

const displayVersion = computed(() => {
	if (!props.config) return '';
	const cv = props.config.config_version || '0';
	const fv = props.config.file_version || 0;
	return `${cv}.${fv}`;
});

const effectiveId = computed(() => {
	if (!props.calculatorId) return '';
	return props.config?.test_environment ? `${props.calculatorId}-test` : props.calculatorId;
});

const unresolvedFunctions = computed(() => props.config?.unresolved_functions || null);

const configIsComplete = computed(() => {
	const c = props.config;
	return !!(c?.sheets && c?.formulas && c?.input && c?.output);
});

// Verify deployment by pinging Formula API proxy
const verifying = ref(false);
const verified = ref<boolean | null>(null);

async function verifyDeployment() {
	if (!effectiveId.value || !configIsComplete.value) {
		verified.value = null;
		return;
	}
	verifying.value = true;
	try {
		await api.get(`/calc/status/${effectiveId.value}`);
		verified.value = true;
	} catch {
		verified.value = false;
	} finally {
		verifying.value = false;
	}
}

watch(configIsComplete, (complete) => {
	if (complete) verifyDeployment();
	else verified.value = null;
}, { immediate: true });

const showApiKey = ref(false);
const decryptedKey = ref<string | null>(null);
const fetchingKey = ref(false);
const confirmRegenerate = ref(false);
const confirmDeactivateVisible = ref(false);

function countdownText(expiresAt: string | null | undefined): string {
	void countdownTick.value;
	if (!expiresAt) return '';
	const ms = new Date(expiresAt).getTime() - Date.now();
	if (ms <= 0) return '(expired)';
	const h = Math.floor(ms / 3_600_000);
	const m = Math.floor((ms % 3_600_000) / 60_000);
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

const testActive = computed(() => {
	return props.testEnabled && props.testExpiresAt && new Date(props.testExpiresAt) > new Date();
});

const maskedKey = computed(() => {
	if (decryptedKey.value) {
		const key = decryptedKey.value;
		if (key.length <= 8) return '*'.repeat(key.length);
		return key.slice(0, 4) + '*'.repeat(key.length - 8) + key.slice(-4);
	}
	// Token exists but not yet decrypted — show generic mask
	return props.config?.api_key ? '••••••••••••••••' : '';
});

async function ensureDecrypted(): Promise<string | null> {
	if (decryptedKey.value) return decryptedKey.value;
	if (!props.config?.id) return null;
	fetchingKey.value = true;
	try {
		const { data } = await api.get(`/calc/api-key/${props.config.id}`);
		decryptedKey.value = data.api_key || null;
		return decryptedKey.value;
	} catch {
		return null;
	} finally {
		fetchingKey.value = false;
	}
}

async function toggleShowKey() {
	if (showApiKey.value) {
		showApiKey.value = false;
		return;
	}
	await ensureDecrypted();
	showApiKey.value = true;
}

function copyText(text: string) {
	navigator.clipboard.writeText(text);
}

async function copyApiKey() {
	const key = await ensureDecrypted();
	if (key) navigator.clipboard.writeText(key);
}

// Reset decrypted key when config changes
watch(() => props.config?.api_key, () => {
	decryptedKey.value = null;
	showApiKey.value = false;
});

// Upgrade plan dialog
const upgradeVisible = ref(false);
const plansLoaded = ref(false);
const plans = ref<PlanInfo[]>([]);
const subscription = ref<SubscriptionInfo | null>(null);
const checkingOut = ref<string | null>(null);
const upgradeError = ref<string | null>(null);

const currentPlanId = computed(() => subscription.value?.plan?.id || null);
const currentPlanSort = computed(() => subscription.value?.plan?.sort ?? null);

async function fetchUpgradeData() {
	if (plansLoaded.value) return;
	upgradeError.value = null;
	try {
		const [plansRes, userRes] = await Promise.all([
			api.get('/items/subscription_plans', {
				params: {
					filter: { status: { _eq: 'published' } },
					sort: ['sort'],
					fields: ['id', 'name', 'calculator_limit', 'calls_per_month', 'calls_per_second', 'monthly_price', 'yearly_price', 'sort'],
				},
			}),
			api.get('/users/me', { params: { fields: ['active_account'] } }),
		]);
		plans.value = plansRes.data.data || [];

		const accountId = userRes.data.data?.active_account;
		if (accountId) {
			const subRes = await api.get('/items/subscriptions', {
				params: {
					filter: { account: { _eq: accountId } },
					fields: ['plan.id', 'plan.sort'],
					limit: 1,
				},
			});
			subscription.value = subRes.data.data?.[0] || null;
		}
		plansLoaded.value = true;
	} catch (err: any) {
		upgradeError.value = err?.response?.data?.errors?.[0]?.message || err.message || 'Failed to load plans';
	}
}

function openUpgradeDialog() {
	upgradeVisible.value = true;
	fetchUpgradeData();
}

defineExpose({ openUpgradeDialog });

async function handleCheckout(planId: string) {
	checkingOut.value = planId;
	upgradeError.value = null;
	try {
		const { data } = await api.post('/stripe/checkout', { plan_id: planId });
		if (data.url) {
			window.location.href = data.url;
		}
	} catch (err: any) {
		upgradeError.value = err?.response?.data?.errors?.[0]?.message || err.message || 'Checkout failed';
	} finally {
		checkingOut.value = null;
	}
}

</script>

<style scoped>
.config-section {
	border-top: var(--theme--border-width) solid var(--theme--border-color);
	padding-top: 24px;
}

.section-header {
	margin-bottom: 16px;
}

.section-title {
	margin: 0 0 4px;
	font-size: 18px;
	font-weight: 700;
}

.section-desc {
	margin: 0;
	font-size: 14px;
	color: var(--theme--foreground-subdued);
}

.config-box {
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	padding: 16px 20px;
	margin-bottom: 16px;
	background: var(--theme--background-subdued);
}

.config-box.test-env {
	background: color-mix(in srgb, var(--theme--primary) 8%, var(--theme--background));
	border-color: var(--theme--primary);
}

.config-box.live-env {
	background: color-mix(in srgb, var(--theme--success) 8%, var(--theme--background));
	border-color: var(--theme--success);
}

.config-grid {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 16px 40px;
}

.config-label {
	font-size: 13px;
	font-weight: 600;
	margin-bottom: 2px;
}

.test-env .config-label {
	color: color-mix(in srgb, var(--theme--primary) 80%, #000);
}

.live-env .config-label {
	color: color-mix(in srgb, var(--theme--success) 80%, #000);
}

.config-value {
	font-size: 14px;
}

.version-value {
	display: flex;
	align-items: center;
	gap: 6px;
}

.status-value {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
}

.token-value {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
}

.token-value code {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 13px;
	word-break: break-all;
}

.token-action {
	color: var(--theme--foreground-subdued);
	cursor: pointer;
}

.token-action:hover {
	color: var(--theme--foreground);
}

.config-empty {
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	padding: 24px 20px;
	margin-bottom: 16px;
	text-align: center;
}

.section-actions {
	display: flex;
	align-items: center;
	gap: 8px;
	padding-bottom: 24px;
}

.actions-spacer {
	flex: 1;
}

.changed-hint {
	font-size: 14px;
	color: var(--theme--warning);
}

.deployed-chip {
	--v-chip-background-color: var(--theme--success);
	--v-chip-color: #fff;
}

.inactive-chip {
	--v-chip-background-color: var(--theme--foreground-subdued);
	--v-chip-color: #fff;
}

.warning-chip {
	--v-chip-background-color: var(--theme--warning);
	--v-chip-color: #fff;
}

.danger-chip {
	--v-chip-background-color: var(--theme--danger);
	--v-chip-color: #fff;
}

.status-hint {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	font-style: italic;
}

.token-action-link {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	font-size: 14px;
	color: var(--theme--foreground-subdued);
	cursor: pointer;
	margin-top: -4px;
}

.token-action-link:hover {
	color: var(--theme--foreground);
}

.token-action-link:hover .token-action {
	color: var(--theme--foreground);
}

.muted {
	color: var(--theme--foreground-subdued);
	font-size: 14px;
}

.unresolved-notice {
	margin-bottom: 12px;
}

.action-error {
	margin-bottom: 12px;
}

.overlimit-notice {
	margin-bottom: 12px;
}

.overlimit-content {
	display: flex;
	align-items: center;
	gap: 16px;
	width: 100%;
}

.overlimit-content span {
	flex: 1;
}

.overlimit-btn {
	flex-shrink: 0;
}

.upgrade-card {
	max-width: 900px;
}

.upgrade-body {
	padding: 24px;
}

.upgrade-title {
	font-size: 24px;
	font-weight: 700;
	line-height: 32px;
}

.upgrade-desc {
	margin: 6px 0 0;
	font-size: 14px;
	line-height: 22px;
	color: var(--theme--foreground-subdued);
}

.upgrade-loading {
	display: flex;
	justify-content: center;
	padding: 32px 0;
}

.upgrade-actions {
	display: flex;
	justify-content: flex-end;
	margin-top: 20px;
}
</style>
