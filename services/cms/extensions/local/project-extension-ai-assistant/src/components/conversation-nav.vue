<template>
	<div class="conversation-nav">
		<v-button full-width @click="$emit('new-chat')" class="new-chat-btn">
			<v-icon name="add" left />
			New Chat
		</v-button>

		<div v-if="loading" class="nav-loading">
			<v-progress-circular indeterminate small />
		</div>

		<v-list v-else nav>
			<v-list-item
				v-for="conv in conversations"
				:key="conv.id"
				:to="`/ai-assistant/${conv.id}`"
				:active="conv.id === currentId"
			>
				<v-list-item-icon><v-icon name="chat_bubble_outline" small /></v-list-item-icon>
				<v-list-item-content>
					<v-text-overflow :text="conv.title || 'New conversation'" />
				</v-list-item-content>
				<button
					class="conv-delete"
					@click.stop="$emit('archive', conv.id)"
					title="Archive"
				>
					<v-icon name="close" x-small />
				</button>
			</v-list-item>
		</v-list>

		<!-- Usage nudge — only visible when it matters -->
		<div v-if="usage && !isUnlimited && usagePercent >= 70" class="usage-section">
			<div class="usage-bar-wrapper">
				<div
					class="usage-bar-fill"
					:class="usageLevel"
					:style="{ width: usagePercent + '%' }"
				/>
			</div>
			<div class="usage-label">
				<span v-if="queriesRemaining > 0">{{ queriesRemaining }} queries left</span>
				<span v-else>No queries left</span>
				<button
					v-if="usagePercent >= 90"
					class="upgrade-link"
					@click="$emit('upgrade')"
				>
					Get more
				</button>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Conversation } from '../composables/use-conversations';
import type { UsageData } from '../composables/use-usage';

const props = defineProps<{
	conversations: Conversation[];
	currentId: string | null;
	loading: boolean;
	usage: UsageData | null;
	isUnlimited: boolean;
	usagePercent: number;
	usageLevel: 'normal' | 'warning' | 'danger';
}>();

const queriesRemaining = computed(() => {
	if (!props.usage || props.usage.queries_limit === null) return Infinity;
	return Math.max(0, props.usage.queries_limit - props.usage.queries_used);
});

defineEmits<{
	(e: 'new-chat'): void;
	(e: 'archive', id: string): void;
	(e: 'upgrade'): void;
}>();
</script>

<style scoped>
.conversation-nav {
	padding: 12px;
	height: 100%;
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.new-chat-btn {
	--v-button-background-color: var(--theme--primary);
	--v-button-color: var(--theme--primary-foreground, #fff);
}

.nav-loading {
	display: flex;
	justify-content: center;
	padding: 20px;
}

.conv-delete {
	opacity: 0;
	background: none;
	border: none;
	cursor: pointer;
	padding: 2px;
	border-radius: 4px;
	color: var(--theme--foreground-subdued);
	transition: opacity 0.1s;
}

.v-list-item:hover .conv-delete {
	opacity: 1;
}

.conv-delete:hover {
	color: var(--theme--danger);
}

.usage-section {
	padding: 10px 4px 2px;
	border-top: 1px solid var(--theme--border-color);
	margin-top: auto;
}

.usage-bar-wrapper {
	height: 3px;
	background: var(--theme--background-normal);
	border-radius: 2px;
	overflow: hidden;
	margin-bottom: 6px;
}

.usage-bar-fill {
	height: 100%;
	border-radius: 2px;
	transition: width 0.3s ease;
}

.usage-bar-fill.normal {
	background: var(--theme--foreground-subdued);
}

.usage-bar-fill.warning {
	background: var(--theme--warning);
}

.usage-bar-fill.danger {
	background: var(--theme--danger);
}

.usage-label {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 11px;
	color: var(--theme--foreground-subdued);
}

.upgrade-link {
	margin-left: auto;
	background: none;
	border: none;
	color: var(--theme--primary);
	cursor: pointer;
	font-size: 11px;
	font-weight: 600;
	padding: 0;
}

.upgrade-link:hover {
	text-decoration: underline;
}
</style>
