<template>
	<div class="formula-navigation">
		<v-list nav class="nav-list">
			<v-list-item
				to="/formulas"
				:active="currentView === 'test'"
				clickable
			>
				<v-list-item-icon>
					<v-icon name="play_arrow" small />
				</v-list-item-icon>
				<v-list-item-content>
					<v-text-overflow text="Test" />
				</v-list-item-content>
			</v-list-item>

			<v-list-item
				to="/formulas/integration"
				:active="currentView === 'integration'"
				clickable
			>
				<v-list-item-icon>
					<v-icon name="integration_instructions" small />
				</v-list-item-icon>
				<v-list-item-content>
					<v-text-overflow text="Integrate" />
				</v-list-item-content>
			</v-list-item>
		</v-list>
	</div>
</template>

<script setup lang="ts">
defineProps<{
	currentView: 'test' | 'integration';
}>();
</script>

<style scoped>
.formula-navigation {
	padding: 12px;
}

.nav-list {
	margin-top: 0;
}
</style>
