<template>
	<private-view title="Integration">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="integration_instructions" />
			</v-button>
		</template>

		<template #navigation>
			<formula-navigation current-view="integration" />
		</template>

		<!-- Feature gate -->
		<div v-if="featureLoading" class="feature-gate-loading">
			<v-progress-circular indeterminate />
		</div>
		<div v-else-if="!featureAllowed" class="feature-gate-unavailable">
			<v-info icon="block" title="Feature Unavailable" center>
				Formula testing is not available for your account. Contact your administrator.
			</v-info>
		</div>
		<template v-else>

		<!-- Loading keys -->
		<div v-if="loading" class="module-loading">
			<v-progress-circular indeterminate />
		</div>

		<!-- No keys: friendly CTA -->
		<div v-else-if="!hasKeys" class="no-keys-notice">
			<v-info icon="vpn_key" title="No API Keys" center>
				Create an API key to see integration code snippets.
				<template #append>
					<v-button :loading="creating" @click="handleCreateKey">
						<v-icon name="add" left />
						Create API Key
					</v-button>
				</template>
			</v-info>
		</div>

		<!-- Has keys but none with calc perms -->
		<div v-else-if="!hasCalcKeys" class="no-keys-notice">
			<v-info icon="warning" title="No Formula API Access" center>
				None of your API keys have Formula API permissions.
				<template #append>
					<v-button secondary @click="$router.push('/account')">
						<v-icon name="manage_accounts" left />
						Manage Keys
					</v-button>
				</template>
			</v-info>
		</div>

		<!-- Main content -->
		<div v-else class="integration-content">
			<p class="intro-text">
				Use your API key to evaluate Excel formulas from any language. All endpoints accept JSON and return JSON.
			</p>

			<!-- Raw key notice (just created) -->
			<v-notice v-if="justCreatedRawKey" type="warning" style="margin-bottom: 16px;">
				<div class="raw-key-notice">
					<div>Copy this key — it won't be shown again:</div>
					<code class="raw-key-value">{{ justCreatedRawKey }}</code>
					<v-button x-small secondary @click="dismissRawKey">Dismiss</v-button>
				</div>
			</v-notice>

			<!-- Key selector (only when 2+ calc keys) -->
			<div v-if="calcKeys.length > 1" class="key-selector">
				<label class="key-selector-label">API Key:</label>
				<v-select
					:model-value="selectedKey?.id"
					:items="keySelectItems"
					@update:model-value="selectKey($event)"
				/>
			</div>

			<code-examples :snippet-params="snippetParams" />
		</div>

		</template>
		<template #sidebar>
			<sidebar-detail icon="help_outline" title="About Integration" close>
				<div class="sidebar-info">
					<p>Code snippets for integrating the Formula API into your application.</p>
					<p>Replace the key placeholder with your full API key. Manage keys in <router-link to="/account">Account settings</router-link>.</p>
					<p><strong>Endpoints:</strong></p>
					<ul>
						<li><code>POST /execute</code> — single formula</li>
						<li><code>POST /execute/batch</code> — multiple formulas</li>
						<li><code>POST /execute/sheet</code> — spreadsheet mode</li>
					</ul>
					<p style="margin-top: 12px;">
						<strong>Auth:</strong> <code>X-API-Key</code> header with your API key.
					</p>
				</div>
			</sidebar-detail>
		</template>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useFeatureGate } from '../../../project-extension-feature-gate/src/use-feature-gate';
import { useApi } from '@directus/extensions-sdk';
import { useApiKeys } from '../composables/use-api-keys';
import FormulaNavigation from '../components/navigation.vue';
import CodeExamples from '../components/code-examples.vue';
import { maskToken } from '../utils/code-snippets';
import type { FormulaSnippetParams } from '../utils/code-snippets';

const api = useApi();
const { allowed: featureAllowed, loading: featureLoading } = useFeatureGate(api, 'calc.execute');
const {
	loading, hasKeys, calcKeys, hasCalcKeys, selectedKey,
	gatewayUrl, justCreatedRawKey,
	fetchKeys, selectKey, createDefaultKey, dismissRawKey,
} = useApiKeys(api);

const creating = ref(false);

const keySelectItems = computed(() =>
	calcKeys.value.map((k) => ({
		text: `${k.name} (${k.environment}) — ${maskToken(k.key_prefix)}`,
		value: k.id,
	})),
);

const snippetParams = computed<FormulaSnippetParams>(() => ({
	baseUrl: gatewayUrl.value,
	apiKey: justCreatedRawKey.value || selectedKey.value?.key_prefix || '',
}));

async function handleCreateKey() {
	creating.value = true;
	await createDefaultKey();
	creating.value = false;
}

onMounted(fetchKeys);
</script>

<style scoped>
.header-icon {
	--v-button-background-color-disabled: var(--theme--primary-background);
	--v-button-color-disabled: var(--theme--primary);
}

.integration-content {
	padding: var(--content-padding);
	padding-bottom: var(--content-padding-bottom);
	max-width: 960px;
}

.intro-text {
	font-size: 14px;
	color: var(--theme--foreground-subdued);
	margin: 0 0 4px;
}

.no-keys-notice {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: var(--content-padding);
	height: 400px;
}

.module-loading {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 400px;
}

.key-selector {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 8px;
	margin-bottom: 12px;
}

.key-selector-label {
	font-size: 13px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	white-space: nowrap;
}

.key-selector :deep(.v-select),
.key-selector :deep(.v-select .v-input) {
	max-width: 300px;
	width: 300px;
}

.key-selector :deep(.v-input.full-width) {
	max-width: 300px !important;
	width: 300px !important;
}

.raw-key-notice {
	display: flex;
	align-items: center;
	gap: 12px;
	flex-wrap: wrap;
}

.raw-key-value {
	background: var(--theme--background-subdued);
	padding: 4px 8px;
	border-radius: 4px;
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 13px;
	word-break: break-all;
}

.sidebar-info {
	padding: 12px;
}

.sidebar-info p {
	margin: 0 0 8px;
	line-height: 1.6;
}

.sidebar-info ul {
	margin: 0;
	padding-left: 18px;
}

.sidebar-info li {
	font-size: 14px;
	line-height: 1.6;
}

.sidebar-info code {
	background: var(--theme--background-subdued);
	padding: 2px 6px;
	border-radius: 4px;
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 13px;
}
.feature-gate-loading {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 400px;
}
.feature-gate-unavailable {
	padding: var(--content-padding);
	padding-top: 120px;
}
</style>
