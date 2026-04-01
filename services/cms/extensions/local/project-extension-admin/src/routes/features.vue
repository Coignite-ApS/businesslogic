<template>
	<private-view title="Feature Flags">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="toggle_on" />
			</v-button>
		</template>

		<template #navigation>
			<admin-navigation />
		</template>

		<template #actions>
			<v-button rounded icon secondary @click="loadFeatures" :loading="loading">
				<v-icon name="refresh" />
			</v-button>
		</template>

		<div class="admin-content">
			<!-- Section 1: Platform Features -->
			<div class="section">
				<h3 class="section-title">Platform Features</h3>

				<div v-if="loading && !features.length" class="loading-state">
					<v-progress-circular indeterminate />
				</div>

				<v-info v-else-if="!features.length" type="info" icon="toggle_on" title="No features found" center />

				<template v-else>
					<div
						v-for="group in groupedFeatures"
						:key="group.category"
						class="category-group"
					>
						<div class="category-header">
							<v-icon :name="categoryIcon(group.category)" small />
							<span>{{ categoryLabel(group.category) }}</span>
						</div>

						<div
							v-for="feature in group.features"
							:key="feature.id"
							class="feature-row"
						>
							<div class="feature-info">
								<span class="feature-name">{{ feature.name }}</span>
								<span class="feature-key">{{ feature.key }}</span>
								<span v-if="feature.description" class="feature-desc">{{ feature.description }}</span>
							</div>
							<div class="feature-toggle">
								<span class="status-dot" :class="feature.enabled ? 'enabled' : 'disabled'" />
								<label class="toggle-switch">
									<input
										type="checkbox"
										:checked="feature.enabled"
										@change="toggleFeature(feature)"
									/>
									<span class="toggle-slider" />
								</label>
							</div>
						</div>
					</div>
				</template>
			</div>

			<!-- Section 2: Account Overrides -->
			<div class="section">
				<div class="section-header">
					<h3 class="section-title">Account Overrides</h3>
				</div>

				<div class="account-selector">
					<v-input
						v-model="accountSearch"
						placeholder="Search accounts..."
						type="search"
						@input="onAccountSearch"
					/>

					<div v-if="accounts.length" class="account-list">
						<div
							v-for="account in accounts"
							:key="account.id"
							class="account-item"
							:class="{ selected: selectedAccount === account.id }"
							@click="selectAccount(account.id)"
						>
							<v-icon name="business" small />
							<span class="account-name">{{ account.name }}</span>
							<span v-if="selectedAccount === account.id" class="selected-check">
								<v-icon name="check" x-small />
							</span>
						</div>
					</div>
					<div v-else-if="accountSearch" class="no-data">No accounts match "{{ accountSearch }}"</div>
				</div>

				<div v-if="selectedAccount" class="overrides-content">
					<div v-if="overridesLoading" class="loading-state-sm">
						<v-progress-circular indeterminate />
					</div>

					<template v-else>
						<div
							v-for="resolved in resolvedFeatures"
							:key="resolved.key"
							class="override-row"
						>
							<div class="feature-info">
								<span class="feature-name">{{ resolved.name }}</span>
								<span class="feature-key">{{ resolved.key }}</span>
								<span class="feature-category">{{ categoryLabel(resolved.category) }}</span>
							</div>
							<div class="override-controls">
								<div class="three-state">
									<button
										class="state-btn"
										:class="{ active: resolved.source === 'platform' }"
										@click="resetOverride(resolved)"
										title="Use platform default"
									>Default</button>
									<button
										class="state-btn state-on"
										:class="{ active: resolved.source === 'override' && resolved.enabled }"
										@click="setOverride(resolved, true)"
										title="Force enabled for this account"
									>ON</button>
									<button
										class="state-btn state-off"
										:class="{ active: resolved.source === 'override' && !resolved.enabled }"
										@click="setOverride(resolved, false)"
										title="Force disabled for this account"
									>OFF</button>
								</div>
								<span class="effective-state" :class="resolved.enabled ? 'on' : 'off'">
									{{ resolved.enabled ? 'Enabled' : 'Disabled' }}
								</span>
								<span class="source-badge" :class="resolved.source">
									{{ resolved.source }}
								</span>
							</div>
						</div>
					</template>
				</div>

				<v-info v-else type="info" icon="manage_accounts" title="Select an account to manage overrides" center />
			</div>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { useAdminApi } from '../composables/use-admin-api';
