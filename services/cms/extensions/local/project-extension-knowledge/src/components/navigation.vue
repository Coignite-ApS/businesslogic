<template>
	<div class="kb-navigation">
		<v-list nav>
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

.nav-actions {
	margin-top: auto;
	padding: 12px;
}
</style>
