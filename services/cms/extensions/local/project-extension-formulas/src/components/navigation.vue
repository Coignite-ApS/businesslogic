<template>
	<div class="formula-navigation">
		<v-list class="nav-list">
			<v-list-item
				:active="currentView === 'test'"
				clickable
				@click="$router.push('/formulas')"
			>
				<v-list-item-icon>
					<v-icon name="play_arrow" small />
				</v-list-item-icon>
				<v-list-item-content>
					<v-text-overflow text="Test" />
				</v-list-item-content>
			</v-list-item>

			<v-list-item
				:active="currentView === 'integration'"
				clickable
				@click="$router.push('/formulas/integration')"
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
