<template>
	<div class="nav-container">
		<v-list nav>
			<v-list-item to="/knowledge" :active="!currentId" clickable>
				<v-list-item-icon><v-icon name="dashboard" /></v-list-item-icon>
				<v-list-item-content><v-text-overflow text="Dashboard" /></v-list-item-content>
			</v-list-item>

			<v-divider />

			<v-list-item
				v-for="kb in knowledgeBases"
				:key="kb.id"
				:to="`/knowledge/${kb.id}`"
				clickable
			>
				<v-list-item-icon><v-icon :name="kb.icon || 'menu_book'" /></v-list-item-icon>
				<v-list-item-content>
					<v-text-overflow :text="kb.name" class="kb-name" />
					<span class="kb-meta">
						{{ kb.document_count }} docs &middot; {{ kb.chunk_count }} chunks
						<span v-if="kb.contextual_retrieval_enabled !== false" class="feature-badge" title="Contextual Retrieval">CR</span>
						<span v-if="kb.parent_doc_enabled" class="feature-badge" title="Parent-Document Retrieval">PD</span>
					</span>
				</v-list-item-content>
			</v-list-item>
		</v-list>

		<v-info v-if="!loading && knowledgeBases.length === 0" icon="menu_book" title="No Knowledge Bases">
			Create your first knowledge base to get started.
		</v-info>

		<v-button full-width :disabled="creating" @click="$emit('create')" class="create-button">
			<v-icon name="add" left />
			New Knowledge Base
		</v-button>
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
	create: [];
}>();
</script>

<style scoped>
.nav-container {
	padding: 12px;
	height: 100%;
	display: flex;
	flex-direction: column;
}

.nav-container :deep(.v-list) {
	flex: 1;
	overflow-y: auto;
}

.create-button {
	margin-top: auto;
	flex-shrink: 0;
}

.kb-name {
	font-weight: 500;
}

.kb-meta {
	display: block;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.feature-badge {
	display: inline-block;
	font-size: 10px;
	font-weight: 600;
	padding: 1px 4px;
	border-radius: 3px;
	background: var(--theme--primary-background);
	color: var(--theme--primary);
	margin-left: 4px;
	vertical-align: middle;
}
</style>
