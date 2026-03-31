<template>
	<div class="mcp-snippets">
		<div class="lang-tabs">
			<button
				v-for="platform in mcpPlatforms"
				:key="platform.id"
				class="tab-btn"
				:class="{ active: activePlatform === platform.id }"
				@click="activePlatform = platform.id"
			>
				{{ platform.label }}
			</button>
		</div>
		<div class="snippet-block">
			<pre><code><span class="ctx">{{ maskedParts.before }}{{ '\n' }}</span><span v-html="highlightedInner"></span><span class="ctx">{{ '\n' }}{{ maskedParts.after }}</span></code></pre>
			<button class="copy-btn" @click="handleCopy">
				<v-icon :name="copied ? 'check' : 'content_copy'" small />
				<span v-if="copied" class="copied-label">Copied!</span>
			</button>
		</div>
		<div class="file-hint">
			<v-icon name="info" x-small />
			<span>Add to <code>{{ activeObj.filePath }}</code></span>
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import hljs from 'highlight.js/lib/core';
import DOMPurify from 'dompurify';
import json from 'highlight.js/lib/languages/json';
import { mcpPlatforms, dedent } from '../utils/mcp-snippets';
import { maskToken } from '../utils/code-snippets';
import type { McpSnippetParams } from '../utils/mcp-snippets';

const CODE_ALLOWED_TAGS = ['span', 'b', 'i', 'em', 'strong'];
const CODE_ALLOWED_ATTR = ['class'];

hljs.registerLanguage('json', json);

const props = defineProps<{
	snippetParams: McpSnippetParams;
}>();

const activePlatform = ref('claude_desktop');

const activeObj = computed(() =>
	mcpPlatforms.find((p) => p.id === activePlatform.value) || mcpPlatforms[0],
);

const realParts = computed(() => activeObj.value.generate(props.snippetParams));

const maskedParts = computed(() =>
	activeObj.value.generate({
		...props.snippetParams,
		apiKey: maskToken(props.snippetParams.apiKey),
	}),
);

const highlightedInner = computed(() =>
	DOMPurify.sanitize(
		hljs.highlight(maskedParts.value.inner, { language: 'json' }).value,
		{ ALLOWED_TAGS: CODE_ALLOWED_TAGS, ALLOWED_ATTR: CODE_ALLOWED_ATTR },
	),
);

const copyText = computed(() => dedent(realParts.value.inner));

const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;

function handleCopy() {
	navigator.clipboard.writeText(copyText.value);
	copied.value = true;
	if (timer) clearTimeout(timer);
	timer = setTimeout(() => { copied.value = false; }, 2000);
}
</script>

<style scoped>
.mcp-snippets {
	margin-top: 8px;
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

.snippet-block {
	position: relative;
	background: var(--theme--background-subdued);
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-top: none;
	border-radius: 0 0 var(--theme--border-radius) var(--theme--border-radius);
	overflow: hidden;
}

.snippet-block pre {
	margin: 0;
	padding: 16px;
	padding-right: 48px;
	overflow-x: auto;
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 13px;
	line-height: 1.5;
	white-space: pre;
	color: var(--theme--foreground);
}

.snippet-block .ctx {
	opacity: 0.35;
}

.copy-btn {
	position: absolute;
	top: 8px;
	right: 8px;
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 4px 8px;
	background: var(--theme--background);
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	cursor: pointer;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
	transition: color 0.15s, border-color 0.15s;
}

.copy-btn:hover {
	color: var(--theme--foreground);
	border-color: var(--theme--foreground-subdued);
}

.copied-label {
	font-family: var(--theme--fonts--sans--font-family, sans-serif);
}

.file-hint {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-top: 8px;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.file-hint code {
	background: var(--theme--background-subdued);
	padding: 1px 4px;
	border-radius: 3px;
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 12px;
}
</style>

<style>
/* highlight.js theme for snippet block */
.snippet-block .hljs-string,
.snippet-block .hljs-title,
.snippet-block .hljs-section,
.snippet-block .hljs-attribute,
.snippet-block .hljs-literal,
.snippet-block .hljs-template-tag,
.snippet-block .hljs-template-variable,
.snippet-block .hljs-type {
	color: var(--theme--success, #2ecda7);
}

.snippet-block .hljs-number,
.snippet-block .hljs-meta,
.snippet-block .hljs-symbol,
.snippet-block .hljs-bullet,
.snippet-block .hljs-link {
	color: var(--theme--warning, #ffa439);
}

.snippet-block .hljs-keyword,
.snippet-block .hljs-selector-tag,
.snippet-block .hljs-built_in,
.snippet-block .hljs-name,
.snippet-block .hljs-tag {
	color: var(--theme--primary);
}

.snippet-block .hljs-punctuation {
	color: var(--theme--foreground-subdued);
}
</style>
