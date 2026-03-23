<template>
	<private-view title="Account">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="account_circle" />
			</v-button>
		</template>

		<template #navigation>
			<v-list nav>
				<v-list-item to="/account" :active="!isSubscriptionRoute" clickable>
					<v-list-item-icon><v-icon name="settings" /></v-list-item-icon>
					<v-list-item-content>Account Settings</v-list-item-content>
				</v-list-item>
				<v-list-item to="/account/subscription" :active="isSubscriptionRoute" clickable>
					<v-list-item-icon><v-icon name="credit_card" /></v-list-item-icon>
					<v-list-item-content>Subscription</v-list-item-content>
				</v-list-item>
			</v-list>
		</template>

		<div class="module-content" v-if="activeAccountId">
			<!-- Usage Stats -->
			<div class="section">
				<h2 class="section-title">Usage</h2>
				<div class="stats-grid">
					<div class="stat-card">
						<div class="stat-header">
							<v-icon name="calculate" />
							<span class="stat-label">Calculators</span>
						</div>
						<div class="stat-value">
							<span class="stat-current">{{ calculatorCount }}</span>
							<span class="stat-limit" v-if="calculatorLimit !== null"> / {{ calculatorLimit }}</span>
							<span class="stat-limit" v-else> / Unlimited</span>
						</div>
						<div class="stat-bar" v-if="calculatorLimit">
							<div class="stat-bar-fill" :style="{ width: calculatorPercent + '%' }" :class="{ warning: calculatorPercent > 80 }" />
						</div>
					</div>
					<div class="stat-card">
						<div class="stat-header">
							<v-icon name="trending_up" />
							<span class="stat-label">API Calls This Month</span>
						</div>
						<div class="stat-value">
							<span class="stat-current">{{ apiCallCount.toLocaleString() }}</span>
							<span class="stat-limit" v-if="callsLimit !== null"> / {{ callsLimit.toLocaleString() }}</span>
							<span class="stat-limit" v-else> / Unlimited</span>
						</div>
						<div class="stat-bar" v-if="callsLimit">
							<div class="stat-bar-fill" :style="{ width: apiCallPercent + '%' }" :class="{ warning: apiCallPercent > 80 }" />
						</div>
					</div>
				</div>
			</div>

			<!-- API Keys -->
			<div class="section">
				<h2 class="section-title">API Keys</h2>
				<p class="section-desc">Authenticate widget & API requests through the gateway with resource-level permissions.</p>

				<div v-if="apiKeys.length > 0" class="tokens-table">
					<div class="tokens-header">
						<span>Name</span>
						<span>Prefix</span>
						<span>Environment</span>
						<span>Created</span>
						<span></span>
					</div>
					<div v-for="key in apiKeys" :key="key.id" class="tokens-row">
						<span class="token-label">{{ key.name }}</span>
						<span class="token-date"><code>{{ key.key_prefix }}...</code></span>
						<span>
							<v-chip small :class="key.environment === 'live' ? 'active-chip' : 'test-chip'">
								{{ key.environment }}
							</v-chip>
						</span>
						<span class="token-date">{{ formatDate(key.created_at) }}</span>
						<span class="token-actions">
							<v-button x-small secondary @click="handleRotateKey(key.id)">Rotate</v-button>
							<v-button x-small kind="danger" secondary @click="handleRevokeKey(key.id)">Revoke</v-button>
						</span>
					</div>
				</div>
				<div v-else class="tokens-empty">
					<span class="muted">No API keys yet. Create one to authenticate widget & API requests.</span>
				</div>

				<div class="token-create-row">
					<v-input v-model="newKeyName" placeholder="Key name (e.g. Production)" small />
					<v-select
						v-model="newKeyEnv"
						:items="[{ text: 'Live', value: 'live' }, { text: 'Test', value: 'test' }]"
						small
						inline
					/>
					<v-button small :loading="creatingKey" @click="handleCreateKey">
						<v-icon name="add" left />
						Create Key
					</v-button>
				</div>

				<v-notice v-if="newlyCreatedKey" type="info" class="new-token-notice">
					<div class="new-token-content">
						<strong>Copy this key now — it won't be shown again:</strong>
						<code class="new-token-value">{{ newlyCreatedKey }}</code>
						<v-icon
							name="content_copy"
							small
							clickable
							class="copy-icon"
							@click="copyToClipboard(newlyCreatedKey)"
						/>
					</div>
				</v-notice>
			</div>

			<!-- Legacy Formula Tokens -->
			<div class="section" v-if="formulaTokens.length > 0">
				<h2 class="section-title">
					Formula Tokens
					<v-chip small class="legacy-chip">Legacy</v-chip>
				</h2>
				<p class="section-desc">Per-calculator tokens. Migrate to API Keys above for resource-level permissions.</p>

				<div class="tokens-table">
					<div class="tokens-header">
						<span>Label</span>
						<span>Created</span>
						<span>Last Used</span>
						<span>Status</span>
						<span></span>
					</div>
					<div v-for="tok in formulaTokens" :key="tok.id" class="tokens-row">
						<span class="token-label">{{ tok.label }}</span>
						<span class="token-date">{{ formatDate(tok.date_created) }}</span>
						<span class="token-date">{{ tok.last_used_at ? formatDate(tok.last_used_at) : '—' }}</span>
						<span>
							<v-chip small :class="tok.revoked ? 'revoked-chip' : 'active-chip'">
								{{ tok.revoked ? 'Revoked' : 'Active' }}
							</v-chip>
						</span>
						<span class="token-actions">
							<v-button v-if="!tok.revoked" x-small kind="danger" secondary @click="handleRevoke(tok.id)">
								Revoke
							</v-button>
						</span>
					</div>
				</div>
			</div>

			<!-- Account Settings -->
			<div class="section">
				<h2 class="section-title">Settings</h2>
				<div class="form-group">
					<label class="form-label">Account Name</label>
					<v-input v-model="accountName" placeholder="Account name">
						<template #append>
							<v-icon
								v-if="nameChanged"
								name="check"
								clickable
								:disabled="saving"
								@click="handleSaveName"
							/>
						</template>
					</v-input>
				</div>
				<div class="form-group">
					<label class="form-label">Account ID</label>
					<v-input :model-value="activeAccountId" disabled />
				</div>
			</div>

			<!-- Actions -->
			<div class="section">
				<v-button secondary @click="$router.push('/account/subscription')">
					<v-icon name="credit_card" left />
					Manage Subscription
				</v-button>
			</div>

			<div v-if="error" class="error-msg">{{ error }}</div>
		</div>

		<div v-else class="module-empty">
			<v-info icon="account_circle" title="No Account" center>
				No active account selected.
			</v-info>
		</div>

		<template #sidebar>
			<sidebar-detail icon="people" title="Account" close>
				<account-selector
					:model-value="activeAccountId"
					:accounts="accounts"
					:disabled="loading"
					@update:model-value="handleAccountChange"
				/>
			</sidebar-detail>
			<sidebar-detail icon="info" title="Information" close>
				<div class="sidebar-info">
					<p v-if="activeAccountId">
						<strong>Account ID:</strong><br />
						<code>{{ activeAccountId }}</code>
					</p>
					<p v-if="subscription">
						<strong>Plan:</strong> {{ subscription.plan?.name || 'None' }}<br />
						<strong>Status:</strong> {{ subscription.status }}
					</p>
				</div>
			</sidebar-detail>
		</template>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { useRoute } from 'vue-router';
