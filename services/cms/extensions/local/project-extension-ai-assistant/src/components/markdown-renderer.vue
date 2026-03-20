<template>
	<div class="markdown-content" v-html="rendered"></div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('html', xml);

const ALLOWED_TAGS = [
	'p', 'br', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i',
	'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
	'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
	'span', 'div', 'hr', 'del', 'sup', 'sub',
];

const ALLOWED_ATTR = ['href', 'target', 'rel', 'class', 'id'];

const props = defineProps<{ content: string }>();

const marked = new Marked({
	renderer: {
		code({ text, lang }: { text: string; lang?: string }) {
			if (lang && hljs.getLanguage(lang)) {
				const highlighted = hljs.highlight(text, { language: lang }).value;
				return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
			}
			const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
			return `<pre><code>${escaped}</code></pre>`;
		},
	},
});

const rendered = computed(() => {
	try {
		const raw = marked.parse(props.content || '') as string;
		return DOMPurify.sanitize(raw, { ALLOWED_TAGS, ALLOWED_ATTR });
	} catch {
		return DOMPurify.sanitize(props.content || '', { ALLOWED_TAGS, ALLOWED_ATTR });
	}
});
</script>

<style scoped>
.markdown-content {
	line-height: 1.6;
	word-wrap: break-word;
}

.markdown-content :deep(p) {
	margin: 0 0 8px;
}

.markdown-content :deep(p:last-child) {
	margin-bottom: 0;
}

.markdown-content :deep(pre) {
	background: var(--theme--background-subdued);
	border-radius: 6px;
	padding: 12px;
	overflow-x: auto;
	margin: 8px 0;
	font-size: 13px;
}

.markdown-content :deep(code) {
	font-family: var(--theme--fonts--monospace--font-family);
	font-size: 13px;
}

.markdown-content :deep(:not(pre) > code) {
	background: var(--theme--background-subdued);
	padding: 2px 6px;
	border-radius: 4px;
}

.markdown-content :deep(table) {
	width: 100%;
	border-collapse: collapse;
	margin: 8px 0;
	font-size: 14px;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
	padding: 6px 12px;
	border: 1px solid var(--theme--border-color);
	text-align: left;
}

.markdown-content :deep(th) {
	background: var(--theme--background-subdued);
	font-weight: 600;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
	margin: 4px 0;
	padding-left: 20px;
}

.markdown-content :deep(strong) {
	font-weight: 600;
}

.markdown-content :deep(a) {
	color: var(--theme--primary);
}
</style>
