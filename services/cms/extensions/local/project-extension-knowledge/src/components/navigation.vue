<template>
	<div class="kb-navigation">
		<v-list nav>
			<v-list-item
				v-for="kb in knowledgeBases"
				:key="kb.id"
				:active="kb.id === currentId"
				clickable
				@click="$emit('select', kb.id)"
			>
				<v-list-item-icon><v-icon :name="kb.icon || 'menu_book'" /></v-list-item-icon>
				<v-list-item-content>
					<span class="kb-name">{{ kb.name }}</span>
					<span class="kb-meta">{{ kb.document_count }} docs &middot; {{ kb.chunk_count }} chunks</span>
				</v-list-item-content>
			</v-list-item>
		</v-list>

		<div class="nav-actions">
			<v-button full-width :loading="creating" @click="$emit('create')">
				<v-icon name="add" />
				New Knowledge Base
			</v-button>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { KnowledgeBase } from '../composables/use-knowledge-bases';

defineProps<{
	knowledgeBases: KnowledgeBase[];
	currentId: string | null;
	loading: boolean;
	creating: boolean;
}>();

defineEmits<{
	select: [id: string];
	create: [];
}>();
</script>

<style scoped>
.kb-navigation {
	display: flex;
	flex-direction: column;
	height: 100%;
}

.kb-name {
	display: block;
	font-weight: 500;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.kb-meta {
	display: block;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.nav-actions {
	margin-top: auto;
	padding: 12px;
}
</style>
