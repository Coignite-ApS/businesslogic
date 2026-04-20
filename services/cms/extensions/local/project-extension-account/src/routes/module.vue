<template>
	<private-view title="Account">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="account_circle" />
			</v-button>
		</template>

		<template #navigation>
			<account-navigation />
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
					<div class="tokens-header tokens-header-6col">
						<span>Name</span>
						<span>Prefix</span>
						<span>Environment</span>
						<span>Permissions</span>
						<span>Created</span>
						<span></span>
					</div>
					<div v-for="key in apiKeys" :key="key.id" class="tokens-row tokens-row-6col">
						<span class="token-label">{{ key.name }}</span>
						<span class="token-date"><code>{{ key.key_prefix }}...</code></span>
						<span>
							<v-chip small :class="key.environment === 'live' ? 'active-chip' : 'test-chip'">
								{{ key.environment }}
							</v-chip>
						</span>
						<span class="perms-summary" @click="openEditKey(key)">
							{{ getPermsSummary(key.permissions) }}
							<v-icon name="edit" x-small class="edit-perms-icon" />
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
					<v-button small secondary @click="showCreatePerms = !showCreatePerms">
						<v-icon name="tune" left />
						Permissions
					</v-button>
					<v-button small :loading="creatingKey" @click="handleCreateKey">
						<v-icon name="add" left />
						Create Key
					</v-button>
				</div>

				<div v-if="showCreatePerms" class="create-perms-panel">
					<resource-picker
						:api="api"
						:account-id="activeAccountId"
						:model-value="newKeyPerms"
						@update:model-value="newKeyPerms = $event"
					/>
				</div>

				<!-- Edit Key Dialog -->
				<div v-if="editingKey" class="edit-perms-overlay" @click.self="editingKey = null">
					<div class="edit-perms-dialog">
						<div class="edit-perms-header">
							<h3>Edit Key — {{ editingKey.name }}</h3>
							<v-icon name="close" clickable @click="editingKey = null" />
						</div>

						<!-- MCP Endpoint -->
						<div class="edit-section">
							<label class="edit-label">MCP Endpoint</label>
							<div class="mcp-endpoint-row">
								<code class="mcp-endpoint-url">{{ GATEWAY_URL }}/v1/mcp/{{ editingKey.key_prefix }}</code>
								<v-icon
									name="content_copy"
									small
									clickable
									class="copy-icon"
									@click="copyToClipboard(GATEWAY_URL + '/v1/mcp/' + editingKey.key_prefix)"
								/>
							</div>
						</div>

						<!-- Integration Snippet -->
						<div class="edit-section">
							<label class="edit-label">MCP Config Snippet</label>
							<div class="snippet-block">
								<pre class="snippet-code">{{ mcpSnippet(editingKey.key_prefix) }}</pre>
								<v-icon
									name="content_copy"
									small
									clickable
									class="copy-icon snippet-copy"
									@click="copyToClipboard(mcpSnippet(editingKey.key_prefix))"
								/>
							</div>
						</div>

						<!-- Permissions -->
						<div class="edit-section">
							<label class="edit-label">Permissions</label>
							<resource-picker
								:api="api"
								:account-id="activeAccountId"
								:model-value="editKeyPerms"
								@update:model-value="editKeyPerms = $event"
							/>
						</div>

						<!-- Origin / IP Restrictions -->
						<div class="edit-section">
							<label class="edit-label">Allowed Origins (one per line)</label>
							<textarea
								v-model="editOrigins"
								class="restriction-textarea"
								placeholder="https://example.com&#10;https://app.example.com"
								rows="3"
							/>
						</div>
						<div class="edit-section">
							<label class="edit-label">Allowed IPs (one per line)</label>
							<textarea
								v-model="editIPs"
								class="restriction-textarea"
								placeholder="192.168.1.0/24&#10;10.0.0.1"
								rows="3"
							/>
						</div>

						<div class="edit-perms-actions">
							<v-button secondary @click="editingKey = null">Cancel</v-button>
							<v-button :loading="savingPerms" @click="handleSavePerms">Save</v-button>
						</div>
					</div>
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
			<sidebar-detail id="account" icon="people" title="Account">
				<account-selector
					:model-value="activeAccountId"
					:accounts="accounts"
					:disabled="loading"
					@update:model-value="handleAccountChange"
				/>
			</sidebar-detail>
			<sidebar-detail id="info" icon="info" title="Information">
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
import { useRouter } from 'vue-router';
import { useAccount } from '../composables/use-account';
import { useOnboarding, registerOnboardingGuard } from '../composables/use-onboarding';
import AccountNavigation from '../components/account-navigation.vue';
import AccountSelector from '../components/account-selector.vue';
import ResourcePicker from '../components/resource-picker.vue';
import { buildPermissions, parsePermissions, summarizePermissions } from '../utils/permissions';
import type { PermissionSelection } from '../utils/permissions';

const api = useApi();
const router = useRouter();

const {
	accounts, activeAccountId, subscription, loading, error,
	fetchAccounts, setActiveAccount, fetchSubscription, updateAccount,
	apiKeys, fetchApiKeys, createApiKey, updateApiKey, revokeApiKey, rotateApiKey,
} = useAccount(api);

const { needsWizard, fetchOnboardingState } = useOnboarding(api);

const accountName = ref('');
const saving = ref(false);
const calculatorCount = ref(0);
const apiCallCount = ref(0);
const newKeyName = ref('');
const newKeyEnv = ref('live');
const creatingKey = ref(false);
const newlyCreatedKey = ref<string | null>(null);
const showCreatePerms = ref(false);

