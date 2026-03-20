<template>
	<div class="canvas-toolbar">
		<v-button small secondary @click="$emit('save')" :loading="saving" :disabled="!dirty">
			<v-icon name="save" small left />
			Save
		</v-button>

		<v-button small secondary @click="$emit('validate')">
			<v-icon name="check_circle" small left />
			Validate
		</v-button>

		<v-button
			v-if="status !== 'active'"
			small
			@click="$emit('deploy')"
			:disabled="dirty"
		>
			<v-icon name="rocket_launch" small left />
			Deploy
		</v-button>

		<v-button
			v-else
			small
			kind="warning"
			@click="$emit('undeploy')"
		>
			<v-icon name="stop" small left />
			Deactivate
		</v-button>

		<v-button small secondary @click="$emit('trigger')" :loading="executing" :disabled="status !== 'active'">
			<v-icon name="play_arrow" small left />
			Trigger
		</v-button>

		<div class="toolbar-spacer" />

		<v-button small secondary icon @click="$emit('fitView')">
			<v-icon name="fit_screen" small />
		</v-button>
	</div>
</template>

<script setup lang="ts">
defineProps<{
	saving: boolean;
	executing: boolean;
	dirty: boolean;
	status: 'draft' | 'active' | 'disabled';
}>();

defineEmits<{
	save: [];
	validate: [];
	deploy: [];
	undeploy: [];
	trigger: [];
	fitView: [];
}>();
</script>

<style scoped>
.canvas-toolbar {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 12px;
	border-bottom: 1px solid var(--theme--border-color);
	background: var(--theme--background);
}

.toolbar-spacer {
	flex: 1;
}
</style>