import { useAccount } from '../composables/use-account';
import AccountSelector from '../components/account-selector.vue';

const api = useApi();
const route = useRoute();

const {
	accounts, activeAccountId, subscription, loading, error,
	fetchAccounts, setActiveAccount, fetchSubscription, updateAccount,
	formulaTokens, fetchFormulaTokens, createFormulaToken, revokeFormulaToken,
	apiKeys, fetchApiKeys, createApiKey, revokeApiKey, rotateApiKey,
} = useAccount(api);

const accountName = ref('');
const saving = ref(false);
const calculatorCount = ref(0);
const apiCallCount = ref(0);
const newTokenLabel = ref('');
const creatingToken = ref(false);
const newlyCreatedToken = ref<string | null>(null);

const newKeyName = ref('');
const newKeyEnv = ref('live');
const creatingKey = ref(false);
const newlyCreatedKey = ref<string | null>(null);

const isSubscriptionRoute = computed(() => route.path.includes('/subscription'));

const currentAccount = computed(() =>
	accounts.value.find((a) => a.id === activeAccountId.value),
);

const nameChanged = computed(() => accountName.value !== (currentAccount.value?.name || ''));

const calculatorLimit = computed(() => subscription.value?.plan?.calculator_limit ?? null);
const callsLimit = computed(() => subscription.value?.plan?.calls_per_month ?? null);

