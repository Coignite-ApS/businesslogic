<template>
	<div class="prompt-picker">
		<div class="prompt-header">
			<h2>How can I help?</h2>
			<p class="subtitle">Ask about your calculators, run calculations, or pick a suggestion below.</p>
		</div>
		<div v-if="prompts.length > 0" class="prompt-grid">
			<button
				v-for="prompt in prompts"
				:key="prompt.id"
				class="prompt-card"
				@click="$emit('select', prompt)"
			>
				<v-icon :name="prompt.icon || 'lightbulb'" />
				<div class="prompt-card-text">
					<span class="prompt-name">{{ prompt.name }}</span>
					<span v-if="prompt.description" class="prompt-desc">{{ prompt.description }}</span>
				</div>
			</button>
		</div>
	</div>
</template>

<script setup lang="ts">
defineProps<{
	prompts: Array<{
		id: string;
		name: string;
		description?: string;
		icon?: string;
		user_prompt_template?: string;
		category?: string;
	}>;
}>();

defineEmits<{
	(e: 'select', prompt: any): void;
}>();
</script>

<style scoped>
.prompt-picker {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: 40px 20px;
	height: 100%;
	min-height: 300px;
}

.prompt-header {
	text-align: center;
	margin-bottom: 32px;
}

.prompt-header h2 {
	font-size: 24px;
	font-weight: 700;
	margin: 0 0 8px;
}

.subtitle {
	color: var(--theme--foreground-subdued);
	font-size: 14px;
	margin: 0;
}

.prompt-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
	gap: 12px;
	max-width: 640px;
	width: 100%;
}

.prompt-card {
	display: flex;
	align-items: flex-start;
	gap: 10px;
	padding: 14px;
	background: var(--theme--background-subdued);
	border: 1px solid var(--theme--border-color);
	border-radius: 10px;
	cursor: pointer;
	text-align: left;
	transition: border-color 0.15s, background 0.15s;
}

.prompt-card:hover {
	border-color: var(--theme--primary);
	background: var(--theme--background-normal);
}

.prompt-card-text {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.prompt-name {
	font-weight: 600;
	font-size: 14px;
}

.prompt-desc {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}
</style>