import AdminNavigation from '../components/admin-navigation.vue';
import type { PlatformFeature, ResolvedFeature } from '../types';

const api = useApi();
const {
	loading,
	fetchPlatformFeatures, updatePlatformFeature,
	resolveAccountFeatures, upsertAccountOverride, deleteAccountOverride,
	fetchAccounts,
} = useAdminApi(api);

const features = ref<PlatformFeature[]>([]);
const accountSearch = ref('');
const accounts = ref<any[]>([]);
const selectedAccount = ref<string | null>(null);
const resolvedFeatures = ref<ResolvedFeature[]>([]);
const overridesLoading = ref(false);

const CATEGORIES: Record<string, { label: string; icon: string }> = {
	ai: { label: 'AI', icon: 'smart_toy' },
	calc: { label: 'Calculators', icon: 'calculate' },
	flow: { label: 'Flows', icon: 'account_tree' },
	widget: { label: 'Widgets', icon: 'widgets' },
	platform: { label: 'Platform', icon: 'settings' },
};

function categoryIcon(cat: string): string {
	return CATEGORIES[cat]?.icon ?? 'category';
}

function categoryLabel(cat: string): string {
	return CATEGORIES[cat]?.label ?? cat;
}

const groupedFeatures = computed(() => {
	const groups: Record<string, { category: string; features: PlatformFeature[] }> = {};
	for (const f of features.value) {
		if (!groups[f.category]) groups[f.category] = { category: f.category, features: [] };
		groups[f.category].features.push(f);
	}
	return Object.values(groups).sort((a, b) => a.category.localeCompare(b.category));
});

async function toggleFeature(feature: PlatformFeature) {
	const next = !feature.enabled;
	feature.enabled = next; // optimistic
	const result = await updatePlatformFeature(feature.id, { enabled: next });
	if (!result) feature.enabled = !next; // rollback on failure
}

async function selectAccount(accountId: string) {
	selectedAccount.value = accountId;
	overridesLoading.value = true;
	const result = await resolveAccountFeatures(accountId);
	if (result) resolvedFeatures.value = result;
	overridesLoading.value = false;
}

async function setOverride(resolved: ResolvedFeature, enabled: boolean) {
	const pf = features.value.find(f => f.key === resolved.key);
	if (!pf || !selectedAccount.value) return;
	await upsertAccountOverride(selectedAccount.value, pf.id, enabled);
	await selectAccount(selectedAccount.value);
}

async function resetOverride(resolved: ResolvedFeature) {
	const pf = features.value.find(f => f.key === resolved.key);
	if (!pf || !selectedAccount.value) return;
	await deleteAccountOverride(selectedAccount.value, pf.id);
	await selectAccount(selectedAccount.value);
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
function onAccountSearch() {
	if (searchTimer) clearTimeout(searchTimer);
	searchTimer = setTimeout(searchAccounts, 300);
}

async function searchAccounts() {
	const result = await fetchAccounts({ search: accountSearch.value || undefined, limit: 20 });
	if (result) accounts.value = result.data;
}

async function loadFeatures() {
	const result = await fetchPlatformFeatures();
	if (result) features.value = result;
}

onMounted(() => {
	loadFeatures();
	searchAccounts();
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

.loading-state-sm {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 120px;
}

.section {
	margin-bottom: 32px;
}

.section-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 16px;
}

.section-title {
	font-size: 14px;
	font-weight: 600;
	margin-bottom: 16px;
}

/* Category groups */
.category-group {
	margin-bottom: 20px;
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	overflow: hidden;
}

.category-header {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 14px;
	background: var(--theme--background-subdued);
	font-size: 12px;
	font-weight: 600;
	text-transform: uppercase;
	color: var(--theme--foreground-subdued);
	border-bottom: 1px solid var(--theme--border-color);
}

/* Feature rows */
.feature-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 10px 14px;
	border-top: 1px solid var(--theme--border-color);
	gap: 16px;
}

.feature-row:first-of-type {
	border-top: none;
}

.feature-info {
	display: flex;
	flex-direction: column;
	gap: 2px;
	flex: 1;
	min-width: 0;
}

.feature-name {
	font-size: 14px;
	font-weight: 500;
	color: var(--theme--foreground);
}

.feature-key {
	font-size: 11px;
	color: var(--theme--foreground-subdued);
	font-family: monospace;
}

.feature-desc {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	margin-top: 2px;
}

.feature-category {
	font-size: 11px;
	color: var(--theme--foreground-subdued);
}

/* Toggle */
.feature-toggle {
	display: flex;
	align-items: center;
	gap: 10px;
	flex-shrink: 0;
}

.status-dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	flex-shrink: 0;
}

