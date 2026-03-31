<template>
	<div class="code-examples">
		<div class="code-section">
			<h2 v-if="showHeadings" class="section-title">Execute</h2>
			<label v-else class="field-label">Execute</label>
			<p class="code-section-desc">
				<template v-if="showHeadings">
					The <code>/execute</code> endpoint runs your input parameters through the uploaded Excel document and returns calculated output.
				</template>
				<template v-else>Run input through your calculator and get output.</template>
			</p>
			<div class="lang-tabs">
				<button
					v-for="lang in languages"
					:key="lang.id"
					class="tab-btn"
					:class="{ active: execLang === lang.id }"
					@click="execLang = lang.id"
				>
					{{ lang.label }}
				</button>
			</div>
			<code-block :code="execDisplay" :copy-code="execCopy" :language="execLangObj.hljs" />
		</div>

		<div class="code-section">
			<h2 v-if="showHeadings" class="section-title">Describe</h2>
			<label v-else class="field-label">Describe</label>
			<p class="code-section-desc">
				<template v-if="showHeadings">
					The <code>/describe</code> endpoint returns JSON schemas for input and output parameters.
					Use the input schema to build or validate forms. Use the output schema to structure result display.
				</template>
				<template v-else>Returns JSON schemas for input and output parameters.</template>
			</p>
			<div class="lang-tabs">
				<button
					v-for="lang in languages"
					:key="lang.id"
					class="tab-btn"
					:class="{ active: descLang === lang.id }"
					@click="descLang = lang.id"
				>
					{{ lang.label }}
				</button>
			</div>
			<code-block :code="descDisplay" :copy-code="descCopy" :language="descLangObj.hljs" />
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { languages, maskToken } from '../utils/code-snippets';
import type { SnippetParams } from '../utils/code-snippets';
import CodeBlock from './code-block.vue';

const props = withDefaults(defineProps<{
	snippetParams: SnippetParams;
	showHeadings?: boolean;
}>(), { showHeadings: false });

const execLang = ref('curl');
const descLang = ref('curl');

const execLangObj = computed(() => languages.find((l) => l.id === execLang.value) || languages[0]);
const descLangObj = computed(() => languages.find((l) => l.id === descLang.value) || languages[0]);

const maskedParams = computed<SnippetParams>(() => ({
	...props.snippetParams,
	apiKey: maskToken(props.snippetParams.apiKey),
}));

const execDisplay = computed(() => execLangObj.value.execute(maskedParams.value));
const execCopy = computed(() => execLangObj.value.execute(props.snippetParams));
const descDisplay = computed(() => descLangObj.value.describe(maskedParams.value));
const descCopy = computed(() => descLangObj.value.describe(props.snippetParams));
</script>

<style scoped>
.code-section {
	margin-top: 24px;
}

.section-title {
	font-size: 18px;
	font-weight: 700;
	margin: 0 0 8px;
}

.code-section-desc code {
	background: var(--theme--background-subdued);
	padding: 2px 6px;
	border-radius: 4px;
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 13px;
}

.field-label {
	font-size: 14px;
	font-weight: 600;
}

.code-section-desc {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	margin: 2px 0 8px;
}

.lang-tabs {
	display: flex;
	gap: 0;
	border-bottom: 2px solid var(--theme--border-color);
	margin-bottom: 0;
}

.tab-btn {
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

.tab-btn:hover {
	color: var(--theme--foreground);
}

.tab-btn.active {
	color: var(--theme--primary);
	border-bottom-color: var(--theme--primary);
}
</style>
