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

		<!-- No-token notice -->
		<div v-if="!hasToken && !tokenLoading" class="no-token-notice">
			<v-info icon="vpn_key" title="API Key Required" center>
				Create an API key in your Account settings to use the Formula API.
				<template #append>
					<v-button secondary @click="$router.push('/account')">
						<v-icon name="manage_accounts" left />
						Go to Account
					</v-button>
				</template>
			</v-info>
		</div>

		<div v-else-if="tokenLoading" class="module-loading">
			<v-progress-circular indeterminate />
		</div>

		<div v-else class="integration-content">
			<p class="intro-text">
				Use your API key to evaluate Excel formulas from any language. All endpoints accept JSON and return JSON.
			</p>

			<code-examples :snippet-params="snippetParams" />
		</div>

		<template #sidebar>
			<sidebar-detail icon="help_outline" title="About Integration" close>
				<div class="sidebar-info">
					<p>Code snippets for integrating the Formula API into your application.</p>
					<p><strong>Endpoints:</strong></p>
					<ul>
						<li><code>POST /execute</code> — single formula</li>
						<li><code>POST /execute/batch</code> — multiple formulas</li>
						<li><code>POST /execute/sheet</code> — spreadsheet mode</li>
					</ul>
					<p style="margin-top: 12px;">
						<strong>Auth:</strong> <code>X-Auth-Token</code> header with your API key.
					</p>
				</div>
			</sidebar-detail>
		</template>
	</private-view>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { useFormulaToken } from '../composables/use-formula-token';
import FormulaNavigation from '../components/navigation.vue';
import CodeExamples from '../components/code-examples.vue';
import type { FormulaSnippetParams } from '../utils/code-snippets';

const api = useApi();
const { hasToken, tokenLoading, tokenValue, formulaApiUrl, fetchToken } = useFormulaToken(api);

const snippetParams = computed<FormulaSnippetParams>(() => ({
	baseUrl: formulaApiUrl.value,
	token: tokenValue.value,
}));

onMounted(fetchToken);
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
	margin: 0 0 8px;
}

.no-token-notice {
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
</style>
