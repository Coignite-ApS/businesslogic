<template>
	<div class="chatkit-wrapper" ref="container"></div>
</template>

<script setup lang="ts">
import { BlChatKit } from '@businesslogic/widget';
// Force rollup to keep BlChatKit (and all sub-components via chatkit-renderer)
// Without this, tree-shaking strips the @customElement('bl-chatkit') registration
void BlChatKit;
import { ref, watch, onMounted } from 'vue';

const props = defineProps<{
	tree: any;
}>();

const emit = defineEmits<{
	action: [data: { type: string; payload?: Record<string, unknown> }];
}>();

const container = ref<HTMLElement>();

function renderTree() {
	if (!container.value || !props.tree) return;
	container.value.innerHTML = '';

	const el = document.createElement('bl-chatkit');
	(el as any).tree = props.tree;

	el.addEventListener('bl-action', (e: Event) => {
		const detail = (e as CustomEvent).detail;
		if (detail) {
			emit('action', detail);
		}
	});

	container.value.appendChild(el);
}

onMounted(() => {
	renderTree();
});

watch(() => props.tree, () => {
	renderTree();
}, { deep: true });
</script>

<style scoped>
.chatkit-wrapper {
	margin: 8px 0;
	max-width: 100%;
	overflow-x: auto;
}
</style>
