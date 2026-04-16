<template>
	<div class="template-editor" ref="wrapperRef">
		<div
			ref="editorRef"
			class="editor"
			:contenteditable="!disabled"
			:data-placeholder="placeholder"
			@input="handleInput"
			@keydown="handleKeydown"
			@blur="handleBlur"
			@paste="handlePaste"
		></div>
		<div
			v-if="showDropdown && filteredVars.length"
			class="autocomplete-dropdown"
		>
			<div
				v-for="(v, i) in filteredVars"
				:key="v.value"
				class="dropdown-item"
				:class="{ active: i === activeIndex }"
				@mousedown.prevent="insertVar(v)"
			>
				<span class="var-group">{{ v.group }}</span>
				<span class="var-name">{{ v.label }}</span>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue';

const props = defineProps<{
	modelValue: string;
	inputParams: string[];
	outputParams: string[];
	placeholder?: string;
	disabled?: boolean;
}>();

const emit = defineEmits<{
	(e: 'update:modelValue', val: string): void;
}>();

const editorRef = ref<HTMLDivElement | null>(null);
const wrapperRef = ref<HTMLElement | null>(null);
const showDropdown = ref(false);
const activeIndex = ref(0);
const searchText = ref('');

let atTextNode: Text | null = null;
let atOffset = 0;
let cursorOffset = 0;
let internalUpdate = false;

const VAR_RE = /\{\{(input|output)\.([^}]+)\}\}/g;

interface VarItem {
	group: string;
	label: string;
	value: string;
}

const allVars = computed<VarItem[]>(() => {
	const items: VarItem[] = [];
	for (const p of props.inputParams) {
		items.push({ group: 'Input', label: p, value: `{{input.${p}}}` });
	}
	for (const p of props.outputParams) {
		items.push({ group: 'Output', label: p, value: `{{output.${p}}}` });
	}
	return items;
});

const filteredVars = computed(() => {
	if (!searchText.value) return allVars.value;
	const q = searchText.value.toLowerCase();
	return allVars.value.filter(
		(v) => v.label.toLowerCase().includes(q) || v.group.toLowerCase().includes(q),
	);
});

watch(filteredVars, () => {
	activeIndex.value = 0;
});

/* ── DOM helpers ── */

function createTagEl(type: string, name: string, value: string): HTMLSpanElement {
	const span = document.createElement('span');
	span.className = `var-tag ${type}-tag`;
	span.contentEditable = 'false';
	span.dataset.value = value;

	const label = document.createElement('span');
	label.className = 'tag-label';
	label.textContent = name;
	span.appendChild(label);

	const xBtn = document.createElement('span');
	xBtn.className = 'tag-x';
	xBtn.textContent = '×';
	xBtn.addEventListener('mousedown', (e) => {
		e.preventDefault();
		e.stopPropagation();
		span.remove();
		emitSerialised();
	});
	span.appendChild(xBtn);

	return span;
}

function renderEditor() {
	const el = editorRef.value;
	if (!el) return;
	el.replaceChildren();
	const str = props.modelValue || '';
	if (!str) return;

	const regex = new RegExp(VAR_RE.source, 'g');
	let lastIndex = 0;
	let match;

	while ((match = regex.exec(str)) !== null) {
		if (match.index > lastIndex) {
			appendText(el, str.slice(lastIndex, match.index));
		}
		el.appendChild(createTagEl(match[1], match[2], match[0]));
		lastIndex = match.index + match[0].length;
	}
	if (lastIndex < str.length) {
		appendText(el, str.slice(lastIndex));
	}
}

function appendText(el: HTMLElement, text: string) {
	const lines = text.split('\n');
	lines.forEach((line, i) => {
		if (i > 0) el.appendChild(document.createElement('br'));
		if (line) el.appendChild(document.createTextNode(line));
	});
}

/* ── Serialisation (DOM → string) ── */

function serializeNodes(nodes: NodeListOf<ChildNode>): string {
	let result = '';
	for (const node of nodes) {
		if (node.nodeType === Node.TEXT_NODE) {
			result += (node.textContent || '').replace(/\u200B/g, '');
		} else if (node.nodeType === Node.ELEMENT_NODE) {
			const elem = node as HTMLElement;
			if (elem.classList.contains('var-tag')) {
				result += elem.dataset.value || '';
			} else if (elem.tagName === 'BR') {
				result += '\n';
			} else if (elem.tagName === 'DIV' || elem.tagName === 'P') {
				const inner = serializeNodes(elem.childNodes);
				if (result && !result.endsWith('\n')) result += '\n';
				result += inner;
			}
		}
	}
	return result;
}

function serialize(): string {
	const el = editorRef.value;
	if (!el) return '';
	return serializeNodes(el.childNodes);
}

function emitSerialised() {
	internalUpdate = true;
	emit('update:modelValue', serialize());
}

/* ── Event handlers ── */

function handleInput() {
	emitSerialised();
	checkAtTrigger();
}

function handlePaste(e: ClipboardEvent) {
	e.preventDefault();
	const text = e.clipboardData?.getData('text/plain') || '';
	const sel = window.getSelection();
	if (!sel || !sel.rangeCount) return;
	const range = sel.getRangeAt(0);
	range.deleteContents();
	const textNode = document.createTextNode(text);
	range.insertNode(textNode);
	range.setStartAfter(textNode);
	range.collapse(true);
	sel.removeAllRanges();
	sel.addRange(range);
	emitSerialised();
}