.status-dot.enabled {
	background: var(--theme--success, #2ecda7);
	box-shadow: 0 0 4px var(--theme--success, #2ecda7);
}

.status-dot.disabled {
	background: var(--theme--danger, #e35169);
}

.toggle-switch {
	position: relative;
	display: inline-block;
	width: 40px;
	height: 22px;
	cursor: pointer;
}

.toggle-switch input {
	opacity: 0;
	width: 0;
	height: 0;
	position: absolute;
}

.toggle-slider {
	position: absolute;
	inset: 0;
	background: var(--theme--border-color);
	border-radius: 22px;
	transition: background 0.2s;
}

.toggle-slider::before {
	content: '';
	position: absolute;
	width: 16px;
	height: 16px;
	left: 3px;
	bottom: 3px;
	background: white;
	border-radius: 50%;
	transition: transform 0.2s;
}

.toggle-switch input:checked + .toggle-slider {
	background: var(--theme--success, #2ecda7);
}

.toggle-switch input:checked + .toggle-slider::before {
	transform: translateX(18px);
}

/* Account selector */
.account-selector {
	margin-bottom: 16px;
}

.account-list {
	margin-top: 8px;
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	overflow: hidden;
	max-height: 220px;
	overflow-y: auto;
}

.account-item {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 14px;
	cursor: pointer;
	font-size: 14px;
	border-bottom: 1px solid var(--theme--border-color);
	transition: background 0.15s;
}

.account-item:last-child {
	border-bottom: none;
}

.account-item:hover {
	background: var(--theme--background-subdued);
}

.account-item.selected {
	background: var(--theme--primary-background);
	color: var(--theme--primary);
}

.account-name {
	flex: 1;
}

.selected-check {
	color: var(--theme--primary);
}

/* Override rows */
.overrides-content {
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	overflow: hidden;
}

.override-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 10px 14px;
	border-bottom: 1px solid var(--theme--border-color);
	gap: 16px;
}

.override-row:last-child {
	border-bottom: none;
}

.override-controls {
	display: flex;
	align-items: center;
	gap: 10px;
	flex-shrink: 0;
}

/* Three-state segmented control */
.three-state {
	display: flex;
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	overflow: hidden;
}

.state-btn {
	padding: 4px 10px;
	font-size: 12px;
	font-weight: 500;
	border: none;
	background: var(--theme--background);
	color: var(--theme--foreground-subdued);
	cursor: pointer;
	border-right: 1px solid var(--theme--border-color);
	transition: background 0.15s, color 0.15s;
}

.state-btn:last-child {
	border-right: none;
}

.state-btn:hover {
	background: var(--theme--background-subdued);
}

.state-btn.active {
	background: var(--theme--primary-background);
	color: var(--theme--primary);
	font-weight: 600;
}

.state-btn.state-on.active {
	background: var(--theme--success-background, rgba(46, 205, 167, 0.1));
	color: var(--theme--success, #2ecda7);
}

.state-btn.state-off.active {
	background: var(--theme--danger-background);
	color: var(--theme--danger);
}

/* Effective state + source */
.effective-state {
	font-size: 12px;
	font-weight: 600;
	min-width: 56px;
	text-align: center;
}

.effective-state.on {
	color: var(--theme--success, #2ecda7);
}

.effective-state.off {
	color: var(--theme--danger, #e35169);
}

.source-badge {
	font-size: 10px;
	padding: 2px 7px;
	border-radius: 3px;
	font-weight: 600;
	text-transform: uppercase;
}

.source-badge.platform {
	background: var(--theme--background-subdued);
	color: var(--theme--foreground-subdued);
}

.source-badge.override {
	background: var(--theme--primary-background);
	color: var(--theme--primary);
}

.no-data {
	color: var(--theme--foreground-subdued);
	font-style: italic;
	font-size: 14px;
	padding: 8px 0;
}
</style>