const calculatorPercent = computed(() => {
	if (!calculatorLimit.value) return 0;
	return Math.min(100, (calculatorCount.value / calculatorLimit.value) * 100);
});

const apiCallPercent = computed(() => {
	if (!callsLimit.value) return 0;
	return Math.min(100, (apiCallCount.value / callsLimit.value) * 100);
});

async function fetchUsageStats() {
	if (!activeAccountId.value) return;

	try {
		const { data: calcData } = await api.get('/items/calculators', {
			params: {
				filter: { account: { _eq: activeAccountId.value } },
				aggregate: { count: 'id' },
			},
		});
		calculatorCount.value = Number(calcData.data?.[0]?.count?.id) || 0;
	} catch {
		calculatorCount.value = 0;
	}

	try {
		const now = new Date();
		const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
		const { data: callData } = await api.get('/items/calculator_calls', {
			params: {
				filter: {
					calculator: { account: { _eq: activeAccountId.value } },
					timestamp: { _gte: firstOfMonth },
				},
				aggregate: { count: 'id' },
			},
		});
		apiCallCount.value = Number(callData.data?.[0]?.count?.id) || 0;
	} catch {
		apiCallCount.value = 0;
	}
}

async function handleAccountChange(id: string) {
	await setActiveAccount(id);
}

async function handleSaveName() {
	saving.value = true;
	await updateAccount({ name: accountName.value });
	saving.value = false;
}

async function handleCreateToken() {
	if (!newTokenLabel.value.trim()) return;
	creatingToken.value = true;
	newlyCreatedToken.value = null;
	const result = await createFormulaToken(newTokenLabel.value.trim());
	if (result) {
		newlyCreatedToken.value = result.token;
		newTokenLabel.value = '';
	}
	creatingToken.value = false;
}

async function handleRevoke(id: string) {
	await revokeFormulaToken(id);
}

function copyNewToken() {
	if (newlyCreatedToken.value) {
		navigator.clipboard.writeText(newlyCreatedToken.value);
	}
}

function copyToClipboard(text: string | null) {
	if (text) navigator.clipboard.writeText(text);
}

async function handleCreateKey() {
	if (!newKeyName.value.trim()) return;
	creatingKey.value = true;
	newlyCreatedKey.value = null;
	const result = await createApiKey({
		name: newKeyName.value.trim(),
		environment: newKeyEnv.value,
		permissions: { services: { calc: { enabled: true, resources: [], actions: ['execute', 'describe'] } } },
	});
	if (result?.raw_key) {
		newlyCreatedKey.value = result.raw_key;
		newKeyName.value = '';
	}
	creatingKey.value = false;
}

async function handleRevokeKey(id: string) {
	await revokeApiKey(id);
}

async function handleRotateKey(id: string) {
	newlyCreatedKey.value = null;
	const result = await rotateApiKey(id);
	if (result?.raw_key) {
		newlyCreatedKey.value = result.raw_key;
	}
}