function checkAtTrigger() {
	const sel = window.getSelection();
	if (!sel || !sel.rangeCount) {
		showDropdown.value = false;
		return;
	}
	const range = sel.getRangeAt(0);
	if (range.startContainer.nodeType !== Node.TEXT_NODE) {
		showDropdown.value = false;
		return;
	}
	const textNode = range.startContainer as Text;
	const text = textNode.textContent?.slice(0, range.startOffset) || '';
	const atIdx = text.lastIndexOf('@');
	if (atIdx === -1) {
		showDropdown.value = false;
		return;
	}

	const afterAt = text.slice(atIdx + 1);
	if (afterAt.includes(' ') || afterAt.includes('\n')) {
		showDropdown.value = false;
		return;
	}

	atTextNode = textNode;
	atOffset = atIdx;
	cursorOffset = range.startOffset;
	searchText.value = afterAt;
	showDropdown.value = true;
}

function handleKeydown(e: KeyboardEvent) {
	if (!showDropdown.value) return;

	if (e.key === 'ArrowDown') {
		e.preventDefault();
		activeIndex.value = Math.min(activeIndex.value + 1, filteredVars.value.length - 1);
	} else if (e.key === 'ArrowUp') {
		e.preventDefault();
		activeIndex.value = Math.max(activeIndex.value - 1, 0);
	} else if (e.key === 'Enter' || e.key === 'Tab') {
		if (filteredVars.value.length > 0) {
			e.preventDefault();
			insertVar(filteredVars.value[activeIndex.value]);
		}
	} else if (e.key === 'Escape') {
		showDropdown.value = false;
	}
}

function handleBlur() {
	setTimeout(() => { showDropdown.value = false; }, 150);
}

function insertVar(v: VarItem) {
	if (!atTextNode || !atTextNode.parentNode) return;

	const text = atTextNode.textContent || '';
	const before = text.slice(0, atOffset);
	const after = text.slice(cursorOffset);
	const parent = atTextNode.parentNode;

	const type = v.group.toLowerCase() as 'input' | 'output';
	const tagEl = createTagEl(type, v.label, v.value);

	const frag = document.createDocumentFragment();
	if (before) frag.appendChild(document.createTextNode(before));
	frag.appendChild(tagEl);
	const afterNode = document.createTextNode(after || '\u200B');
	frag.appendChild(afterNode);

	parent.replaceChild(frag, atTextNode);
	showDropdown.value = false;
	atTextNode = null;

	emitSerialised();

	nextTick(() => {
		const sel = window.getSelection();
		if (!sel) return;
		const r = document.createRange();
		r.setStart(afterNode, after ? 0 : 1);
		r.collapse(true);
		sel.removeAllRanges();
		sel.addRange(r);
		editorRef.value?.focus();
	});
}

/* ── Lifecycle ── */

onMounted(() => {
	renderEditor();
});

watch(
	() => props.modelValue,
	() => {
		if (internalUpdate) {
			internalUpdate = false;
			return;
		}
		renderEditor();
	},
);
</script>

<style scoped>
.template-editor {
	position: relative;
}

.editor {
	width: 100%;
	min-height: 120px;
	padding: 12px;
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 13px;
	line-height: 1.8;
	background: var(--theme--background);
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	color: var(--theme--foreground);
	outline: none;
	white-space: pre-wrap;
	word-wrap: break-word;
	overflow-y: auto;
	resize: vertical;
}

.editor:focus {
	border-color: var(--theme--primary);
}

.editor:empty::before {
	content: attr(data-placeholder);
	color: var(--theme--foreground-subdued);
	pointer-events: none;
}

.editor[contenteditable="false"] {
	opacity: 0.6;
	cursor: not-allowed;
}

/* ── Tags (dynamic DOM — need :deep) ── */

.editor :deep(.var-tag) {
	display: inline-flex;
	align-items: center;
	gap: 3px;
	padding: 0 6px;
	border-radius: 4px;
	font-size: 12px;
	font-weight: 600;
	vertical-align: baseline;
	cursor: default;
	user-select: none;
	line-height: 1.7;
	margin: 0 1px;
}

.editor :deep(.input-tag) {
	background: var(--theme--primary, #6644ff);
	color: #fff;
}

.editor :deep(.output-tag) {
	background: #2ecda7;
	color: #fff;
}

.editor :deep(.tag-label) {
	pointer-events: none;
}

.editor :deep(.tag-x) {
	cursor: pointer;
	font-size: 14px;
	line-height: 1;
	opacity: 0.7;
	margin-left: 2px;
}

.editor :deep(.tag-x:hover) {
	opacity: 1;
}

/* ── Autocomplete dropdown ── */

.autocomplete-dropdown {
	position: absolute;
	bottom: 100%;
	left: 0;
	z-index: 100;
	min-width: 240px;
	max-height: 200px;
	overflow-y: auto;
	background: var(--theme--background);
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	box-shadow: 0 -4px 12px rgb(0 0 0 / 0.1);
	margin-bottom: 4px;
}

.dropdown-item {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 12px;
	cursor: pointer;
	font-size: 13px;
}

.dropdown-item:hover,
.dropdown-item.active {
	background: var(--theme--background-accent);
}

.var-group {
	font-size: 11px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	text-transform: uppercase;
	min-width: 48px;
}

.var-name {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	color: var(--theme--foreground);
}
</style>
