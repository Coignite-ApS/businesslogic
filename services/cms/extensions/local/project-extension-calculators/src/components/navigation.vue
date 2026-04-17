<template>
	<div class="nav-container">
		<v-list nav>
			<v-list-item to="/calculators" :active="!currentId" clickable>
				<v-list-item-icon><v-icon name="dashboard" /></v-list-item-icon>
				<v-list-item-content><v-text-overflow text="Dashboard" /></v-list-item-content>
			</v-list-item>

			<v-divider />

			<template v-if="calculators.length > 0">
				<template v-for="calc in calculators" :key="calc.id">
					<v-list-item :to="`/calculators/${calc.id}`" clickable>
						<v-list-item-icon>
							<v-icon :name="calc.icon || 'calculate'" />
						</v-list-item-icon>
						<v-list-item-content>
							<v-text-overflow :text="calc.name || 'New Calculator'" />
						</v-list-item-content>
						<span class="status-dot" :class="statusDotClass(calc)" />
					</v-list-item>

					<template v-if="calc.id === currentId">
						<v-list-item
							v-if="hasExcel"
							:to="`/calculators/${calc.id}/configure`"
							clickable
							class="sub-item"
						>
							<v-list-item-icon><v-icon name="tune" /></v-list-item-icon>
							<v-list-item-content><v-text-overflow text="Configure" /></v-list-item-content>
						</v-list-item>

						<v-list-item
							v-if="hasConfig"
							:to="`/calculators/${calc.id}/test`"
							clickable
							class="sub-item"
						>
							<v-list-item-icon><v-icon name="play_arrow" /></v-list-item-icon>
							<v-list-item-content><v-text-overflow text="Test" /></v-list-item-content>
						</v-list-item>

						<v-list-item
							v-if="hasConfig"
							:to="`/calculators/${calc.id}/integration`"
							clickable
							class="sub-item"
						>
							<v-list-item-icon><v-icon name="integration_instructions" /></v-list-item-icon>
							<v-list-item-content><v-text-overflow text="Integrate" /></v-list-item-content>
						</v-list-item>
					</template>
				</template>
			</template>
		</v-list>

		<v-info v-if="!loading && calculators.length === 0" icon="calculate" title="No Calculators">
			Create your first calculator to get started.
		</v-info>

		<v-button full-width :disabled="creating" @click="$emit('create')" class="create-button">
			<v-icon name="add" left />
			New calculator
		</v-button>
	</div>
</template>

<script setup lang="ts">
import type { Calculator } from '../types';

defineProps<{
	calculators: Calculator[];
	currentId: string | null;
	loading: boolean;
	creating: boolean;
	currentView?: 'dashboard' | 'configure' | 'test' | 'integration' | null;
	hasExcel?: boolean;
	hasConfig?: boolean;
}>();

defineEmits<{
	create: [];
}>();

function statusDotClass(calc: Calculator): string {
	if (calc.activated && !calc.over_limit) return 'dot-live';
	if (calc.activated && calc.over_limit) return 'dot-overlimit';
	if (!calc.activated && calc.test_expires_at && new Date(calc.test_expires_at) > new Date()) return 'dot-test';
	return 'dot-inactive';
}
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

.nav-container :deep(.v-list-item-content) {
	flex: 1;
	min-width: 0;
	margin-right: 8px;
}

.sub-item {
	padding-left: 20px;
}

.status-dot {
	display: inline-block;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	flex-shrink: 0;
	margin-right: 16px;
}

.dot-live {
	background-color: var(--theme--success);
}

.dot-test,
.dot-overlimit {
	background-color: var(--theme--warning);
}

.dot-inactive {
	background-color: var(--theme--foreground-subdued);
	opacity: 0.4;
}
</style>