function formatDate(iso: string): string {
	return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

watch(currentAccount, (acct) => {
	accountName.value = acct?.name || '';
}, { immediate: true });

watch(activeAccountId, () => {
	fetchSubscription();
	fetchUsageStats();
	fetchFormulaTokens();
	fetchApiKeys();
	newlyCreatedToken.value = null;
	newlyCreatedKey.value = null;
});

onMounted(async () => {
	await fetchAccounts();
	await fetchSubscription();
	await fetchUsageStats();
	await fetchFormulaTokens();
	await fetchApiKeys();
});
</script>

<style scoped>
.header-icon {
	--v-button-background-color-disabled: var(--theme--primary-background);
	--v-button-color-disabled: var(--theme--primary);
}

.module-content {
	padding: var(--content-padding);
	padding-bottom: var(--content-padding-bottom);
	max-width: 800px;
}

.module-empty {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 400px;
}

.section {
	margin-bottom: 32px;
}

.section-title {
	font-size: 18px;
	font-weight: 600;
	margin-bottom: 16px;
}

.stats-grid {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 16px;
}

.stat-card {
	padding: 20px;
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	background: var(--theme--background-subdued);
}

.stat-header {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 12px;
	color: var(--theme--foreground-subdued);
}

.stat-label {
	font-size: 13px;
	font-weight: 600;
	text-transform: uppercase;
}

.stat-value {
	font-size: 24px;
	font-weight: 700;
	margin-bottom: 8px;
}

.stat-current {
	color: var(--theme--foreground);
}

.stat-limit {
	color: var(--theme--foreground-subdued);
	font-weight: 400;
}

.stat-bar {
	height: 6px;
	background: var(--theme--border-color);
	border-radius: 3px;
	overflow: hidden;
}

.stat-bar-fill {
	height: 100%;
	background: var(--theme--primary);
	border-radius: 3px;
	transition: width 0.3s ease;
}

.stat-bar-fill.warning {
	background: var(--theme--warning);
}

.form-group {
	margin-bottom: 16px;
}

.form-label {
	display: block;
	font-size: 13px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	margin-bottom: 6px;
}

.section-desc {
	font-size: 14px;
	color: var(--theme--foreground-subdued);
	margin-bottom: 16px;
}

.tokens-table {
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	overflow: hidden;
	margin-bottom: 12px;
}

.tokens-header {
	display: grid;
	grid-template-columns: 2fr 1fr 1fr 80px 80px;
	gap: 8px;
	padding: 8px 16px;
	font-size: 12px;
	font-weight: 600;
	text-transform: uppercase;
	color: var(--theme--foreground-subdued);
	background: var(--theme--background-subdued);
	border-bottom: 1px solid var(--theme--border-color);
}

.tokens-row {
	display: grid;
	grid-template-columns: 2fr 1fr 1fr 80px 80px;
	gap: 8px;
	padding: 10px 16px;
	align-items: center;
	font-size: 14px;
	border-bottom: 1px solid var(--theme--border-color);
}

.tokens-row:last-child {
	border-bottom: none;
}

.token-label {
	font-weight: 500;
}

.token-date {
	color: var(--theme--foreground-subdued);
	font-size: 13px;
}

.token-actions {
	display: flex;
	justify-content: flex-end;
}

.active-chip {
	--v-chip-background-color: var(--theme--success);
	--v-chip-color: #fff;
}

.revoked-chip {
	--v-chip-background-color: var(--theme--foreground-subdued);
	--v-chip-color: #fff;
}

.test-chip {
	--v-chip-background-color: var(--theme--warning);
	--v-chip-color: #fff;
}

.legacy-chip {
	--v-chip-background-color: var(--theme--foreground-subdued);
	--v-chip-color: #fff;
	margin-left: 8px;
	vertical-align: middle;
}

.tokens-empty {
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	padding: 24px;
	text-align: center;
	margin-bottom: 12px;
}

.muted {
	color: var(--theme--foreground-subdued);
}

.token-create-row {
	display: flex;
	gap: 8px;
	align-items: center;
}

.new-token-notice {
	margin-top: 12px;
}

.new-token-content {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.new-token-value {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 13px;
	word-break: break-all;
	display: flex;
	align-items: center;
	gap: 8px;
}

.copy-icon {
	color: var(--theme--foreground-subdued);
	cursor: pointer;
	flex-shrink: 0;
}

.copy-icon:hover {
	color: var(--theme--foreground);
}

.error-msg {
	color: var(--theme--danger);
	font-size: 13px;
	margin-top: 12px;
}

.sidebar-info {
	padding: 12px;
}

.sidebar-info p {
	margin: 0 0 12px;
	line-height: 1.6;
}

.sidebar-info p:last-child {
	margin-bottom: 0;
}

.sidebar-info code {
	font-size: 12px;
	word-break: break-all;
}
</style>