const defaultPerms = (): PermissionSelection => ({
	calcResources: [],
	calcActions: ['execute', 'describe'],
	calcWildcard: true,
	kbResources: [],
	kbActions: ['search', 'ask'],
	kbWildcard: false,
});

const newKeyPerms = ref<PermissionSelection>(defaultPerms());
const editingKey = ref<any>(null);
const editKeyPerms = ref<PermissionSelection>(defaultPerms());
const savingPerms = ref(false);
const editOrigins = ref('');
const editIPs = ref('');

const GATEWAY_URL = 'https://api.businesslogic.online';

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

function copyToClipboard(text: string | null) {
	if (text) navigator.clipboard.writeText(text);
}

function mcpSnippet(keyPrefix: string): string {
	return JSON.stringify({
		mcpServers: {
			businesslogic: {
				url: `${GATEWAY_URL}/v1/mcp/${keyPrefix}`,
			},
		},
	}, null, 2);
}

async function handleCreateKey() {
	if (!newKeyName.value.trim()) return;
	creatingKey.value = true;
	newlyCreatedKey.value = null;
	const permissions = buildPermissions(newKeyPerms.value);
	const result = await createApiKey({
		name: newKeyName.value.trim(),
		environment: newKeyEnv.value,
		permissions,
	});
	if (result?.raw_key) {
		newlyCreatedKey.value = result.raw_key;
		newKeyName.value = '';
		showCreatePerms.value = false;
		newKeyPerms.value = defaultPerms();
	}
	creatingKey.value = false;
}

function getPermsSummary(perms: any): string {
	return summarizePermissions(perms);
}

function openEditKey(key: any) {
	editingKey.value = key;
	editKeyPerms.value = parsePermissions(key.permissions);
	editOrigins.value = (key.allowed_origins || []).join('\n');
	editIPs.value = (key.allowed_ips || []).join('\n');
}

async function handleSavePerms() {
	if (!editingKey.value) return;
	savingPerms.value = true;
	const permissions = buildPermissions(editKeyPerms.value);
	const allowed_origins = editOrigins.value.split('\n').map((s) => s.trim()).filter(Boolean);
	const allowed_ips = editIPs.value.split('\n').map((s) => s.trim()).filter(Boolean);
	await updateApiKey(editingKey.value.id, { permissions, allowed_origins, allowed_ips });
	editingKey.value = null;
	savingPerms.value = false;
}

async function handleRevokeKey(id: string) {
	if (!confirm('Are you sure you want to revoke this API key? This action cannot be undone.')) return;
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
	fetchApiKeys();
	newlyCreatedKey.value = null;
});

onMounted(async () => {
	await fetchAccounts();
	await Promise.all([fetchSubscription(), fetchOnboardingState()]);
	await fetchUsageStats();
	await fetchApiKeys();

	// ── Immediate redirect (current navigation) ──────────────────────────────
	// Redirect new users (no module activated, wizard not dismissed) to the wizard.
	// Skip if already on the onboarding route to avoid redirect loops.
	if (needsWizard.value && !router.currentRoute.value.path.includes('/onboarding')) {
		router.push('/account/onboarding');
	}

	// ── Global session guard ─────────────────────────────────────────────────
	// Register a router.beforeEach guard so that any navigation away from the
	// wizard is intercepted and redirected back.  registerOnboardingGuard
	// ensures at most one guard is active at a time.
	registerOnboardingGuard(router, needsWizard);
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

.tokens-header-6col {
	grid-template-columns: 2fr 1fr 1fr 1.5fr 80px 80px;
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

.tokens-row-6col {
	grid-template-columns: 2fr 1fr 1fr 1.5fr 80px 80px;
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

.perms-summary {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	cursor: pointer;
	display: flex;
	align-items: center;
	gap: 4px;
}

.perms-summary:hover {
	color: var(--theme--foreground);
}

.edit-perms-icon {
	opacity: 0;
	transition: opacity 0.15s;
}

.perms-summary:hover .edit-perms-icon {
	opacity: 1;
}

.create-perms-panel {
	margin-top: 12px;
	padding: 12px;
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	background: var(--theme--background-subdued);
}

.edit-perms-overlay {
	position: fixed;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	background: rgba(0, 0, 0, 0.5);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 500;
}

.edit-perms-dialog {
	background: var(--theme--background);
	border-radius: var(--theme--border-radius);
	padding: 24px;
	width: 480px;
	max-height: 80vh;
	overflow-y: auto;
	box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.edit-perms-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 16px;
}

.edit-perms-header h3 {
	font-size: 16px;
	font-weight: 600;
	margin: 0;
}

.edit-perms-actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	margin-top: 16px;
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

.edit-section {
	margin-bottom: 16px;
}

.edit-label {
	display: block;
	font-size: 12px;
	font-weight: 600;
	text-transform: uppercase;
	color: var(--theme--foreground-subdued);
	margin-bottom: 6px;
}

.mcp-endpoint-row {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 12px;
	background: var(--theme--background-subdued);
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
}

.mcp-endpoint-url {
	flex: 1;
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 12px;
	word-break: break-all;
}

.snippet-block {
	position: relative;
	background: var(--theme--background-subdued);
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	padding: 12px;
}

.snippet-code {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 12px;
	margin: 0;
	white-space: pre;
	overflow-x: auto;
}

.snippet-copy {
	position: absolute;
	top: 8px;
	right: 8px;
}

.restriction-textarea {
	width: 100%;
	padding: 8px 12px;
	background: var(--theme--background);
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	color: var(--theme--foreground);
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 13px;
	resize: vertical;
	box-sizing: border-box;
}

.restriction-textarea:focus {
	outline: none;
	border-color: var(--theme--primary);
}
</style>
