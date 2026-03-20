<template>
	<div class="code-block">
		<pre><code v-html="highlighted"></code></pre>
		<button class="copy-btn" @click="handleCopy">
			<v-icon :name="copied ? 'check' : 'content_copy'" small />
			<span v-if="copied" class="copied-label">Copied!</span>
		</button>
	</div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import php from 'highlight.js/lib/languages/php';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';
import json from 'highlight.js/lib/languages/json';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('php', php);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('java', java);
hljs.registerLanguage('json', json);

const props = defineProps<{
	code: string;
	language?: string;
	copyCode?: string;
}>();

const highlighted = computed(() => {
	if (props.language && hljs.getLanguage(props.language)) {
		return hljs.highlight(props.code, { language: props.language }).value;
	}
	return hljs.highlightAuto(props.code).value;
});

const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;

function handleCopy() {
	navigator.clipboard.writeText(props.copyCode || props.code);
	copied.value = true;
	if (timer) clearTimeout(timer);
	timer = setTimeout(() => { copied.value = false; }, 2000);
}
</script>

<style scoped>
.code-block {
	position: relative;
	background: var(--theme--background-subdued);
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-top: none;
	border-radius: 0 0 var(--theme--border-radius) var(--theme--border-radius);
	overflow: hidden;
}

.code-block pre {
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
</style>

<style>
/* highlight.js theme — matches Directus variables */
.code-block .hljs-keyword,
.code-block .hljs-selector-tag,
.code-block .hljs-built_in,
.code-block .hljs-name,
.code-block .hljs-tag {
	color: var(--theme--primary);
}

.code-block .hljs-string,
.code-block .hljs-title,
.code-block .hljs-section,
.code-block .hljs-attribute,
.code-block .hljs-literal,
.code-block .hljs-template-tag,
.code-block .hljs-template-variable,
.code-block .hljs-type {
	color: var(--theme--success, #2ecda7);
}

.code-block .hljs-number,
.code-block .hljs-meta,
.code-block .hljs-symbol,
.code-block .hljs-bullet,
.code-block .hljs-link {
	color: var(--theme--warning, #ffa439);
}

.code-block .hljs-comment,
.code-block .hljs-quote {
	color: var(--theme--foreground-subdued);
	font-style: italic;
}

.code-block .hljs-params {
	color: var(--theme--foreground);
}

.code-block .hljs-punctuation {
	color: var(--theme--foreground-subdued);
}
</style>
