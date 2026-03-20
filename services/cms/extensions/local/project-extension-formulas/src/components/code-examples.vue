<template>
	<div class="code-examples">
		<!-- Endpoint tabs -->
		<div class="endpoint-tabs">
			<button
				class="tab-btn"
				:class="{ active: endpoint === 'single' }"
				@click="endpoint = 'single'"
			>
				Single
			</button>
			<button
				class="tab-btn"
				:class="{ active: endpoint === 'batch' }"
				@click="endpoint = 'batch'"
			>
				Batch
			</button>
			<button
				class="tab-btn"
				:class="{ active: endpoint === 'sheet' }"
				@click="endpoint = 'sheet'"
			>
				Sheet
			</button>
		</div>

		<div class="endpoint-desc">
			<template v-if="endpoint === 'single'">
				<code>POST /execute</code> — evaluate a single formula. Pass <code>data</code> for cell references.
			</template>
			<template v-else-if="endpoint === 'batch'">
				<code>POST /execute/batch</code> — evaluate multiple formulas in one request.
			</template>
			<template v-else>
				<code>POST /execute/sheet</code> — evaluate formulas with cell addresses, like a spreadsheet.
			</template>
		</div>

		<!-- Language tabs + code block -->
		<div class="lang-tabs">
			<button
				v-for="lang in languages"
				:key="lang.id"
				class="lang-btn"
				:class="{ active: activeLang === lang.id }"
				@click="activeLang = lang.id"
			>
				{{ lang.label }}
			</button>
		</div>
		<code-block :code="displayCode" :copy-code="copyCode" :language="activeLangObj.hljs" />
	</div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { languages, maskToken } from '../utils/code-snippets';
import type { FormulaSnippetParams, Endpoint } from '../utils/code-snippets';
import CodeBlock from './code-block.vue';

const props = defineProps<{
	snippetParams: FormulaSnippetParams;
}>();

const endpoint = ref<Endpoint>('single');
const activeLang = ref('curl');

const activeLangObj = computed(() => languages.find((l) => l.id === activeLang.value) || languages[0]);

const maskedParams = computed<FormulaSnippetParams>(() => ({
	...props.snippetParams,
	token: maskToken(props.snippetParams.token),
}));

const displayCode = computed(() => activeLangObj.value.snippet(endpoint.value, maskedParams.value));
const copyCode = computed(() => activeLangObj.value.snippet(endpoint.value, props.snippetParams));
</script>

<style scoped>
.endpoint-tabs {
	display: flex;
	gap: 0;
	border-bottom: 2px solid var(--theme--border-color);
	margin-bottom: 16px;
}

.tab-btn {
	padding: 10px 20px;
	font-size: 14px;
	font-weight: 600;
	background: none;
	border: none;
	border-bottom: 2px solid transparent;
	margin-bottom: -2px;
	cursor: pointer;
	color: var(--theme--foreground-subdued);
	transition: color 0.15s, border-color 0.15s;
}

.tab-btn:hover {
	color: var(--theme--foreground);
}

.tab-btn.active {
	color: var(--theme--primary);
	border-bottom-color: var(--theme--primary);
}

.endpoint-desc {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	margin-bottom: 16px;
}

.endpoint-desc code {
	background: var(--theme--background-subdued);
	padding: 2px 6px;
	border-radius: 4px;
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 13px;
}

.lang-tabs {
	display: flex;
	gap: 0;
	border-bottom: 2px solid var(--theme--border-color);
	margin-bottom: 0;
}

.lang-btn {
	padding: 10px 16px;
	font-size: 13px;
	font-weight: 600;
	background: none;
	border: none;
	border-bottom: 2px solid transparent;
	margin-bottom: -2px;
	cursor: pointer;
	color: var(--theme--foreground-subdued);
	transition: color 0.15s, border-color 0.15s;
}

.lang-btn:hover {
	color: var(--theme--foreground);
}

.lang-btn.active {
	color: var(--theme--primary);
	border-bottom-color: var(--theme--primary);
}
</style>
